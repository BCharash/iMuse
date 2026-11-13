"""Exercise extracted production voice coordination and recorder bridges; no real models or microphone."""
from pathlib import Path
import unittest
from recording_test_support import SOURCE, between, evaluate

ROOT = Path(__file__).resolve().parents[1]
BUILD = (ROOT / 'js/build-info.js').read_text().replace('export ', '')
DIAGNOSTICS = (ROOT / 'js/voice-diagnostics.js').read_text()
DIAGNOSTICS = BUILD + '\n' + '\n'.join(line for line in DIAGNOSTICS.splitlines() if not line.startswith('import ')).replace('export ', '')
CONTROLLER = (ROOT / 'js/voice-controller.js').read_text()
CONTROLLER = '\n'.join(line for line in CONTROLLER.splitlines() if not line.startswith('import ')).replace('export ', '')
WAKE_LOADER = (ROOT / 'js/wake-detector.js').read_text()
WAKE_LOADER = '\n'.join(line for line in WAKE_LOADER.splitlines() if not line.startswith('import ')).replace('export ', '')
VOICE = between('// Recorder-owned capabilities:', 'function resetWakeAudioBuffer(')
FINALIZE = between('function finalizeRecording(', '// Silence duration')

def event_body(name, following):
    marker = f'        recorder.addEventListener("{name}", async () => {{'
    start = SOURCE.index(marker) + len(marker)
    return SOURCE[start:SOURCE.index(f'        }});\n        recorder.addEventListener("{following}"', start)]

PAUSE = event_body('pause', 'resume')
MANUAL = between('recordButton.addEventListener("click",', 'deleteButton.addEventListener("click",')

HARNESS = r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const console={warn(){},error(){}};
const speechDetector={reset(){}};
function prepareSpeechDetection(){}
function prepareSpokenResponses(){}
const order=[],listeners=[],prompts=[],arms=[],metadata=[];
let clock=0,activeSession=null,loadGate=null,startGate=null,stopGate=null,loadError=null,stopError=null;
let loads=0,shutdowns=0,promptGate=null,promptOK=true,beeps=0;
const performance={now:()=>clock},status={};
const settings={audioCommands:true,commandWindow:5,goThreshold:.8,stopThreshold:.8,yesThreshold:.8,noThreshold:.8};
function getSettings(){return settings;}
const deviceClass='desktop',effectiveOverlap=()=>.5,wakeWordPhrase='Hey Doc';
class Element {constructor(){this.firstChild={textContent:''};this.handlers={};}setAttribute(){}addEventListener(type,fn){this.handlers[type]=fn;}click(){return this.handlers.click();}}
const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
const recordButton=new Element(),pauseButton=new Element();
const intervals=new Map();let nextTimer=0;
function setInterval(fn){const id=++nextTimer;intervals.set(id,fn);return id;}
function clearInterval(id){intervals.delete(id);}
const window={setInterval};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<45;i++)await Promise.resolve();}
const model={};
async function loadCommands(){loads++;order.push('load');if(loadGate)await loadGate.promise;if(loadError)throw loadError;return model;}
async function startCommands(m,stream,overlap,callback){order.push('listen');listeners.push(callback);if(startGate)await startGate.promise;}
async function stopCommands(){shutdowns++;order.push('shutdown');if(stopGate)await stopGate.promise;if(stopError)throw stopError;}
async function playSpokenResponse(name){prompts.push(name);order.push('prompt:'+name);if(promptGate)await promptGate.promise;return {ok:promptOK,error:promptOK?null:Error('playback failed')};}
function setWakeStatus(text){status.wake=text;}
function stopPausedBeep(){order.push('beep-stop');}
function startPausedBeep(){beeps++;}
function clearWakeDetectorTimers(current){current.wakeDetectorEnabled=false;}
function scheduleWakeDetectorArm(current){arms.push(current.id);current.wakeDetectorEnabled=true;}
function logRecordingEvent(){}function setRecordingControlState(){}function armFinalizationWatchdog(){}
async function putSession(value){metadata.push({...value});}
function savedChunkProgress(){return 'saved audio';}
function primeSpokenResponses(){}
function startRecording(){throw Error('unexpected new capture');}
function seed(id,state='paused'){
 const current={id,stream:{id},metadata:{id,state},wakeDetectorEnabled:true,activeSinceMs:null,recordedMs:0};
 current.recorder={state,pauses:0,resumes:0,stops:0,pause(){this.pauses++;this.state='paused';current.pauseTask=productionPause(current);},resume(){this.resumes++;this.state='recording';},stop(){this.stops++;this.state='inactive';}};
 activeSession=current;return current;
}
"""
PRODUCTION = CONTROLLER + VOICE + FINALIZE + '\nasync function productionPause(current){' + PAUSE + '\n}\n' + MANUAL


def check(script):
    for diagnostics in [False, True]:
        enable = 'voiceDiagnostics.setEnabled('+str(diagnostics).lower()+');'
        evaluate(HARNESS + DIAGNOSTICS + PRODUCTION + "\nglobalThis.testResult='pending';\n(async()=>{\n" + enable + script + "\nglobalThis.testResult='PASS';\n})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));")


ANIMATION_MOCK = r"""
const animated=[];
for(const id of ['commandTimerLeft','commandTimerRight','commandAnimatedHand']) {
 document.getElementById(id).animate=(frames,options)=>{
  const animation={frames,options,currentTime:null,plays:0,pauses:0,cancelled:false,
   effect:{updateTiming(value){animation.timing=value;}},
   pause(){this.pauses++;},play(){this.plays++;},cancel(){this.cancelled=true;}};
  animated.push(animation);return animation;
 };
}
"""

class VoiceControlTests(unittest.TestCase):
    def test_countdown_preparation_is_idempotent_without_models_or_microphone(self):
        check(ANIMATION_MOCK+r"""
 settings.audioCommands=false;
 voiceController.prepareCountdown();voiceController.prepareCountdown();
 assert(animated.length===3&&animated.every(a=>a.plays===0&&a.pauses===1&&a.currentTime===0),'prepared once, paused at full circle');
 assert(loads===0&&listeners.length===0&&prompts.length===0,'visual preparation has no model, listener or audio side effects');
 voiceController.preload();await flush();assert(loads===0,'visual preparation does not change commands-disabled model policy');
