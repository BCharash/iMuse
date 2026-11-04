"""Temporary pre-recording level capture, cancellation, and recording handoff."""
from pathlib import Path
import unittest
from recording_test_support import evaluate, MOCKS, FUNCTIONS

ROOT=Path(__file__).resolve().parents[1]
CHECK=(ROOT/'js/microphone-level-check.js').read_text().replace('export ', '')
HARNESS=r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
const states=[],released=[],contexts=[],processing=[];let busy=false,acquisitions=0,acquisitionGate=null,resumeGate=null,closeGate=null;
const timers=new Map();let serial=0;
function makeStream(id){const track={readyState:'live',stops:0,handlers:{},stop(){this.stops++;this.readyState='ended';},addEventListener(type,fn){this.handlers[type]=fn;}};return {id,track,getAudioTracks:()=>[track],getTracks:()=>[track]};}
function createContext(){const context={state:'running',closes:0,disconnects:0,resume:()=>resumeGate?resumeGate.promise:Promise.resolve(),createMediaStreamSource:()=>({connect(){},disconnect(){context.disconnects++;}}),createAnalyser:()=>({}),close(){this.closes++;this.state='closed';return closeGate?closeGate.promise:Promise.resolve();}};contexts.push(context);return context;}
function createCheck(){return createMicrophoneLevelCheck({acquire:async current=>{acquisitions++;return acquisitionGate?await acquisitionGate.promise:makeStream('stream-'+acquisitions);},release:stream=>{released.push(stream.id);stream.getTracks().forEach(t=>t.stop());},createContext,now:()=>0,isRecordingBusy:()=>busy,publishProcessing:(stream,live)=>processing.push({id:stream.id,live}),onChange:state=>states.push(state),setTimer:(fn,ms)=>{assert(ms===10000,'measurement deadline is ten seconds');const id=++serial;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id)});}
"""

def check(script):
    evaluate(CHECK+HARNESS+"\nglobalThis.testResult='pending';(async()=>{\n"+script+"\nglobalThis.testResult='PASS';})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));")

class MicrophoneLevelCheckTests(unittest.TestCase):
    def test_timed_capture_cleanup_and_recording_reuse(self):
        check(r"""
 const preview=createCheck();assert(acquisitions===0&&!preview.source,'no startup microphone acquisition');
 busy=true;await preview.start();assert(acquisitions===0,'active recording is left to existing meter without another acquisition');busy=false;
 await preview.start();const stream=preview.source.stream;
 assert(preview.state.endsAtMs===10000&&preview.state.phase==='checking'&&contexts.length===1&&preview.source.analyser.fftSize===2048,'explicit check creates one temporary analyser');
 assert(processing[0].live&&processing[0].id===stream.id,'processing report identifies preview input');
 await preview.start();assert(acquisitions===1,'repeated start cannot duplicate capture');
 [...timers.values()][0]();await flush();
 assert(!preview.source&&preview.state.phase==='idle'&&stream.track.stops===1&&contexts[0].closes===1&&contexts[0].disconnects===1,'deadline disposes of every owned audio resource');
 assert(processing.at(-1).live===false&&timers.size===0,'last-acquired report and timer cleanup survive stop');
 await preview.stop();assert(stream.track.stops===1&&contexts[0].closes===1,'repeated stop does not close resources twice');
""")

    def test_cancelled_permission_and_failed_setup(self):
        check(r"""
 const preview=createCheck();acquisitionGate=deferred();const opening=preview.start();await preview.stop();
 assert(preview.state.phase==='idle'&&contexts.length===0,'cancellation does not wait for microphone permission');
 busy=true;const late=makeStream('late');acquisitionGate.resolve(late);await opening;
 assert(late.track.stops===1&&contexts.length===0&&!preview.source,'late permission stream is released without creating analysis');
 busy=false;acquisitionGate=deferred();const rejected=preview.start();acquisitionGate.reject(Error('permission denied'));await rejected;
 assert(preview.state.phase==='idle'&&preview.state.message.includes('permission denied'),'permission errors are visible and retry remains available');
 acquisitionGate=null;resumeGate=deferred();const broken=preview.start();await flush();resumeGate.reject(Error('resume failed'));await broken;
 assert(contexts.at(-1).closes===1&&released.includes('stream-3'),'setup failure releases stream and context');
