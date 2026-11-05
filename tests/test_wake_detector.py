"""Characterize production wake routing/adapters during staged extraction; no real microphone/models."""
from pathlib import Path
import json
import re
import unittest

from recording_test_support import SOURCE, between, evaluate

ROOT = Path(__file__).resolve().parents[1]


def module_source(path):
    text = (ROOT / path).read_text()
    return re.sub(r'^import\s[\s\S]*?;\n', '', text, flags=re.M).replace('export ', '')


WAKE_LOADER = module_source('js/wake-detector.js')
ROUTING = (
    WAKE_LOADER
    + between('const WAKE_DETECT_COOLDOWN_MS =', 'let wakeWord =')
    + between('async function initializeWakeWord()', '// Recorder-owned capabilities:')
    + between('function resetWakeAudioBuffer(', 'async function requestScreenWakeLock(')
    + between('function clearWakeDetectorTimers(', 'async function playPausedBeep(')
)
SETTINGS = between('window.addEventListener("imuse-settings-changed"', 'window.deviceClass = deviceClass;')
HEED_ADAPTER = module_source('js/heed/heed-adapter.js').replace('import.meta.url', "'https://test.invalid/js/heed/heed-adapter.js'")
HEED_DETECTOR = module_source('js/heed/wakeword.js')
VOICUTE_ADAPTER = module_source('js/voicute/wakeword.js')
HEED_PREPROCESSOR = module_source('js/heed/filter-coeffs.js') + module_source('js/heed/preprocessing.js')
HEED_META = json.dumps(json.loads((ROOT / 'js/heed/wake.json').read_text()))

COMMON = r"""
const assert=(v,m)=>{if(!v)throw Error(m);};
function near(a,b,m){assert(Math.abs(a-b)<1e-5,m+': '+a+' != '+b);}
function equal(a,b,m){assert(a.length===b.length,m+' length');for(let i=0;i<a.length;i++)near(a[i],b[i],m+' ['+i+']');}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
const warnings=[],console={warn:(...v)=>warnings.push(v),error:(...v)=>warnings.push(v)};
"""

HARNESS = COMMON + r"""
let clock=12345;const Date={now:()=>clock};
let activeSession=null,wakeWord=null,wakeWordLoadError=null,selectedWakeEngine='heed',WAKE_THRESHOLD=.8,wakeWordPhrase='Hey Doc';
const settings={audioCommands:true,wakeEngine:'heed',wakeThreshold:.8,voicuteThreshold:.9};
const getSettings=()=>settings,voiceController={active:false,setSuspended(){}};
const statuses=[],triggers=[],loads=[],consumes=[],predictions=[],detections=[],timers=new Map(),intervals=[];
let timerId=0,changed,resets=0,closeCalls=0;
const window={
 setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},
 clearTimeout(id){timers.delete(id);},setInterval(fn,delay){intervals.push({fn,delay});return intervals.length;},
 addEventListener(name,fn){changed=fn;}
};
function setWakeStatus(v){statuses.push(v);}
function refreshIdleWakeStatus(){statuses.push('idle');}
function handleWakeDetected(current){triggers.push(current);}
function closeCommandWindow(){closeCalls++;}
function syncAudioCommandsSuspension(){}function preloadCommandModel(){}
function loadHeedWakeWord(options){const gate=deferred();loads.push({name:'heed',options,...gate});return gate.promise;}
function loadVoicuteWakeWord(options){const gate=deferred();loads.push({name:'voicute',options,...gate});return gate.promise;}
function seed(state='recording',length=4096){
 const current={stream:{id:'original-microphone'},recorder:{state},discard:false,wakeRing:new Float32Array(length),
 wakeRingPos:0,wakeCollectedSamples:0,wakeInferenceBusy:false,wakeDetectorEnabled:true,wakeRearmTimer:null};
 activeSession=current;return current;
}
function append(current,samples){for(const v of samples){current.wakeRing[current.wakeRingPos]=v;current.wakeRingPos=(current.wakeRingPos+1)%current.wakeRing.length;}current.wakeCollectedSamples+=samples.length;}
function install(name='heed'){
 selectedWakeEngine=name;
 const engine={reset(){resets++;},setThreshold(value){this.threshold=value;},
 async consume(raw,rate){consumes.push({raw,rate});return {triggered:false};},
 audioSamplesNeeded(){return 4;},async predict(raw){predictions.push(raw);return {word:'wake',prob:.92,consFrames:3,sigmoid:true};},
 detect(...args){detections.push(args);return true;}};
 wakeWord={engine,phrase:name==='heed'?'Hey Doc':'Hey Friday'};return engine;
}
function fireTimer(id){const timer=timers.get(id);timers.delete(id);timer.fn();}
const contexts=[];
class AudioContext {
 constructor(){this.sampleRate=16000;this.state='running';this.connections=[];contexts.push(this);}
 node(){const context=this;return {connect(target){context.connections.push([this,target]);}};}
 createMediaStreamSource(stream){this.sourceStream=stream;return this.node();}
 createAnalyser(){return this.node();}
 createScriptProcessor(...args){this.processorArgs=args;return this.node();}
 createGain(){return {...this.node(),gain:{value:1}};}
 async resume(){this.resumed=true;}
}
window.AudioContext=AudioContext;
"""