""")

    def test_countdown_waits_for_slow_listener_and_gets_full_window(self):
        check(ANIMATION_MOCK+r"""
 const current=seed('slow-animated');voiceController.prepareCountdown();startGate=deferred();
 const opening=handleWakeDetected(current);await flush();
 assert(listeners.length===1&&animated.every(a=>a.plays===0)&&document.getElementById('commandListening').hidden,'circle stays hidden during preparation');
 listeners[0]({top:'go',go:.99});await flush();assert(current.recorder.resumes===0,'not accepting commands before readiness');
 clock=6000;startGate.resolve();await opening;
 assert(animated.every(a=>a.plays===1&&a.currentTime===0)&&!document.getElementById('commandListening').hidden,'circle begins full at readiness');
 assert(animated[0].timing.duration===2500&&animated[1].timing.delay===2500&&animated[2].timing.duration===5000,'full configured duration');
 assert(animated[2].frames[1].transform==='rotate(-360deg)','counterclockwise hand');
 clock=10999;for(const tick of [...intervals.values()])tick();assert(voiceController.active,'startup did not consume response time');
 clock=11000;for(const tick of [...intervals.values()])tick();await flush();
 assert(!voiceController.active&&document.getElementById('commandListening').hidden&&animated.every(a=>a.currentTime===0),'expiry hides and resets circle');
""")

    def test_cancel_during_listener_start_does_not_show_a_stale_window(self):
        check(ANIMATION_MOCK+r"""
 voiceController.prepareCountdown();startGate=deferred();
 const current=seed('cancel-startup'),opening=handleWakeDetected(current);await flush();
 voiceController.close();startGate.resolve();await opening;
 assert(!voiceController.active&&document.getElementById('commandListening').hidden,'cancelled startup cannot show countdown');
 assert(animated.every(a=>a.plays===0&&a.currentTime===0),'cancelled startup never starts animation');
""")

    def test_confirmation_animation_waits_for_listener_ready_and_cleans_up(self):
        check(ANIMATION_MOCK+r"""
 const current=seed('confirm-animated');await handleWakeDetected(current);
 startGate=deferred();listeners[0]({top:'stop',stop:.99});await flush();
 assert(listeners.length===2&&animated.every(a=>a.plays===1&&a.currentTime===0),'confirmation animation is reset during preparation');
 assert(document.getElementById('commandListening').hidden,'confirmation circle hidden during preparation');
 listeners[1]({top:'yes',yes:.99});await flush();assert(current.recorder.stops===0,'confirmation not accepted before readiness');
 clock=2300;startGate.resolve();await flush();
 assert(animated.every(a=>a.plays===2&&a.currentTime===0)&&!document.getElementById('commandListening').hidden,'confirmation circle starts from readiness');
 voiceController.close();assert(animated.every(a=>a.currentTime===0),'close resets all animations');