""")

    def test_late_resume_cannot_stop_new_check_or_recording(self):
        check(r"""
 const preview=createCheck();resumeGate=deferred();const oldResume=resumeGate;
 const opening=preview.start();await flush();closeGate=deferred();const cleanup=preview.stop();await flush();
 const twice=preview.stop();assert(contexts[0].closes===1&&preview.state.phase==='closing','concurrent cleanup has one owner');
 await preview.start();assert(acquisitions===1,'new check waits for prior context cleanup');
 closeGate.resolve();await Promise.all([cleanup,twice]);closeGate=null;resumeGate=null;
 await preview.start();const replacement=preview.source;
 oldResume.resolve();await opening;
 assert(preview.source===replacement&&replacement.stream.track.stops===0,'late old-context resume cannot stop a newer check');
 busy=true;await preview.stop();assert(!preview.source&&replacement.stream.track.stops===1,'recording transition releases only preview-owned resources');
""")

    def test_timeout_releases_microphone_even_if_context_resume_hangs(self):
        check(r"""
 const preview=createCheck();resumeGate=deferred();const pending=resumeGate;const opening=preview.start();await flush();
 assert(timers.size===1&&preview.state.phase==='opening','microphone has a deadline even before analysis is ready');
 [...timers.values()][0]();await flush();
 assert(contexts[0].closes===1&&released.length===1&&preview.state.phase==='idle','hung analysis cannot keep microphone indefinitely');
 pending.resolve();await opening;assert(!preview.source&&contexts[0].closes===1,'late resume cannot resurrect timed-out check');
""")

    def test_recording_start_awaits_check_shutdown(self):
        evaluate(MOCKS+FUNCTIONS+r"""
globalThis.testResult='pending';
(async()=>{
 db={};let releaseCheck;microphoneLevelCheck.stop=()=>new Promise(resolve=>releaseCheck=resolve);
 const starting=startRecording();for(let i=0;i<15;i++)await Promise.resolve();
 assert(leaseAcquisitions===0,'recording does not acquire storage/microphone before preview cleanup');
 releaseCheck();await starting;
 assert(leaseAcquisitions===1&&leaseReleases===1&&status.textContent.includes('permission rejected'),'recording continues through normal guarded startup after preview release');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")

    def test_manager_cancelled_check_does_not_replace_recording_ownership(self):
        manager=(ROOT/'js/microphone-manager.js').read_text()
        manager='\n'.join(line for line in manager.splitlines() if not line.startswith('import ')).replace('export ', '')
        evaluate(HARNESS+r"""
const document={getElementById:()=>null,addEventListener(){}};
const localStorage={getItem:()=>''},window={};
const getSettings=()=>({autoGainControl:false,noiseSuppression:true,echoCancellation:true}),setMicrophoneProcessingLocked=()=>{};
const requests=[];const navigator={mediaDevices:{enumerateDevices:async()=>[],getUserMedia:request=>{const gate=deferred();requests.push({request,gate});return gate.promise;}}};
"""+manager+r"""
globalThis.testResult='pending';(async()=>{
 let valid=true;const old=acquireRecordingMicrophone({purpose:'level-check',isCurrent:()=>valid}).catch(error=>error);await flush();
 valid=false;const recording=acquireRecordingMicrophone();await flush();
 const live=makeStream('recording');live.track.getSettings=()=>({});requests[1].gate.resolve(live);await recording;
 const late=makeStream('old-preview');late.track.getSettings=()=>({});requests[0].gate.resolve(late);const result=await old;
 assert(result instanceof Error&&late.track.stops===1&&ownedStream===live&&live.track.stops===0,'late canceled acquisition cannot publish itself over the recording owner');
 assert(requests[0].request.audio.autoGainControl.ideal===false&&requests[0].request.audio.noiseSuppression.ideal===true,'preview uses same processing preferences');
 releaseRecordingMicrophone(live);assert(live.track.stops===1,'recording still has its ordinary release path');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")

if __name__=='__main__':unittest.main()