def check(script, source=ROUTING + SETTINGS, harness=HARNESS):
    evaluate(harness + source + "\nglobalThis.testResult='pending';\n(async()=>{\n" + script
             + "\nglobalThis.testResult='PASS';\n})().catch(e=>globalThis.testResult=String(e)+String(e.stack||''));")


class WakeRoutingTests(unittest.TestCase):
    def test_extracted_evaluator_uses_live_callbacks_without_recorder_state(self):
        check(r"""
 for(const name of ['heed','voicute']){
  const gate=deferred(),order=[],calls=[];
  let enabled=true,current=true,listening=true,threshold=.8;
  const engine={consume:()=>gate.promise,audioSamplesNeeded:()=>4,predict:()=>gate.promise,
   detect(...args){calls.push(args);return true;}};
  const options={engineName:name,engine,buffer:{ring:new Float32Array(2048),position:0,collectedSamples:2048},sampleRate:16000,
   getThreshold:()=>threshold,cooldownMs:1500,isEnabled:()=>enabled,isCurrent:()=>current,isListening:()=>listening,
   onTrigger:()=>order.push('trigger'),onError:()=>order.push('error'),onComplete:()=>order.push('complete')};
  const evaluation=evaluateWakeDetector(options);threshold=.91;
  gate.resolve({triggered:true,word:'wake',prob:.99,consFrames:3,sigmoid:true});await evaluation;
  assert(order.join(',')==='trigger,complete','trigger then completion: '+name);
  if(name==='voicute')assert(calls[0][3]===.91,'threshold read after prediction, not snapshotted');
  for(const guard of ['enabled','current','listening']){
   const late=deferred();engine.consume=engine.predict=()=>late.promise;order.length=0;
   enabled=current=listening=true;const pending=evaluateWakeDetector(options);
   if(guard==='enabled')enabled=false;if(guard==='current')current=false;if(guard==='listening')listening=false;
   late.resolve({triggered:true,word:'wake',prob:.99});await pending;
   assert(order.join(',')===(name==='heed'&&guard==='listening'?'trigger,complete':'complete'),'live guard with preserved per-engine state rule: '+name+'/'+guard);
  }
 }
""", WAKE_LOADER, COMMON)

    def test_recorder_trigger_error_and_busy_cleanup_keep_callback_order(self):
        check(r"""
 handleWakeDetected=current=>{
  assert(current.wakeInferenceBusy,'busy remains set while trigger enters controller');triggers.push(current);
 };
 for(const name of ['heed','voicute'])for(const fail of [false,true]){
  const current=seed(),engine=install(name),gate=deferred();append(current,new Float32Array(2048));
  engine.consume=engine.predict=()=>gate.promise;const before=triggers.length;
  const evaluation=runWakeWordInference(current,16000);
  const observer=gate.promise.then(()=>{
   assert(triggers.length===before+1&&!current.wakeInferenceBusy,'trigger and cleanup finish in original inference continuation');
  },()=>{
   assert(!current.wakeDetectorEnabled&&!current.wakeInferenceBusy&&statuses.at(-1).includes('recording buttons'),'error and cleanup finish before next promise observer');
  });
  if(fail)gate.reject(Error('model failure'));else gate.resolve({triggered:true,word:'wake',prob:.99});
  await observer;await evaluation;
 }
""")

    def test_actual_audio_callback_scaling_graph_and_record_pause_delivery(self):
        check(r"""
 const current=seed(),engine=install();await setupSilenceMonitor(current);
 const context=contexts[0];
 assert(contexts.length===1&&context.sourceStream===current.stream,'analysis borrows original stream');
 equal(context.processorArgs,[2048,1,1],'existing ScriptProcessor shape');
 assert(current.wakeSilentGain.gain.value===0&&context.resumed,'silent analysis branch starts');
 assert(current.wakeRing.length===48000&&current.audioSamples.length===2048,'three-second ring and separate analyser buffer');
 assert(intervals[0].delay===100,'silence polling unchanged');
 const input=Float32Array.from({length:2048},(_,i)=>[-1,-.5,0,.5,1][i%5]);
 function audio(){current.wakeProcessor.onaudioprocess({inputBuffer:{getChannelData(channel){assert(channel===0,'mono channel');return input;}}});}
 audio();await flush();
 equal(consumes[0].raw,input.map(v=>v*32767),'signed-int16-scale floats reach Heed');
 assert(consumes[0].rate===16000,'context rate forwarded');
 current.recorder.state='paused';audio();await flush();assert(consumes.length===2,'paused also infers');
 current.wakeDetectorEnabled=false;audio();assert(consumes.length===2&&current.wakeCollectedSamples===6144,'disarmed still collects audio');
 current.recorder.state='inactive';current.wakeDetectorEnabled=true;audio();assert(consumes.length===2,'inactive does not infer');
 const count=current.wakeCollectedSamples;current.discard=true;audio();assert(current.wakeCollectedSamples===count,'discarded callback does not collect');
 current.discard=false;activeSession=seed();audio();assert(current.wakeCollectedSamples===count,'old callback cannot collect into replaced session');
""")

    def test_heed_latest_chunk_wraparound_and_minimum_input(self):
        check(r"""
 const current=seed();install();
 append(current,Float32Array.from({length:2047},(_,i)=>i));await runWakeWordInference(current,48000);
 assert(consumes.length===0&&!current.wakeInferenceBusy,'insufficient input exits without sticking busy');
 append(current,[2047]);await runWakeWordInference(current,48000);
 equal(consumes[0].raw,Float32Array.from({length:2048},(_,i)=>i),'exact boundary');
 append(current,Float32Array.from({length:2560},(_,i)=>2048+i));await runWakeWordInference(current,48000);
 equal(consumes[1].raw,Float32Array.from({length:2048},(_,i)=>2560+i),'latest chronological chunk across ring end');
 assert(consumes[1].rate===48000,'Heed adapter owns rate conversion');
""")

    def test_voicute_window_resampling_and_detect_contract(self):
        check(r"""
 for(const [rate,count,expected] of [[16000,4,[0,100,200,300]],[48000,12,[0,300,600,900]],[44100,12,[0,275.625,551.25,826.875]]]){
  const current=seed('paused',64);install('voicute');append(current,Float32Array.from({length:count},(_,i)=>i*100));
  await runWakeWordInference(current,rate);
  equal(predictions.at(-1),expected,'Voicute input at '+rate);
  equal(detections.at(-1).slice(1,6),[.92,3,.8,1500,12345],'detect score/frames/threshold/cooldown/time');
  assert(detections.at(-1)[0]==='wake'&&detections.at(-1)[6]===true,'word and sigmoid forwarded');
  assert(triggers.at(-1)===current,'detection routed back to owning session');
 }
""")

    def test_voicute_wraparound_invalid_windows_and_null_results(self):
        check(r"""
 const current=seed('recording',8),engine=install('voicute');
 append(current,[0,1,2,3,4,5,6,7,8,9]);await runWakeWordInference(current,16000);
 equal(predictions[0],[6,7,8,9],'Voicute latest window crosses ring end');
 const baseline=predictions.length;
 for(const needed of [0,-1,9]){engine.audioSamplesNeeded=()=>needed;await runWakeWordInference(current,16000);}
 engine.audioSamplesNeeded=()=>4;current.wakeCollectedSamples=3;await runWakeWordInference(current,16000);
 assert(predictions.length===baseline&&!current.wakeInferenceBusy,'invalid and insufficient requests skip prediction');
 current.wakeCollectedSamples=10;engine.predict=async()=>null;await runWakeWordInference(current,16000);
 assert(detections.length===1&&triggers.length===1,'null prediction cannot detect');
 engine.predict=async()=>({prob:.1});engine.detect=()=>false;await runWakeWordInference(current,16000);
 assert(triggers.length===1,'model rejection cannot trigger');
""")

    def test_busy_inference_skips_callbacks_without_replaying_backlog(self):
        check(r"""
 const current=seed(),engine=install(),gate=deferred();let calls=0;
 engine.consume=async raw=>{consumes.push(raw);calls++;return await gate.promise;};
 append(current,new Float32Array(2048).fill(1));const pending=runWakeWordInference(current,16000);
 append(current,new Float32Array(2048).fill(2));const middle=runWakeWordInference(current,16000);
 append(current,new Float32Array(2048).fill(3));const latest=runWakeWordInference(current,16000);await flush();
 assert(calls===1&&current.wakeInferenceBusy,'no overlap and no queue');
 gate.resolve({triggered:false});await Promise.all([pending,middle,latest]);assert(!current.wakeInferenceBusy,'completion releases busy');
 await runWakeWordInference(current,16000);
 assert(calls===2&&consumes[1].every(v=>v===3),'next call uses latest audio, skipped middle is not replayed');
""")

    def test_inference_entry_guards_and_failures(self):
        check(r"""
 const current=seed(),engine=install();append(current,new Float32Array(2048));
 const cases=[()=>{wakeWord=null;},()=>{current.wakeDetectorEnabled=false;},()=>{current.wakeInferenceBusy=true;},
 ()=>{activeSession={};},()=>{current.discard=true;},()=>{current.recorder.state='inactive';},()=>{current.wakeRing=null;}];
 for(const change of cases){
  install();activeSession=current;current.wakeDetectorEnabled=true;current.wakeInferenceBusy=false;current.discard=false;current.recorder.state='recording';current.wakeRing=new Float32Array(4096);
  change();await runWakeWordInference(current,16000);
 }
 assert(consumes.length===0,'all invalid entry states skip model');
 for(const name of ['heed','voicute']){
  const failed=seed(),bad=install(name);append(failed,new Float32Array(2048));
  bad.consume=bad.predict=async()=>{throw Error('model failure');};await runWakeWordInference(failed,16000);
  assert(!failed.wakeDetectorEnabled&&!failed.wakeInferenceBusy,'failure disables detector and releases busy');
  assert(statuses.at(-1).includes('recording buttons'),'manual fallback reported');
 }
""")

    def test_late_inference_after_session_replacement_or_disarm_is_ignored(self):
        check(r"""
 for(const name of ['heed','voicute'])for(const change of ['replace','disarm']){
  const current=seed(),engine=install(name),gate=deferred();append(current,new Float32Array(2048));
  engine.consume=engine.predict=()=>gate.promise;const before=triggers.length,detectBefore=detections.length;
  const pending=runWakeWordInference(current,16000);
  if(change==='replace')seed();else clearWakeDetectorTimers(current);
  gate.resolve({triggered:true,word:'wake',prob:.99,consFrames:3,sigmoid:true});await pending;
  assert(triggers.length===before&&detections.length===detectBefore,'stale result cannot detect or trigger: '+name+'/'+change);
  assert(!current.wakeInferenceBusy,'old session busy released');
 }
""")

    def test_rearming_delay_reset_cancellation_and_guards(self):
        check(r"""
 const current=seed();install();append(current,[1,2,3]);
 scheduleWakeDetectorArm(current);const old=current.wakeRearmTimer;
 assert(!current.wakeDetectorEnabled&&timers.get(old).delay===650,'default rearm delay');
 scheduleWakeDetectorArm(current,0);assert(!timers.has(old),'previous timer cancelled');
 fireTimer(current.wakeRearmTimer);
 assert(current.wakeDetectorEnabled&&current.wakeRearmTimer===null&&resets===1,'arm resets engine once');
 assert(current.wakeCollectedSamples===0&&current.wakeRingPos===0&&current.wakeRing.every(v=>v===0),'arm clears old audio');
 for(const change of ['replace','discard','inactive','model','disabled','command']){
  const next=seed();install();settings.audioCommands=true;voiceController.active=false;
  scheduleWakeDetectorArm(next);
  if(change==='replace')seed();if(change==='discard')next.discard=true;if(change==='inactive')next.recorder.state='inactive';
  if(change==='model')wakeWord=null;if(change==='disabled')settings.audioCommands=false;if(change==='command')voiceController.active=true;
  const before=resets;fireTimer(next.wakeRearmTimer);assert(!next.wakeDetectorEnabled&&resets===before,'late arm guard '+change);
 }
 settings.audioCommands=true;voiceController.active=false;const next=seed();install();scheduleWakeDetectorArm(next);
 clearWakeDetectorTimers(next);assert(timers.size===0&&!next.wakeDetectorEnabled&&next.wakeRearmTimer===null,'clear cancels pending arm');
 wakeWord.engine.reset=()=>{throw Error('reset failed');};resetWakeAudioBuffer(next);
 assert(warnings.length===1,'reset failure contained');
""")

    def test_loading_selection_failure_and_obsolete_engine_results(self):
        check(r"""
 const current=seed();const first=initializeWakeWord();
 assert(loads[0].name==='heed'&&loads[0].options.threshold===.8,'Heed selected threshold');
 selectedWakeEngine='voicute';const second=initializeWakeWord();
 assert(loads[1].name==='voicute'&&loads[1].options.threshold===.9,'Voicute selected threshold');
 loads[0].resolve({phrase:'obsolete',engine:{}});await first;assert(wakeWord===null&&timers.size===0,'obsolete success ignored');
 const loaded={phrase:'Hey Friday',engine:{}};loads[1].resolve(loaded);await second;
 assert(wakeWord===loaded&&wakeWordPhrase==='Hey Friday'&&timers.get(current.wakeRearmTimer).delay===0,'selected readiness arms current session');
 clearWakeDetectorTimers(current);wakeWord=null;
 selectedWakeEngine='heed';const obsolete=initializeWakeWord();selectedWakeEngine='voicute';
 loads[2].reject(Error('obsolete failure'));await obsolete;assert(wakeWordLoadError===null,'obsolete failure ignored');
 const failed=initializeWakeWord(),error=Error('offline');loads[3].reject(error);await failed;
 assert(wakeWordLoadError===error&&timers.size===0&&statuses.at(-1).includes('recording buttons'),'current failure reported without arm');
 settings.audioCommands=false;const disabled=initializeWakeWord();loads[4].resolve(loaded);await disabled;
 assert(wakeWord===loaded&&timers.size===0,'disabled preference permits load but no arm');
""")

    def test_settings_threshold_engine_and_disable_integration(self):
        check(r"""
 const current=seed(),engine=install();
 settings.wakeThreshold=.83;changed({detail:settings});
 assert(engine.threshold===.83&&WAKE_THRESHOLD===.83,'live threshold forwarded');
 clearWakeDetectorTimers(current);settings.audioCommands=false;changed({detail:settings});
 assert(!current.wakeDetectorEnabled&&timers.size===0&&closeCalls===1,'disable closes commands and cancels arm');
 settings.audioCommands=true;settings.wakeEngine='voicute';changed({detail:settings});
 assert(wakeWord===null&&selectedWakeEngine==='voicute'&&loads[0].name==='voicute','engine switch clears old model and starts selected loader');
 loads[0].resolve({phrase:'Hey Friday',engine:{}});await flush();assert(wakeWordPhrase==='Hey Friday','new model becomes ready');
""")

    def test_current_async_edge_behaviors_are_explicitly_characterized(self):
        # Baseline observations, not desired guarantees. Review separately before fixing.
        check(r"""
 for(const name of ['heed','voicute']){
  const current=seed(),engine=install(name),gate=deferred();append(current,new Float32Array(2048));
  engine.consume=engine.predict=()=>gate.promise;const before=triggers.length;
  const pending=runWakeWordInference(current,16000);current.recorder.state='inactive';
  gate.resolve({triggered:true,word:'wake',prob:.99});await pending;
  assert(triggers.length===before+(name==='heed'?1:0),'current post-await state checks differ between engines');
 }
 const old=seed(),engine=install(),gate=deferred();append(old,new Float32Array(2048));engine.consume=()=>gate.promise;
 const pending=runWakeWordInference(old,16000);const next=seed();setWakeStatus('new session listening');
 gate.reject(Error('old model error'));await pending;
 assert(activeSession===next&&next.wakeDetectorEnabled&&statuses.at(-1).includes('Voice detection stopped'),'old error currently overwrites shared status');
 activeSession=null;wakeWord=null;selectedWakeEngine='heed';const a=initializeWakeWord();
 selectedWakeEngine='voicute';const b=initializeWakeWord();selectedWakeEngine='heed';const c=initializeWakeWord();
 loads[2].resolve({phrase:'new Heed',engine:{}});await c;loads[0].resolve({phrase:'old Heed',engine:{}});await a;
 assert(wakeWordPhrase==='old Heed','A-B-A load check currently compares engine name, not load generation');
 loads[1].resolve({phrase:'obsolete Voicute',engine:{}});await b;
""")


