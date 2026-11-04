"""Standalone recorder, speech gate, DSP, filenames and offline asset integrity."""
import hashlib
import json
from pathlib import Path
import re
import unittest
from recording_test_support import evaluate

ROOT = Path(__file__).resolve().parents[1]
CORE = (ROOT / 'js/lab/core.js').read_text().replace('export ', '')
CAPTURE = (ROOT / 'js/lab/capture.js').read_text().replace('export ', '')


class RecorderLabTests(unittest.TestCase):
    def test_resampling_speech_gate_and_filenames(self):
        evaluate(CORE + r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
assert(diagnosticEvent('wake',{type:'measurement',prob:.8}).type==='wake','engine message type cannot overwrite wake-event classification');
const prefix=datePrefix(new Date(2026,10,4,9,5,2));
assert(prefix==='2026-11-04_09-05-02','local date and time always lead filename');
assert(filename(prefix,'Title: Garden irrigation, plans!','m4a')===prefix+'_Garden-irrigation-plans.m4a','title marker and unsafe punctuation are removed');
assert(filenameKeywords('Today I want to talk about garden irrigation and plans for the garden')==='garden-irrigation-plans','suppress common words and repetition within the opening sentence');
assert(filenameKeywords('Well this is just a note about the garden and the irrigation schedule.')==='note-garden-irrigation-schedule','common words do not occupy the filename word limit');
assert(filenameKeywords('Well this is it. The garden needs water.')==='garden-needs-water','a filler-only first sentence allows the second sentence');
assert(filenameKeywords('The pump is not working at 12 volts.')==='pump-not-working-12-volts','negations and numbers retain meaning');
assert(filenameKeywords('Garden irrigation plans. Budget review. Completely unrelated architecture architecture architecture.')==='Garden-irrigation-plans','later topics cannot pollute the opening title');
assert(filenameKeywords('Hey Doc. Today I want to talk about garden irrigation.')==='garden-irrigation','skip a greeting within the first two sentences');
assert(filenameKeywords('Hey Doc. Hey Doc. Third sentence topic.')==='','never mine the third sentence for keywords');
assert(filenameKeywords('Hey Doc. Hey Doc. Please record this.')==='','wake phrases and filler do not become a title');
assert(filenameKeywords('Architecture architecture budget schedule review extra').length<=48,'keyword suffix stays short');
assert(filename(prefix,'','webm')===prefix+'.webm','empty recognition preserves usable date-only name');
assert(interruptedMessage({captureError:'Microphone ended',audio:{size:0}}).includes('No audio was captured'),'zero-byte interruption is reported honestly');
assert(interruptedMessage({captureError:'Microphone ended',audio:{size:20}}).includes('Available audio'),'retained data is distinguished from empty metadata');
assert(audioExtension('audio/webm;codecs=opus')==='webm'&&audioExtension('audio/mp4')==='m4a','extension follows actual recorder encoding');
const samples=Float32Array.from({length:48000},(_,i)=>.1*Math.sin(2*Math.PI*1000*i/48000));
const continuous=new StreamingResampler(48000).push(samples),split=new StreamingResampler(48000),parts=[];
for(let i=0;i<samples.length;i+=997)parts.push(split.push(samples.subarray(i,i+997)));
const chunked=joinFloat(parts);assert(continuous.length===chunked.length,'callback boundaries do not lose samples');
for(let i=0;i<continuous.length;i++)assert(Math.abs(continuous[i]-chunked[i])<1e-7,'streaming interpolation preserves phase across callbacks');
assert(Math.abs(rmsDb(continuous.slice(100))+23.0103)<.2,'speech-band amplitude is preserved');
const ultrasonic=Float32Array.from({length:48000},(_,i)=>.1*Math.sin(2*Math.PI*12000*i/48000));
const rejected=new StreamingResampler(48000).push(ultrasonic);
assert(rmsDb(rejected.slice(100))<-60,'anti-alias filter removes above-band energy before downsampling');
const clock441=new StreamingResampler(44100).push(new Float32Array(44100));assert(clock441.length>15950&&clock441.length<=16000,'44.1 kHz keeps correct time scale');
const history=[{end:10000,prob:.9},{end:10512,prob:.8}];
assert(evaluateSpeechGate(history,11000).pass,'two recent speech frames accept candidate');
assert(!evaluateSpeechGate([{end:10000,prob:.1}],11000).pass,'non-speech candidate is rejected');
assert(!evaluateSpeechGate(history,30000).pass,'old speech cannot validate a later noise trigger');
assert(evaluateSpeechGate([],11000,{enabled:false}).pass,'gate can be disabled for a controlled comparison');
assert(!evaluateSpeechGate(history,11000,{minimumDb:-40,inputDb:-50}).pass,'optional level gate rejects faint input independently');
globalThis.testResult='PASS';
""")

    def test_review_clip_boundaries_and_classification(self):
        review=(ROOT/'js/lab/review.js').read_text().replace('export ', '')
        evaluate(review + r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const ready=[],buffer=new ReviewBuffer({rate:10,onReady:(entry,pcm)=>ready.push({entry,pcm})});
const samples=(start,n)=>Float32Array.from({length:n},(_,i)=>(start+i)/1000);
for(let i=0;i<10;i++)buffer.ingest(samples(i*10,10));
buffer.mark({eventId:'trigger',type:'wake'});buffer.ingest(samples(100,10));
assert(ready.length===0,'wait for two seconds of post-roll');buffer.ingest(samples(110,10));
assert(ready[0].pcm.length===50&&ready[0].entry.eventOffset===3,'exact three-second pre and two-second post window');
assert(Math.abs(ready[0].pcm[0]-.07)<1e-6&&Math.abs(ready[0].pcm[49]-.119)<1e-6,'clip contains correct source samples');
buffer.mark({eventId:'manual',type:'missed-wake'});buffer.ingest(samples(120,5));buffer.flush(true);
assert(ready[1].entry.shortPostRoll&&ready[1].entry.duration===3.5,'Stop retains and flags short post-roll');
const early=[];const startup=new ReviewBuffer({rate:10,onReady:(e,p)=>early.push({e,p})});const input=samples(0,10);startup.ingest(input);input.fill(1);startup.mark({});startup.gap();
assert(early[0].e.shortPreRoll&&early[0].e.shortPostRoll&&early[0].p[0]===0,'startup/gap preserves honest bounds and owned audio');
startup.ingest(samples(100,10));startup.mark({});startup.flush(true);assert(early[1].p.length===10,'audio gaps do not splice unrelated history');
const rejected={type:'wake',levelPass:true,speechPass:false,review:'false negative'};
assert(reviewClassification(rejected,false)==='true positive'&&reviewClassification(rejected,true)==='false negative','gate comparison counts lost genuine phrases');
const noise={...rejected,review:'true negative'};
assert(reviewClassification(noise,false)==='false positive'&&reviewClassification(noise,true)==='true negative','gate comparison counts rejected noise');
assert(reviewClassification({type:'missed-wake',review:'false negative'},false)==='false negative','manual missed wake remains a negative result');
assert(reviewClassification({type:'near-wake',review:'true negative'},true)==='true negative','sampled negative classification');
assert(reviewClassification({type:'wake'},true)==='unreviewed','never infer correctness from detector scores');
const wav=new DataView(reviewWav(new Float32Array([-2,0,2]),16000));assert(wav.getUint32(24,true)===16000&&wav.getInt16(44,true)===-32768&&wav.getInt16(48,true)===32767,'playable WAV rate and bounded samples');
globalThis.testResult='PASS';
""")

    def test_detection_worker_review_messages(self):
        worker=(ROOT/'js/lab/detection-worker.js').read_text()
        worker=re.sub(r'^import .*?;\s*$', '', worker, flags=re.M).replace('import.meta.url', "'http://localhost/js/lab/'")
        review=(ROOT/'js/lab/review.js').read_text().replace('export ', '')
        evaluate(CORE + review + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
const messages=[];const self={postMessage:message=>messages.push(message)};
const performance={now:()=>0};class URL {constructor(path){this.href=path;}}
const fetch=async()=>({json:async()=>({})});
const ort={env:{wasm:{}},Tensor:class {constructor(type,data,dims){this.data=data;}},InferenceSession:{create:async()=>({run:async()=>({stateN:{},output:{data:[.9]}})})}};
class WakeWordDetector {constructor(){this.calls=0;}reset(){}async step(){this.calls++;return {prob:this.calls===40?.99:.1,triggered:this.calls===40};}}
""" + worker + r"""
(async()=>{
 await prepare({generation:7,options:{engine:'heed',threshold:.7,speechThreshold:.6,requireSpeech:true,nearThreshold:.5,autoName:false}});
 resampler={push:pcm=>pcm};
 for(let i=0;i<65;i++)await consume({generation:7,sentAt:Date.now(),sampleRate:16000,pcm:new Float32Array(1600).fill(.1),recording:true});
 const event=messages.find(item=>item.type==='review-event');const clip=messages.find(item=>item.type==='review-clip');
 assert(event?.event.type==='wake'&&event.event.accepted,'real worker candidate becomes review event after speech gate');
 assert(clip?.entry.eventId===event.event.eventId&&clip.samples.length===80000,'worker matches five-second audio to candidate');
 assert(title.length===0,'wake-only session does not collect filename audio');
 self.onmessage({data:{type:'mark-review',generation:7,kind:'missed-wake'}});await serial;
 self.onmessage({data:{type:'finish',generation:7}});await serial;
 const manual=messages.filter(item=>item.type==='review-clip').at(-1);
 assert(manual.entry.type==='missed-wake'&&manual.entry.shortPostRoll,'manual miss is retained at Stop even without future audio');
 assert(messages.at(-1).type==='title-audio','review clips flush before worker completion so main thread can terminate safely');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")

    def test_review_ui_playback_and_saved_labels(self):
        app=(ROOT/'js/lab/app.js').read_text()
        ui=app[app.index('const $='):app.index('function download(')]
        review=(ROOT/'js/lab/review.js').read_text().replace('export ', '')
        evaluate(review + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
class Element {constructor(){this.children=[];this.value='';}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(){}play(){this.played=true;return Promise.resolve();}}
const elements=new Map();const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()};
let puts=0;const createLabStore=()=>({put:async record=>{puts++;assert(record.reviews[0].review==='false positive','saved record includes changed classification');}});
const urls=[];const URL={createObjectURL:audio=>{urls.push(audio);return 'blob:test';},revokeObjectURL:()=>{}};
""" + ui + r"""
(async()=>{
 const event={id:'record',eventId:'event',type:'wake',at:new Date().toISOString(),accepted:true,levelPass:true,speechPass:false,prob:.9,speechMax:.1,audio:{size:160044},duration:5,eventOffset:3};
 records.set('record',{id:'record',reviews:[event]});events.push(event);renderEvents();
 let row=$('events').children[0];assert(row.children[6].children[0].disabled===false,'completed audio can be played');
 current={};renderEvents();row=$('events').children[0];assert(row.children[6].children[0].disabled,'review playback disabled during recording');playReview(event);assert(urls.length===0,'playback guard also protects direct calls');
 current=null;renderEvents();row=$('events').children[0];row.children[6].children[0].onclick();assert($('player').played&&urls[0]===event.audio,'clip audio is passed to native player');
 const select=row.children[7].children[0];select.value='false positive';select.onchange();await reviewWrites;
 assert(puts===1&&event.review==='false positive','classification is persisted');
 assert($('comparison').textContent.includes('1 FP')&&$('comparison').textContent.includes('1 TN'),'summary compares identical reviewed event with gate on and off');
 pendingCaptures.add('record');persistReview(event);await reviewWrites;assert(puts===1,'active capture defers review writes to capture finalization');
 pendingCaptures.clear();deleting.add('record');persistReview(event);await reviewWrites;assert(puts===1,'review updates cannot resurrect deleted recordings');
 const metadata=reviewMetadata(event);assert(!('audio' in metadata)&&metadata.review==='false positive','diagnostics omit binary audio and retain labels');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")

    def test_capture_preserves_tail_and_previous_recordings(self):
        evaluate(CAPTURE + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
class Blob {constructor(parts,{type}){this.parts=[...parts];this.type=type;this.size=parts.reduce((n,p)=>n+p.size,0);}}
const saved=new Map(),chunks=new Map();let failAppend=true,failFinalize=false;
const store={put:async record=>saved.set(record.id,record),append:async(id,n,audio)=>{if(failAppend)throw Error('simulated write failure');chunks.set(id+':'+n,audio);},finalize:async record=>{if(failFinalize)throw Error('full save failed');saved.set(record.id,record);}};
const timers=new Map();let timer=0;const setTimer=callback=>{timers.set(++timer,callback);return timer;},clearTimer=id=>timers.delete(id);
function recorder(){return {mimeType:'audio/webm',state:'inactive',start(ms){assert(ms===250,'chunks are journaled incrementally');this.state='recording';},stop(){this.state='inactive';}};}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
(async()=>{
 const firstRec=recorder(),record={id:'first',state:'starting'},capture=createLabCapture({recorder:firstRec,record,store,setTimer,clearTimer});
 await capture.start();firstRec.ondataavailable({data:{size:100}});await capture.pending;
 assert(record.storageError,'failed chunk writes are reported');
 capture.stop();firstRec.ondataavailable({data:{size:23}});firstRec.onstop();await settle();
 assert(saved.get('first').audio.size===123&&record.saved,'complete memory tail survives chunk write failure and is saved');
 assert(saved.get('first').storageError===null,'successful full save clears obsolete error metadata');
 failAppend=false;const nextRec=recorder(),next=createLabCapture({recorder:nextRec,record:{id:'second'},store,setTimer,clearTimer});
 await next.start();nextRec.ondataavailable({data:{size:80}});next.stop();
 const watchdog=[...timers.values()].at(-1);watchdog();await settle();
 assert(saved.get('first').audio.size===123&&saved.get('second').audio.size===80,'timeout recovery and new capture preserve older audio');
 nextRec.ondataavailable({data:{size:20}});nextRec.onstop();await settle();
 assert(saved.get('second').audio.size===100,'late final event upgrades the interrupted copy');
 failFinalize=true;const badRec=recorder(),bad=createLabCapture({recorder:badRec,record:{id:'third'},store,setTimer,clearTimer});
 await bad.start();badRec.ondataavailable({data:{size:50}});bad.stop();badRec.onstop();await settle();
 assert(bad.record.audio.size===50&&!bad.record.saved,'failed final save retains downloadable memory audio');
 failFinalize=false;const endedRec=recorder(),ended=createLabCapture({recorder:endedRec,record:{id:'ended'},store,setTimer,clearTimer});await ended.start();endedRec.ondataavailable({data:{size:30}});ended.record.captureError='Microphone ended';ended.stop();endedRec.onstop();await settle();assert(ended.record.state==='interrupted'&&ended.record.audio.size===30,'microphone loss after startup retains audio with an interrupted label');
 const oldPut=store.put;let release;store.put=()=>new Promise(resolve=>release=resolve);const cancelledRec=recorder(),cancelled=createLabCapture({recorder:cancelledRec,record:{id:'cancelled'},store,setTimer,clearTimer});const starting=cancelled.start();cancelled.stop();release();assert(await starting===false&&cancelledRec.state==='inactive','Stop during metadata preparation cannot start recording afterward');store.put=oldPut;
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")

    def test_local_scripts_parse(self):
        scripts = [ROOT / 'lab-sw.js'] + list((ROOT / 'js/lab').glob('*.js'))
        sources = []
        for file in scripts:
            source = file.read_text()
            source = re.sub(r'^import .*?;\s*$', '', source, flags=re.M).replace('export ', '').replace('import.meta.url', "'http://localhost/js/lab/'")
            sources.append(source)
        evaluate('for(const source of ' + json.dumps(sources) + ')new Function(source);globalThis.testResult="PASS";')

    def test_offline_asset_manifest(self):
        manifest=json.loads((ROOT/'js/lab/manifest.json').read_text())
        for asset in manifest['assets']:
            file=ROOT/asset['path']
            self.assertTrue(file.is_file(),asset['path'])
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),asset['sha256'],asset['path'])

    def test_startup_retries_actual_encoder_failures(self):
        media=(ROOT/'js/lab/media.js').read_text().replace('export ', '')
        evaluate(media + CAPTURE + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
class Blob {constructor(parts,{type}){this.parts=parts;this.type=type;this.size=parts.reduce((sum,part)=>sum+part.size,0);}}
const attempts=[],saved=new Map();
class Recorder {
 static isTypeSupported(){return true;}
 constructor(stream,options){this.mimeType=options?.mimeType||'';this.state='inactive';}
 start(ms){attempts.push(this.mimeType||'default');if(!this.mimeType)throw new DOMException('Advertised encoder could not start','NotSupportedError');this.state='recording';}
 stop(){this.state='inactive';}
}
// JavaScriptCore test contexts do not provide DOMException.
function DOMException(message,name){this.message=message;this.name=name;}
const store={put:async record=>saved.set(record.id,record),append:async()=>{},finalize:async record=>saved.set(record.id,record)};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
(async()=>{
 const preferred=createLabRecorderChoice({},Recorder);
 assert(preferred.requestedMime==='audio/mp4;codecs=mp4a.40.2','default preference matches production AAC');
 const webm=createLabRecorderChoice({},Recorder,()=>{},'webm');
 assert(webm.requestedMime==='audio/webm;codecs=opus','WebM comparison prefers Opus');
 class WebmOnly extends Recorder {static isTypeSupported(mime){return mime.includes('webm');}}
 assert(createLabRecorderChoice({},WebmOnly).requestedMime==='audio/webm;codecs=opus','unsupported AAC is skipped');
 class DefaultOnly extends Recorder {static isTypeSupported(){return false;}}
 assert(createLabRecorderChoice({},DefaultOnly).requestedMime==='','browser default remains last-resort fallback');
 const choice=createLabRecorderChoice({},Recorder,()=>{},'browser');
 assert(choice.requestedMime===''&&choice.recorder.mimeType==='','browser default is tried before explicit formats');
 const initial=choice.recorder,record={id:'fallback',mime:''},capture=createLabCapture({recorder:initial,record,store,fallbacks:choice.fallbacks,setTimer:()=>1,clearTimer:()=>{}});
 await capture.start();assert(attempts[0]==='default'&&attempts[1]==='audio/mp4;codecs=mp4a.40.2','start failure advances to AAC, even though support was advertised');
 assert(capture.recorder!==initial&&capture.recorder.state==='recording','live capture follows successful replacement recorder');
 assert(initial.ondataavailable===null&&initial.onerror===null,'failed recorder cannot deliver stale events');
 capture.recorder.ondataavailable({data:{size:41}});capture.stop();capture.recorder.ondataavailable({data:{size:9}});capture.recorder.onstop();await settle();
 assert(saved.get('fallback').audio.size===50&&saved.get('fallback').mime.includes('mp4'),'replacement recorder retains all chunks with correct MIME type');
 class Failing extends Recorder {start(){throw Error('Cannot allocate encoder');}}
 const badChoice=createLabRecorderChoice({},Failing),bad=createLabCapture({recorder:badChoice.recorder,record:{id:'failed'},store,fallbacks:badChoice.fallbacks,setTimer:()=>1,clearTimer:()=>{}});
 let failed=false;try{await bad.start();}catch(error){failed=true;}
 assert(failed&&bad.record.formatAttempts.length===7,'all start failures are retained for diagnostics');
 bad.stop();await settle();assert(bad.record.state==='failed'&&!bad.record.audio.size,'never-started attempt is not labeled a completed recording');
 assert(saved.get('fallback').audio.size===50,'later startup failure does not affect older audio');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")

    def test_audio_context_cleanup_is_idempotent(self):
        media=(ROOT/'js/lab/media.js').read_text().replace('export ', '')
        evaluate(media + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
(async()=>{
 let calls=0,release;const context={state:'running',close(){calls++;this.state='closed';return new Promise(resolve=>release=resolve);}};
 const first=closeLabAudioContext(context),second=closeLabAudioContext(context);await Promise.resolve();
 assert(calls===1&&first===second,'simultaneous cleanup paths share a single close request');release();await first;await closeLabAudioContext(context);assert(calls===1,'later cleanup never closes an already-closed context');
 const closed={state:'closed',close(){throw Error('must not close twice');}};await closeLabAudioContext(closed);
 let reported=0;await closeLabAudioContext({state:'running',close(){return Promise.reject(Error('Hardware failure'));}},()=>reported++);
 assert(reported===1,'genuine cleanup failure is reported without an unhandled rejection');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")


    def test_models_finish_before_microphone_acquisition(self):
        media=(ROOT/'js/lab/media.js').read_text().replace('export ', '')
        evaluate(media + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
(async()=>{
 let ready,acquired=0,stopped=0,valid=true;
 const preparation=new Promise(resolve=>ready=resolve),stream={getTracks:()=>[{stop:()=>stopped++}]};
 const pending=acquireLabMicrophoneAfterPreparation(preparation,async()=>{acquired++;return stream;},()=>valid);
 await Promise.resolve();assert(acquired===0,'slow model preparation never holds a microphone');
 ready();assert(await pending===stream&&acquired===1,'microphone opens only after models are ready');
 let cancelReady;const cancelled=acquireLabMicrophoneAfterPreparation(new Promise(resolve=>cancelReady=resolve),async()=>{acquired++;return stream;},()=>valid);valid=false;cancelReady();assert(await cancelled===null&&acquired===1,'cancelling preparation never requests microphone access');
 valid=true;let grant;const permissionPending=acquireLabMicrophoneAfterPreparation(Promise.resolve(),()=>new Promise(resolve=>grant=resolve),()=>valid);await Promise.resolve();valid=false;grant(stream);assert(await permissionPending===null&&stopped===1,'late microphone permission is released after cancellation');
 let rejected=false;try{await acquireLabMicrophoneAfterPreparation(Promise.reject(Error('not ready')),async()=>{acquired++;return stream;});}catch(error){rejected=true;}
 assert(rejected&&acquired===1,'unhandled preparation failure cannot open a microphone');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")


    def test_worklet_packets_and_silent_output(self):
        worklet=(ROOT/'js/lab/input-worklet.js').read_text()
        evaluate(r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
let Processor;const messages=[];
class AudioWorkletProcessor {constructor(){this.port={postMessage:(pcm,transfer)=>{assert(transfer[0]===pcm.buffer,'PCM ownership is transferred');messages.push(pcm);}};}}
function registerProcessor(name,ctor){assert(name==='imuse-lab-input','expected processor is registered');Processor=ctor;}
""" + worklet + r"""
const processor=new Processor();
for(let block=0;block<16;block++){
 const input=Float32Array.from({length:128},(_,i)=>(block*128+i)/10000),copy=input.slice(),output=new Float32Array(128).fill(1);
 assert(processor.process([[input]],[[output]])===true,'processor remains active');
 assert(output.every(value=>value===0),'analysis never monitors microphone through speakers');
 assert(input.every((value,i)=>value===copy[i]),'native recorder input is not modified');
}
assert(messages.length===2&&messages[0].length===1024,'render quanta produce bounded 1024-sample packets');
assert(messages[0].buffer!==messages[1].buffer&&Math.abs(messages[1][0]-.1024)<1e-6,'new packets cannot overwrite prior transferred audio');
const silence=new Float32Array(128).fill(1);processor.process([],[[silence]]);assert(silence.every(value=>value===0),'missing input also outputs silence');
globalThis.testResult='PASS';
""")

    def test_inactive_recorder_waits_for_final_data(self):
        evaluate(CAPTURE + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
class Blob {constructor(parts,{type}){this.size=parts.reduce((n,p)=>n+p.size,0);this.type=type;}}
const finalized=[];const store={put:async()=>{},append:async()=>{},finalize:async record=>finalized.push(record.audio.size)};
const recorder={mimeType:'audio/mp4',state:'inactive',start(){this.state='recording';},stop(){this.state='inactive';}};
const capture=createLabCapture({recorder,record:{id:'ended'},store,setTimer:()=>1,clearTimer:()=>{}});
(async()=>{
 await capture.start();recorder.ondataavailable({data:{size:70}});await capture.pending;
 recorder.state='inactive';capture.record.captureError='Microphone ended';capture.stop();
 for(let i=0;i<10;i++)await Promise.resolve();
 assert(finalized.length===0&&!capture.fullFinished,'inactive native recorder must still deliver its final data and stop events');
 recorder.ondataavailable({data:{size:30}});recorder.onstop();for(let i=0;i<12;i++)await Promise.resolve();
 assert(finalized.length===1&&finalized[0]===100&&capture.record.state==='interrupted','interruption retains the complete final tail');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack||''));
""")


if __name__ == '__main__':
    unittest.main()