""")

    def test_idle_status_tracks_preference_and_async_readiness(self):
        handler=SOURCE[SOURCE.index('window.addEventListener("imuse-settings-changed"'):SOURCE.index('window.deviceClass = deviceClass;')]
        idle=between('function refreshIdleWakeStatus()', 'function setLifecycleStatus(')
        initialize=between('async function initializeWakeWord()', '// Recorder-owned capabilities:')
        evaluate(r"""
globalThis.testResult='pending';const assert=(v,m)=>{if(!v)throw Error(m);};
const speechDetector={reset(){}};function prepareSpeechDetection(){}
function prepareSpokenResponses(){}
let activeSession=null,wakeWord=null,wakeWordLoadError=null,selectedWakeEngine='heed',WAKE_THRESHOLD=.8,wakeWordPhrase='Hey Doc',text='';
let wakeModelLoadGeneration=0,wakeModelLoading=false;
const settings={audioCommands:true,wakeEngine:'heed',wakeThreshold:.8,voicuteThreshold:.9},getSettings=()=>settings;
const voiceController={suspended:false,active:false,setSuspended(value){this.suspended=value;}};
const setWakeStatus=value=>text=value,closeCommandWindow=()=>{},clearWakeDetectorTimers=()=>{},syncAudioCommandsSuspension=()=>{},preloadCommandModel=()=>{},scheduleWakeDetectorArm=()=>{};
let changed,resolveModel,rejectModel;const window={addEventListener:(name,fn)=>changed=fn};
let progress;const loadHeedWakeWord=({onStatus})=>{progress=onStatus;return new Promise((resolve,reject)=>{resolveModel=resolve;rejectModel=reject;});};
const loadVoicuteWakeWord=loadHeedWakeWord;
"""+WAKE_LOADER+idle+initialize+handler+r"""
(async()=>{
 settings.audioCommands=false;changed({detail:settings});assert(text.includes('disabled for the next recording'),'idle disable refreshes immediately');
 settings.audioCommands=true;changed({detail:settings});assert(text.includes('enabled for the next recording')&&text.includes('Preparing'),'idle enable clears stale disabled status before recording');
 const pending=initializeWakeWord();settings.audioCommands=false;changed({detail:settings});progress('Model download progress');assert(text.includes('disabled for the next recording'),'late loading progress respects current preference');
 resolveModel({phrase:'Hey Doc',engine:{}});await pending;assert(text.includes('disabled for the next recording'),'late model readiness cannot overwrite disabled setting');
 settings.audioCommands=true;changed({detail:settings});assert(text.includes('enabled for the next recording')&&text.includes('Hey Doc'),'ready model is reflected on idle re-enable');
 voiceController.suspended=true;refreshIdleWakeStatus();assert(text.includes('suspended for the next recording'),'temporary suspension is reflected while idle');voiceController.suspended=false;
 activeSession={};voiceController.active=true;text='Listening for Go or Stop';changed({detail:settings});assert(text==='Listening for Go or Stop','idle updater leaves active command status alone');activeSession=null;voiceController.active=false;
 wakeWord=null;const failed=initializeWakeWord();rejectModel(Error('offline'));await failed;assert(text.includes('enabled for the next recording')&&text.includes('unavailable'),'readiness errors do not masquerade as a disabled preference');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack||''));
""")

    def test_suspend_blocks_actions_and_keeps_manual_controls(self):
        check(r"""
 const current=seed('suspended','recording');const preference=settings.audioCommands;
 voiceController.setSuspended(true);await handleWakeDetected(current);
 assert(voiceController.suspended&&current.recorder.pauses===0&&listeners.length===0&&prompts.length===0,'suspended wake cannot pause capture or start command flow');
 assert(current.wakeDetectorEnabled&&settings.audioCommands===preference&&shutdowns===0,'idle suspension leaves detection and saved preference intact');
 recordButton.click();await current.pauseTask;assert(current.recorder.state==='paused','manual Pause still works');
 await voiceController.resume(getVoiceSession(current));assert(current.recorder.resumes===1,'manual Resume still works during suspension');
 voiceController.setSuspended(false);await handleWakeDetected(current);assert(listeners.length===1,'resume allows a fresh wake episode');
 voiceController.setSuspended(true);const stale=listeners[0];stale({top:'go',go:.99});stale({top:'stop',stop:.99});await flush();
 assert(current.recorder.resumes===1&&current.recorder.stops===0&&!voiceController.active,'suspension invalidates old command callbacks');
 pauseButton.click();assert(current.recorder.stops===1,'manual Stop is independent of voice suspension');