HEED_ADAPTER_HARNESS = COMMON + r"""
const instances=[],sessions=[],requests=[],progress=[];
let stepGate=null,stepError=null,fetchFails=false;
class WakeWordDetector {
 constructor(session,meta){this.session=session;this.meta=meta;this.chunks=[];this.resets=0;instances.push(this);}
 reset(){this.resets++;}
 async step(chunk){this.chunks.push(chunk);if(stepGate)await stepGate.promise;if(stepError)throw stepError;return {triggered:true,prob:.95};}
}
class URL {constructor(path,base){this.href=path==='./'?'https://test.invalid/js/heed/':String(base.href||base)+path;}}
const window={ort:{InferenceSession:{async create(url,options){sessions.push({url,options});return {id:sessions.length};}}}};
async function fetch(url){requests.push(url.href);return {ok:!fetchFails,status:503,async json(){return {threshold:.667,n_fft:512};}};}
"""


class WakeAdapterTests(unittest.TestCase):
    def test_extracted_loader_delegation_promise_identity_and_failure(self):
        self.assertIn('import { loadWakeDetector, evaluateWakeDetector } from "./wake-detector.js";', SOURCE)
        self.assertNotIn('import { loadHeedWakeWord }', SOURCE)
        self.assertNotIn('import { loadVoicuteWakeWord }', SOURCE)
        check(r"""
 const progress=()=>{};
 for(const [name,expected] of [['heed','heed'],['voicute','voicute'],['other','voicute']]){
  const promise=loadWakeDetector({engineName:name,threshold:.87,onStatus:progress});
  const call=loads.at(-1);
  assert(call.name===expected&&call.options.threshold===.87&&call.options.onStatus===progress,'adapter selection and options forwarded unchanged');
  assert(promise===call.promise,'adapter promise returned without extra async wrapper');
  const loaded={phrase:'wake phrase',engine:{}};call.resolve(loaded);
  assert(await promise===loaded,'model result returned unchanged');
 }
 const error=Error('model load failure'),pending=loadWakeDetector({engineName:'heed',threshold:.8,onStatus:progress});
 loads.at(-1).reject(error);let caught;try{await pending;}catch(e){caught=e;}
 assert(caught===error,'original rejection reaches recorder unchanged');
""", WAKE_LOADER)

    def test_heed_model_loading_normalization_pending_frames_and_reset(self):
        check(r"""
 const loaded=await loadHeedWakeWord({threshold:.81,onStatus:v=>progress.push(v)}),detector=instances[0];
 assert(loaded.phrase==='Hey Doc'&&detector.threshold===.81,'phrase and requested threshold');
 assert(requests[0].endsWith('/wake.json')&&sessions[0].url.endsWith('/wake.onnx'),'local model and metadata');
 assert(sessions[0].options.executionProviders.join(',')==='wasm'&&progress.length===1,'existing runtime and progress');
 let result=await loaded.engine.consume(new Float32Array(2048).fill(32767*.25),16000);
 assert(result.triggered&&detector.chunks[0].length===1600,'one 100ms frame processed per consume');
 equal(detector.chunks[0],new Float32Array(1600).fill(.25),'PCM normalized');
 await loaded.engine.consume(new Float32Array(2048).fill(32767*.5),16000);
 equal(detector.chunks[1].slice(0,448),new Float32Array(448).fill(.25),'leftover audio retained');
 equal(detector.chunks[1].slice(448),new Float32Array(1152).fill(.5),'new audio appended in order');
 loaded.engine.setThreshold(.9);assert(detector.threshold===.9,'threshold delegated');
 loaded.engine.reset();assert(detector.resets===1,'detector reset delegated');
 result=await loaded.engine.consume(new Float32Array(1599).fill(-32767),16000);
 assert(result===null&&detector.chunks.length===2,'reset cleared pending samples');
 await loaded.engine.consume(new Float32Array([-32767]),16000);
 equal(detector.chunks[2],new Float32Array(1600).fill(-1),'exact pending boundary after reset');
""", HEED_ADAPTER, HEED_ADAPTER_HARNESS)

    def test_heed_resampling_floor_and_interpolation(self):
        check(r"""
 const loaded=await loadHeedWakeWord(),detector=instances[0];
 for(const value of [.1,.2,.3])await loaded.engine.consume(new Float32Array(2048).fill(32767*value),48000);
 assert(detector.chunks.length===1,'three floor(2048/3)=682 pieces form one frame');
 equal(detector.chunks[0].slice(0,682),new Float32Array(682).fill(.1),'first resampled block');
 equal(detector.chunks[0].slice(682,1364),new Float32Array(682).fill(.2),'second resampled block');
 equal(detector.chunks[0].slice(1364),new Float32Array(236).fill(.3),'third partial block');
 loaded.engine.reset();
 const ramp=Float32Array.from({length:4410},(_,i)=>i);
 await loaded.engine.consume(ramp,44100);
 assert(detector.chunks[1].length===1600,'44.1kHz output length');
 for(const i of [0,1,7,500,1599])near(detector.chunks[1][i],i*2.75625/32767,'linear interpolation and normalization');
""", HEED_ADAPTER, HEED_ADAPTER_HARNESS)

    def test_heed_busy_and_failed_step_or_metadata(self):
        check(r"""
 const loaded=await loadHeedWakeWord(),detector=instances[0];stepGate=deferred();
 const first=loaded.engine.consume(new Float32Array(1600).fill(32767),16000);
 const skipped=await loaded.engine.consume(new Float32Array(1600).fill(-32767),16000);
 assert(skipped===null&&detector.chunks.length===1,'adapter independently rejects overlap');
 stepGate.resolve();await first;stepGate=null;stepError=Error('run failed');
 let error;try{await loaded.engine.consume(new Float32Array(1600),16000);}catch(e){error=e;}
 assert(error===stepError,'model error propagates to recorder');stepError=null;
 await loaded.engine.consume(new Float32Array(1600).fill(.5*32767),16000);
 assert(detector.chunks.length===3&&detector.chunks[2][0]===.5,'busy released after failure and skipped input not queued');
 fetchFails=true;error=null;try{await loadHeedWakeWord();}catch(e){error=e;}
 assert(String(error).includes('503')&&sessions.length===1,'metadata failure prevents model creation');
""", HEED_ADAPTER, HEED_ADAPTER_HARNESS)

    def test_voicute_loader_configuration_caching_and_retry(self):
        check(r"""
 const first=loadVoicuteWakeWord({threshold:.83,onStatus:v=>progress.push(v)});
 const concurrent=loadVoicuteWakeWord({threshold:.91});
 const [a,b]=await Promise.all([first,concurrent]);
 assert(a===b&&created.length===1,'concurrent loads share one engine');
 assert(a.phrase==='Hey Friday'&&a.loadedFriday&&a.threshold===.83,'first successful configuration retained');
 equal(created[0].calls.map(v=>v[1]),[.83,true,false,true,2000,false,false],'adapter threshold/layers/internal cooldown');
 assert(created[0].calls.map(v=>v[0]).join(',')==='setThreshold,setL1,setL2,setL3,setCooldown,setL4,setL5','configuration method order');
 assert(window.fetch!==originalFetch&&await window.fetch('unrelated')==='original:unrelated','fetch restored as bound delegate');
 const cached=await loadVoicuteWakeWord({threshold:.99});assert(cached===a&&created.length===1&&created[0].calls[0][1]===.83,'cached load does not reapply threshold');
 // Reset the module cache to exercise independent failure/retry paths.
 loadPromise=null;failLoads=2;let error;
 try{await loadVoicuteWakeWord();}catch(e){error=e;}
 assert(error&&created.length===3,'both public model attempts fail');
 assert(await window.fetch('after-failure')==='original:after-failure','fetch restored after load failure');
 const retry=await loadVoicuteWakeWord();assert(retry.loadedFriday&&created.length===4,'failed cache permits retry');
 loadPromise=null;failLoads=1;
 const fallback=await loadVoicuteWakeWord();
 assert(!fallback.loadedFriday&&fallback.phrase==='Fallback Phrase'&&created.length===6,'second-engine success uses reported model phrase');
""", VOICUTE_ADAPTER, COMMON + r"""
const created=[],progress=[];let failLoads=0;
const originalFetch=async value=>'original:'+value;
const window={ort:{},fetch:originalFetch,VoicuteWakeWord:{create(){
 const engine={calls:[],async load(info,mel){
  assert(info.endsWith('/models/en/model_info.json')&&mel.endsWith('/models/melspectrogram.onnx'),'model URLs');
  const response=await window.fetch(info),config=await response.json();
  assert(config.keywords[0]==='Hey Friday'&&config.cons_frames===3&&config.n_mels===32,'metadata override');
  if(failLoads>0){failLoads--;throw Error('model unavailable');}
 },getModels(){return [{name:'fallback_phrase'}];}};
 for(const name of ['setThreshold','setL1','setL2','setL3','setCooldown','setL4','setL5'])engine[name]=value=>engine.calls.push([name,value]);
 created.push(engine);return engine;
}}};
class Response {constructor(text){this.text=text;}async json(){return JSON.parse(this.text);}}
""")


