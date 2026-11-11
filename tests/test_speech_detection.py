"""Production Silero policy, bounded worker lifecycle, settings and streaming input contract."""
import unittest
from pathlib import Path
from recording_test_support import evaluate

ROOT = Path(__file__).resolve().parents[1]
CORE = (ROOT/'js/speech-detection-core.js').read_text().replace('export ', '')
SERVICE = '\n'.join(line for line in (ROOT/'js/speech-detection.js').read_text().splitlines() if not line.startswith('import ')).replace('export ', '').replace('import.meta.url', "'https://test.invalid/js/speech-detection.js'")
BASE = r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
const settings={audioCommands:true,speechDuringPause:true,speechDuringRecord:false,speechThreshold:.6,speechMinFrames:2,speechLookbackMs:1000};
let clock=0;const timers=new Map();let sequence=0;
const workers=[],statuses=[];
function make(){return createSpeechDetection({createWorker(){const worker={messages:[],terminated:false,postMessage(message){this.messages.push(message);},terminate(){this.terminated=true;}};workers.push(worker);return worker;},
 onStatus:text=>statuses.push(text),setTimer:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id),now:()=>clock});}
async function ready(service){const waiting=service.prepare();workers.at(-1).onmessage({data:{type:'ready'}});await waiting;}
function reply(worker,request,history=[{end:512,prob:.8},{end:1024,prob:.9}],end=1024){worker.onmessage({data:{type:'result',id:request.id,epoch:request.epoch,result:{available:true,history,end}}});}
'''

def check(script):
    evaluate(CORE+SERVICE+BASE+"\nglobalThis.testResult='pending';(async()=>{\n"+script+"\nglobalThis.testResult='PASS';})().catch(e=>globalThis.testResult=String(e.stack));")

class SpeechDetectionTests(unittest.TestCase):
    def test_state_policy_and_gate_boundaries(self):
        check(r'''
assert(speechPolicyEnabled(settings,'paused')&&!speechPolicyEnabled(settings,'recording'),'pause-only default');
settings.speechDuringRecord=true;assert(speechPolicyEnabled(settings,'recording'),'record configurable');
settings.audioCommands=false;assert(!speechPolicyEnabled(settings,'paused'),'audio commands preference wins');
settings.audioCommands=true;
const result={available:true,end:20000,history:[{end:1000,prob:.99},{end:19500,prob:.6},{end:20000,prob:.8},{end:20512,prob:.99}]};
assert(speechDecision(result,settings).qualifying===2&&speechDecision(result,settings).pass,'threshold inclusive, stale/future evidence excluded');
settings.speechMinFrames=3;assert(!speechDecision(result,settings).pass,'minimum evidence enforced');
assert(speechDecision({available:true,end:0,history:[]},settings).pass===false,'no speech history rejects without a fixed wait');
assert(speechDecision({available:false,reason:'loading'},settings).bypassed,'loading retains normal wake path');
''')

    def test_model_preparation_singleton_retention_and_normalized_copy(self):
        check(r'''
const service=make(),first=service.prepare(),second=service.prepare();
assert(first===second&&workers.length===1,'one preparation promise and worker');
const worker=workers[0];worker.onmessage({data:{type:'ready'}});await first;
const pcm=Float32Array.from([-.5,.5]),ticket=service.feed(pcm,48000,'session:paused');
const request=worker.messages.at(-1);pcm[0]=.9;
assert(request.pcm[0]===-.5&&request.sampleRate===48000,'normalized input copied without mutating capture');
reply(worker,request);assert((await service.decide(ticket,settings)).pass,'speech passes');
service.reset();await service.prepare();assert(workers.length===1&&!worker.terminated,'reset retains warmed model');
''')

    def test_mode_reset_and_late_results_cannot_reuse_history(self):
        check(r'''
const service=make();await ready(service);const worker=workers[0];
const old=service.feed(new Float32Array(2048),48000,'a:paused'),oldRequest=worker.messages.at(-1);
const current=service.feed(new Float32Array(2048),48000,'a:recording'),request=worker.messages.at(-1);
reply(worker,oldRequest);assert(!(await service.decide(old,settings)).valid,'transition invalidates old work');
reply(worker,request,[],0);assert(!(await service.decide(current,settings)).pass,'new interval cannot inherit old positive evidence');
clock=500;const afterGap=service.feed(new Float32Array(2048),48000,'a:recording');
assert(!(await service.decide(current,settings)).valid,'audio delivery gap invalidates previous speech history');
reply(worker,worker.messages.at(-1),[],0);await service.decide(afterGap,settings);
service.reset();assert(!(await service.decide(afterGap,settings)).valid,'stop/settings reset invalidates completed ticket too');
''')

    def test_queue_timeout_error_and_retry_release_pending_work(self):
        check(r'''