""")

    def test_suspend_cancels_pending_confirmation_and_go(self):
        for phase in ['acknowledgement','loading','confirmation','go-shutdown']:
            with self.subTest(phase=phase):
                check("const phase="+repr(phase)+r""";
 const current=seed('pending');
 if(phase==='acknowledgement')promptGate=deferred();
 if(phase==='loading')loadGate=deferred();
 const opening=handleWakeDetected(current);await flush();
 if(phase==='confirmation'){await opening;listeners[0]({top:'stop',stop:.99});await flush();assert(listeners.length===2,'confirmation listener is ready');}
 if(phase==='go-shutdown'){await opening;stopGate=deferred();listeners[0]({top:'go',go:.99});await flush();}
 const stale=[...listeners];voiceController.setSuspended(true);voiceController.setSuspended(false);
 promptGate?.resolve();loadGate?.resolve();stopGate?.resolve();await opening;await flush();
 for(const callback of stale){callback({top:'yes',yes:.99});callback({top:'go',go:.99});callback({top:'stop',stop:.99});}await flush();
 assert(current.recorder.stops===0&&current.recorder.resumes===0&&!voiceController.active,'suspend/resume cannot revive queued Go or Yes or pending startup');
 assert(current.wakeDetectorEnabled,'wake detection remains available after command cancellation');
""")

    def test_recording_wake_waits_for_pause_prompt_and_go_shutdown(self):
        check(r"""
 const current=seed('recording','recording');promptGate=deferred();
 const opening=handleWakeDetected(current);await flush();
 assert(current.recorder.pauses===1&&loads===0&&listeners.length===0,'wake pauses and awaits completed pause announcement before recognition');
 await handleWakeDetected(current);assert(current.recorder.pauses===1,'duplicate wake cannot enter a second command window');
 promptGate.resolve();await opening;
 assert(prompts.join(',')==='pause'&&listeners.length===1,'recording wake has one Pause cue, with no extra Yes cue');
 stopGate=deferred();listeners[0]({top:'go',go:.99});await flush();
 assert(current.recorder.resumes===0,'Go waits for listener shutdown');
 stopGate.resolve();await flush();
 assert(current.recorder.resumes===1&&!voiceController.active,'Go resumes original recorder after shutdown');
 listeners[0]({top:'stop',stop:.99});await flush();
 assert(current.recorder.stops===0,'closed-window callback cannot act');
""")

    def test_paused_wake_and_nonwake_manual_silence_pauses(self):
        check(r"""
 const current=seed('manual','recording');recordButton.click();await current.pauseTask;
 assert(loads===0&&listeners.length===0&&!voiceController.active&&prompts.join(',')==='pause','manual pause never enters recognition');
 assert(arms.includes('manual')&&beeps===1,'manual pause retains wake rearming and reminder');
 const silent=seed('silence','recording');silent.pauseReason='silence';silent.recorder.pause();await silent.pauseTask;
 assert(loads===0&&listeners.length===0&&status.textContent.includes('automatically'),'silence pause stays separate from command entry');
 await handleWakeDetected(silent);
 assert(prompts.at(-1)==='yes'&&silent.recorder.pauses===1&&listeners.length===1,'wake on paused capture acknowledges without pausing twice');
 assert(order.indexOf('prompt:yes')<order.indexOf('listen'),'paused acknowledgement precedes command listening');
""")

    def test_stop_confirmation_yes_no_and_timeout(self):
        for answer in ['yes', 'no', 'timeout']:
            with self.subTest(answer=answer):
                check(r"""
 const current=seed('confirm');await handleWakeDetected(current);
 promptGate=deferred();listeners[0]({top:'stop',stop:.99});await flush();
 assert(current.recorder.stops===0&&listeners.length===1&&prompts.at(-1)==='confirmStop','Stop stays provisional while confirmation prompt plays');
 assert(order.lastIndexOf('shutdown')<order.lastIndexOf('prompt:confirmStop'),'previous listener shuts down before confirmation prompt');
 promptGate.resolve();await flush();assert(listeners.length===2,'Yes/No listener opens after prompt completion');
 const confirmation=listeners[1];