HEED_DETECTOR_HARNESS = COMMON + r"""
let clock=0,logit=Math.log(3),runs=0;
const performance={now:()=>clock};
const ort={Tensor:class {constructor(type,data,shape){this.type=type;this.data=data;this.dims=shape;}}};
const session={async run(input){runs++;assert(input.mel.type==='float32'&&input.mel.dims.join(',')==='1,40,101','real feature tensor shape');assert(input.mel.data.every(Number.isFinite),'finite real mel features');return {logit:{data:[logit]}};}};
function tone(){return Float32Array.from({length:1600},(_,i)=>.1*Math.sin(2*Math.PI*1000*i/16000));}
"""


class HeedTriggerTests(unittest.TestCase):
    def test_real_preprocessor_raw_threshold_consecutive_frames_and_refractory(self):
        check(r"""
 const meta=JSON.parse(JSON.stringify(META));meta.threshold=.7;
 const detector=new WakeWordDetector(session,meta);
 assert(detector.consecutiveFrames===2&&detector.refractorySeconds===.7&&detector.emaAlpha===.5,'current metadata trigger settings');
 const first=await detector.step(tone());assert(!first.gated&&!first.triggered,'one crossing insufficient');
 const second=await detector.step(tone());assert(second.triggered&&second.ema<.7,'raw consecutive scores trigger before EMA crosses');
 clock=100;assert(!(await detector.step(tone())).triggered,'refractory blocks next frame');
 clock=700;assert(!(await detector.step(tone())).triggered,'exact cooldown boundary still blocked');
 clock=701;assert((await detector.step(tone())).triggered,'strictly beyond cooldown triggers');
 detector.reset();assert(detector.aboveCount===0&&detector.ema===0&&detector.lastTriggerTime===-Infinity,'reset clears trigger history');
 assert(detector.preprocessor.filteredBuffer.every(v=>v===0),'real filter buffer reset');
 logit=0;detector.threshold=.5;
 await detector.step(tone());await detector.step(tone());assert(detector.aboveCount===0,'probability equal to threshold does not count');
 logit=Math.log(3);await detector.step(tone());logit=0;await detector.step(tone());logit=Math.log(3);
 assert(!(await detector.step(tone())).triggered,'low score breaks consecutive run');
 assert((await detector.step(tone())).triggered,'two fresh crossings accepted');
""", HEED_PREPROCESSOR + HEED_DETECTOR + '\nconst META=' + HEED_META + ';', HEED_DETECTOR_HARNESS)

    def test_real_preprocessor_silence_gate_and_metadata_mismatch(self):
        check(r"""
 const detector=new WakeWordDetector(session,META);detector.ema=.8;detector.aboveCount=1;
 const result=await detector.step(new Float32Array(1600));
 assert(result.gated&&!result.triggered&&result.prob===0&&runs===0,'silence skips inference');
 assert(result.ema===.4&&detector.aboveCount===0,'gate decays EMA and breaks crossing run');
 const after=await detector.step(tone());assert(!after.gated&&runs===1&&!after.triggered,'continuous real filtering recovers after silence');
 let error;try{new WakeWordDetector(session,{...META,n_fft:256});}catch(e){error=e;}
 assert(String(error).includes('n_fft=256'),'incompatible preprocessing metadata fails loudly');
""", HEED_PREPROCESSOR + HEED_DETECTOR + '\nconst META=' + HEED_META + ';', HEED_DETECTOR_HARNESS)


if __name__ == '__main__':
    unittest.main()