const service=make();await ready(service);const worker=workers[0],tickets=[];
for(let i=0;i<4;i++)tickets.push(service.feed(new Float32Array(2048),48000,'a:paused'));
const overflow=service.feed(new Float32Array(2048),48000,'a:paused');
assert(worker.messages.filter(m=>m.type==='audio').length===4&&worker.terminated,'queue limit terminates actual queued work');
for(const ticket of tickets)assert(!(await service.decide(ticket,settings)).valid,'old pending tickets canceled');
assert((await service.decide(overflow,settings)).bypassed,'overload leaves normal wake available');
await ready(service);const nextWorker=workers[1],ticket=service.feed(new Float32Array(2048),48000,'b:paused');
const timeout=[...timers.values()].find(t=>t.ms===250);timeout.fn();
assert(nextWorker.terminated&&!(await service.decide(ticket,settings)).valid,'hung inference bounded and canceled');
await ready(service);const failed=service.feed(new Float32Array(2048),48000,'c:paused');
workers[2].onerror({message:'failed'});assert(!(await service.decide(failed,settings)).valid,'worker error releases pending work');
assert(statuses.some(s=>s.includes('normal wake')),'failure fallback shown');
''')

    def test_preparation_timeout_and_stale_result(self):
        check(r'''
const service=make();const loading=service.prepare().catch(()=> 'failed');
[...timers.values()].find(t=>t.ms===45000).fn();assert(await loading==='failed'&&workers[0].terminated,'preparation deadline');
await ready(service);const ticket=service.feed(new Float32Array(2048),48000,'a:paused');
clock=251;reply(workers[1],workers[1].messages.at(-1));
const decision=await service.decide(ticket,settings);assert(decision.bypassed&&decision.reason==='stale','late evidence is not presented as current speech');
''')

    def test_context_resampling_and_worker_contract(self):
        check(r'''
const context=new SileroV5Context(),first=new Float32Array(512).fill(.25);
context.prepend(first);const input=context.prepend(new Float32Array(512).fill(.5));
assert(input.length===576&&input[0]===.25&&input[63]===.25&&input[64]===.5,'64 historical samples plus 512 new normalized samples');
context.reset();assert(context.prepend(first)[0]===0,'context reset');
const pcm=Float32Array.from({length:9600},(_,i)=>Math.sin(i*.03));
const whole=new StreamingResampler(48000).push(pcm),splitResampler=new StreamingResampler(48000);
const a=splitResampler.push(pcm.slice(0,2048)),b=splitResampler.push(pcm.slice(2048));
const split=[...a,...b];assert(split.length===whole.length&&split.every((v,i)=>Math.abs(v-whole[i])<1e-6),'resampling continuous across packet boundaries');
''')

    def test_settings_defaults_persistence_and_clamping(self):
        source=(ROOT/'js/settings.js').read_text()
        source=source[source.index('const KEY ='):source.index('let settings = loadSettings();')].replace('export ', '')
        evaluate("let stored={};const localStorage={getItem:()=>JSON.stringify(stored)};"+source+r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
let value=loadSettings();assert(value.speechDuringPause&&!value.speechDuringRecord&&value.speechThreshold===.6&&value.speechMinFrames===2&&value.speechLookbackMs===1000,'new fields have conservative defaults');
stored={speechDuringPause:false,speechDuringRecord:true,speechThreshold:5,speechMinFrames:0,speechLookbackMs:9999,wakeThreshold:.81};
value=loadSettings();assert(!value.speechDuringPause&&value.speechDuringRecord&&value.speechThreshold===.95&&value.speechMinFrames===1&&value.speechLookbackMs===2000&&value.wakeThreshold===.81,'persist choices and preserve existing tuning while clamping');
globalThis.testResult='PASS';
''')

if __name__=='__main__':unittest.main()