""" + (r"""
 confirmation({top:'yes',yes:.99});await flush();
 assert(current.recorder.stops===1&&current.stopIntent==='voice-stop-confirmed-yes','only explicit Yes finalizes');
 confirmation({top:'yes',yes:.99});assert(current.recorder.stops===1,'duplicate Yes cannot finalize twice');
""" if answer == 'yes' else r"""
 confirmation({top:'no',no:.99});await flush();
 assert(current.recorder.state==='paused'&&current.recorder.stops===0&&!voiceController.active,'No preserves paused capture');
 assert(arms.includes(current.id),'No rearms wake detector');
""" if answer == 'no' else r"""
 clock=6000;for(const tick of [...intervals.values()])tick();await flush();
 assert(current.recorder.state==='paused'&&current.recorder.stops===0&&!voiceController.active,'confirmation timeout preserves paused capture');
 confirmation({top:'yes',yes:.99});assert(current.recorder.stops===0,'expired confirmation cannot stop later');
"""))

    def test_go_stop_thresholds_and_command_timeout(self):
        check(r"""
 const current=seed('thresholds');await handleWakeDetected(current);
 listeners[0]({top:'go',go:.79});listeners[0]({top:'stop',stop:.79});await flush();
 assert(current.recorder.resumes===0&&current.recorder.stops===0&&listeners.length===1,'below-threshold commands do nothing');
 clock=6000;for(const tick of [...intervals.values()])tick();await flush();
 assert(!voiceController.active&&intervals.size===0&&current.recorder.state==='paused'&&arms.includes(current.id),'command timeout closes listener and rearms wake without resuming');
""")

    def test_manual_stop_during_startup_and_stale_session_callbacks(self):
        for phase in ['loading', 'listening', 'confirmation']:
            with self.subTest(phase=phase):
                check("const phase=" + repr(phase) + r""";
 const old=seed('old');
 if(phase==='loading')loadGate=deferred();
 if(phase==='listening')startGate=deferred();
 const opening=handleWakeDetected(old);await flush();
 if(phase==='confirmation'){await opening;listeners[0]({top:'stop',stop:.99});await flush();assert(listeners.length===2,'confirmation is active');}
 const stale=[...listeners];pauseButton.click();
 assert(old.recorder.stops===1&&old.stopIntent==='stop-button'&&!voiceController.active,'manual Stop finalizes immediately without spoken confirmation');
 const next=seed('next','recording');loadGate?.resolve();startGate?.resolve();await opening;await flush();
 for(const callback of stale){callback({top:'yes',yes:.99});callback({top:'go',go:.99});callback({top:'stop',stop:.99});}await flush();
 assert(next.recorder.stops===0&&next.recorder.pauses===0&&next.recorder.resumes===0,'old callbacks cannot affect replacement session');
 assert(!voiceController.active&&intervals.size===0,'late startup cannot reopen command window');
""")

    def test_voice_failures_preserve_manual_control(self):
        for failure in ['load', 'prompt', 'shutdown']:
            with self.subTest(failure=failure):
                check("const failure=" + repr(failure) + r""";
 const current=seed('failure');
 if(failure==='load'){loadError=Error('model failed');await handleWakeDetected(current);}
 if(failure==='prompt'){await handleWakeDetected(current);promptOK=false;listeners[0]({top:'stop',stop:.99});await flush();assert(listeners.length===1,'failed confirmation prompt never opens Yes/No listener');}
 if(failure==='shutdown'){await handleWakeDetected(current);stopError=Error('shutdown failed');await resumeAfterCommandShutdown(current);assert(current.recorder.resumes===0,'failed shutdown cannot resume capture');}
 assert(current.recorder.state==='paused'&&current.recorder.stops===0&&!voiceController.active,'voice subsystem failure leaves original audio paused');
 pauseButton.click();assert(current.recorder.stops===1&&current.stopIntent==='stop-button','manual Stop still works after voice failure');
""")

    def test_manual_resume_uses_same_shutdown_order(self):
        check(r"""
 const current=seed('resume');stopGate=deferred();recordButton.click();await flush();
 assert(current.recorder.resumes===0,'manual Resume also awaits command shutdown');
 stopGate.resolve();await flush();assert(current.recorder.resumes===1,'manual Resume completes after shutdown');
""")

    def test_disabled_wake_and_cancellation_during_prompt_or_resume(self):
        check(r"""
 const old=seed('old');settings.audioCommands=false;await handleWakeDetected(old);
 assert(!voiceController.active&&prompts.length===0&&loads===0,'disabled voice controls cannot enter command mode');
 settings.audioCommands=true;promptGate=deferred();const opening=handleWakeDetected(old);await flush();
 pauseButton.click();const next=seed('next','recording');promptGate.resolve();await opening;
 assert(loads===0&&listeners.length===0&&next.recorder.state==='recording','cancelled acknowledgement cannot start recognition for replacement session');
 promptGate=null;const paused=seed('paused');stopGate=deferred();const resuming=resumeAfterCommandShutdown(paused);await flush();
 pauseButton.click();const replacement=seed('replacement','recording');stopGate.resolve();await resuming;
 assert(paused.recorder.resumes===0&&replacement.recorder.resumes===0,'pending Resume cannot run after manual Stop or session replacement');
""")

    def test_recorder_session_capabilities_stay_current_and_narrow(self):
        check(r"""
 const first=seed('first');const view=getVoiceSession(first);
 assert(view===getVoiceSession(first)&&getVoiceSession(null)===null,'session capability identity remains stable');
 assert(!('recorder' in view)&&!('metadata' in view)&&!('pendingChunks' in view)&&!('recordingLease' in view),'controller cannot access recording storage or lifecycle internals');
 assert(view.state==='paused'&&view.isCurrent&&view.stream===first.stream,'borrowed state and stream reflect original session');
 first.metadata.state='finalizing';assert(view.finalizing,'finalization state is observed without exposing metadata');
 await resumeAfterCommandShutdown(first);assert(first.recorder.resumes===0,'finalizing recorder cannot resume');
 const second=seed('second','recording');assert(!view.isCurrent,'old view observes session replacement');
 view.finalize('old-callback');assert(second.recorder.stops===0&&first.recorder.stops===0,'old finalization capability cannot stop replacement session');
""")

    def test_both_listener_windows_begin_after_startup_and_reject_expired_commands(self):
        check(r"""
 const current=seed('deadlines');startGate=deferred();
 const opening=handleWakeDetected(current);await flush();assert(listeners.length===1,'Go/Stop startup pending');
 clock=6000;startGate.resolve();await opening;
 clock=10999;listeners[0]({top:'stop',stop:.99});await flush();
 assert(listeners.length===2&&current.recorder.stops===0,'Stop accepted near end of full post-startup window');
 startGate=null;clock=12000;await flush();
 // The confirmation is already ready, with its own deadline based on its startup.
 clock=16000;listeners[1]({top:'yes',yes:.99});await flush();
 assert(current.recorder.stops===0,'late Yes cannot finalize after confirmation deadline');
 for(const tick of [...intervals.values()])tick();await flush();
 assert(!voiceController.active&&current.recorder.state==='paused','expired confirmation closes and stays paused');
""")

    def test_diagnostic_scores_window_linking_and_quiet_window(self):
        check(r"""
 voiceDiagnostics.setEnabled(true);settings.stopThreshold=.7;
 const current=seed('diagnostic-session');await handleWakeDetected(current);
 clock=4200;listeners[0]({top:'stop',topScore:.72,go:.01,stop:.72,yes:.01,no:.01});await flush();
 const snapshot=voiceDiagnostics.snapshot();
 const prediction=snapshot.events.find(e=>e.type==='command-prediction');
 const accepted=snapshot.events.find(e=>e.type==='command-accepted'&&e.command==='stop');
 assert(prediction.scores.stop===.72&&prediction.scores.topScore===.72&&prediction.thresholds.stop===.7&&prediction.elapsedMs===4200,'observed classifier score, effective threshold and late-window timing remain distinct');
 assert(prediction.sessionId===current.id&&prediction.windowId===accepted.windowId&&prediction.generation===accepted.generation,'prediction and acceptance share stable session/window/generation');
 assert(snapshot.events.some(e=>e.type==='listener-shutdown-request'&&e.windowId===accepted.windowId),'confirmation shutdown remains associated with original Go/Stop listener');
 assert(snapshot.events.some(e=>e.type==='listener-start-request')&&snapshot.events.some(e=>e.type==='listener-ready')&&snapshot.events.some(e=>e.type==='prompt-start'&&e.prompt==='confirmStop')&&snapshot.events.some(e=>e.type==='listener-shutdown-complete'),'listener and prompt lifecycle are recorded');
 assert(current.recorder.stops===0,'observed Stop remains provisional');
 assert(snapshot.events.some(e=>e.type==='command-window-created'&&e.phase==='yes-no'&&e.windowId!==accepted.windowId),'confirmation has a distinct window without changing original acceptance');
 const no=listeners.at(-1);no({top:'no',no:.99});await flush();
 await handleWakeDetected(current);clock=10200;for(const tick of [...intervals.values()])tick();await flush();
 assert(voiceDiagnostics.snapshot().events.some(e=>e.type==='command-window-timeout'&&e.phase==='go-stop'),'uneventful windows are retained for exposure comparisons');
 voiceDiagnostics.setEnabled(false);const count=voiceDiagnostics.size;listeners.at(-1)({top:'stop',stop:.99});await flush();
 assert(voiceDiagnostics.size===count,'disabled diagnostics stop observation');
""")

    def test_adapter_clone_startup_cancellation_and_failure_cleanup(self):
        adapter=(ROOT/'js/tensorflow/commands-adapter.js').read_text().replace('export ', '')
        evaluate(r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
let acquisitions=0,originalStops=0,cloneStops=0,callbacks=0;
const original=async()=>{acquisitions++;return {camera:true};},navigator={mediaDevices:{getUserMedia:original}};
class MediaStream {constructor(tracks){this.tracks=tracks;}}
const track={readyState:'live',stop(){originalStops++;},clone(){return {stop(){cloneStops++;}};}},stream={getAudioTracks:()=>[track]};
const window={};
""" + adapter + r"""
(async()=>{
 let listening=false,deliver,borrowed,stops=0;const starting=deferred();
 const recognizer={isListening:()=>listening,async listen(callback){deliver=callback;borrowed=await navigator.mediaDevices.getUserMedia({audio:true});await starting.promise;listening=true;},async stopListening(){stops++;listening=false;borrowed.tracks.forEach(t=>t.stop());}};
 const model={recognizer,labels:['go','stop','yes','no']};
 const opening=startCommands(model,stream,.5,()=>callbacks++);await flush();
 assert(acquisitions===0&&borrowed.tracks[0]!==track,'recognizer receives a clone without reacquiring original microphone');
 const camera=await navigator.mediaDevices.getUserMedia({video:true});assert(camera.camera&&acquisitions===1,'non-audio requests retain original routing');
 let duplicateRejected=false;try{await startCommands(model,stream,.5,()=>{});}catch(error){duplicateRejected=true;}
 assert(duplicateRejected,'duplicate listener startup is rejected');
 deliver({scores:[1,0,0,0]});assert(callbacks===1,'current-generation recognition callback is delivered');
 const closing=stopCommands(model);deliver({scores:[1,0,0,0]});assert(callbacks===1,'Stop invalidates callbacks before startup completes');
 assert(stops===0,'shutdown waits pending listener startup');starting.resolve();await Promise.all([opening,closing]);
 assert(stops===1&&cloneStops===1&&originalStops===0,'recognizer teardown releases only borrowed clone');
 assert(navigator.mediaDevices.getUserMedia===original,'global media API restored after startup');
 await stopCommands(model);assert(stops===1,'repeated shutdown is harmless');
 const failing={recognizer:{isListening:()=>false,async listen(){throw Error('listen failed');}},labels:model.labels};
 let failed=false;try{await startCommands(failing,stream,.5,()=>{});}catch(error){failed=true;}
 assert(failed&&navigator.mediaDevices.getUserMedia===original,'startup rejection restores API');
 track.readyState='ended';const dead={recognizer:{isListening:()=>false,listen:()=>navigator.mediaDevices.getUserMedia({audio:true})},labels:model.labels};
 failed=false;try{await startCommands(dead,stream,.5,()=>{});}catch(error){failed=true;}
 assert(failed&&acquisitions===1&&navigator.mediaDevices.getUserMedia===original,'dead shared track fails without silently opening another microphone');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")


if __name__ == '__main__':
    unittest.main()
