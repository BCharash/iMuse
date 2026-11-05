"""Detector-aligned, fresh-state Silero comparison; no microphone or real recordings."""
import json
import re
import unittest
from pathlib import Path
from recording_test_support import evaluate

ROOT=Path(__file__).resolve().parents[1]
def script(name):
    source=(ROOT/'js/lab'/name).read_text()
    return re.sub(r'^import .*?;\s*$', '', source, flags=re.M).replace('export ', '').replace('import.meta.url', "'http://localhost/js/lab/'")
CORE=script('core.js')
FRESH=script('fresh-speech.js')
REVIEW=script('review.js')

class FreshSpeechTests(unittest.TestCase):
    def test_windows_capture_only_consumed_unscaled_audio(self):
        evaluate(CORE+REVIEW+FRESH+r"""
const assert=(v,m)=>{if(!v)throw Error(m);};
const window=detectorSpeechWindow({engine:'heed',end:65600,windowSamples:16000,consecutiveFrames:2});
assert(window.requestedSamples===17600&&window.samples===17920&&window.leadingAlignmentSamples===320,'Heed covers both triggering windows and rounds only the left edge');
const buffer=new ReviewBuffer({onReady:()=>{}});for(let i=0;i<67000;i+=512)buffer.ingest(Float32Array.from({length:512},(_,j)=>(i+j)/1000000));
const captured=buffer.extract(window.start,window.end);
assert(!captured.incomplete&&captured.samples.length===17920,'full detector-aligned window is available before post-roll');
assert(Math.abs(captured.samples[0]-.04768)<1e-7&&Math.abs(captured.samples.at(-1)-.065599)<1e-7,'raw sample bounds exclude newer unconsumed audio');
const voicute=detectorSpeechWindow({engine:'voicute',end:65600,windowSamples:24000,consecutiveFrames:9});assert(voicute.requestedSamples===24000&&voicute.samples===24064,'Voicute uses its current input window, not Heed debounce');
buffer.gap();buffer.ingest(new Float32Array(512));assert(buffer.extract(window.start,window.end).incomplete,'gap prevents splicing old context into a fresh comparison');
const early=new ReviewBuffer({onReady:()=>{}});early.ingest(new Float32Array(512));assert(early.extract(-17408,512).incomplete,'startup shortage is explicit');
globalThis.testResult='PASS';
""")

    def test_inference_resets_state_and_keeps_frame_trace(self):
        evaluate(CORE+FRESH+r"""
globalThis.testResult='pending';const assert=(v,m)=>{if(!v)throw Error(m);};
const inputs=[];let clock=0,call=0;const ort={Tensor:class {constructor(type,data,dims){this.data=data;this.dims=dims;}}};
const session={run:async feeds=>{inputs.push(feeds);const n=++call;return {stateN:new ort.Tensor('float32',new Float32Array(256).fill(n),[2,1,128]),output:{data:[n%35===1||n%35===2?.9:.1]}};}};
(async()=>{
 const samples=Float32Array.from({length:17920},(_,i)=>i/1000000),window=detectorSpeechWindow({engine:'heed',end:65600,windowSamples:16000,consecutiveFrames:2});
 const first=await evaluateFreshSpeech(session,ort,samples,{window,threshold:.6},()=>++clock);
 assert(first.trace.length===35&&first.trace[0].start===window.start&&first.trace.at(-1).end===window.end,'trace is aligned to exact input samples');
 assert(!first.speechPass,'speech outside the final one-second decision window cannot validate a candidate');
 assert(inputs[0].state.data.every(x=>x===0)&&inputs[0].input.data.slice(0,64).every(x=>x===0),'each candidate starts with zero recurrent and audio context');
 assert(inputs[1].state.data[0]===1&&Math.abs(inputs[1].input.data[0]-samples[448])<1e-7,'state and last 64 samples continue inside a candidate');
 await evaluateFreshSpeech(session,ort,samples,{window,threshold:.6},()=>++clock);
 assert(inputs[35].state.data.every(x=>x===0)&&inputs[35].input.data.slice(0,64).every(x=>x===0),'next candidate reuses model but neither state');
 assert(samples[448]===inputs[0].input.data[512],'input PCM was not scaled or mutated');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack||''));
""")

    def test_detection_worker_dispatches_only_candidates_at_detector_end(self):
        evaluate(CORE+REVIEW+FRESH+r"""
globalThis.testResult='pending';const assert=(v,m)=>{if(!v)throw Error(m);};
const messages=[],self={postMessage:m=>messages.push(m)},performance={now:()=>0};class URL{constructor(path){this.href=path;}}
const fetch=async()=>({json:async()=>({audio_window_samples:16000,trigger:{consecutive_frames:2}})});
const ort={env:{wasm:{}},Tensor:class{constructor(type,data,dims){this.data=data;this.dims=dims;}},InferenceSession:{create:async()=>({run:async()=>({stateN:{},output:{data:[.9]}})})}};
class WakeWordDetector{constructor(){this.calls=0;}reset(){}async step(){this.calls++;return {prob:this.calls===41?.99:.55,triggered:this.calls===41};}}
"""+script('detection-worker.js')+r"""
(async()=>{
 await prepare({generation:1,options:{engine:'heed',threshold:.7,speechThreshold:.6,requireSpeech:true,nearThreshold:.5,freshSpeech:true}});resampler={push:pcm=>pcm};
 for(let i=0;i<44;i++)await consume({generation:1,sentAt:Date.now(),sampleRate:16000,pcm:Float32Array.from({length:1600},(_,j)=>(i*1600+j)/1000000),recording:true});
 const fresh=messages.filter(m=>m.type==='fresh-audio');assert(fresh.length===1,'near triggers do not occupy the fresh comparison lane');
 const m=fresh[0],event=messages.find(m=>m.type==='review-event'&&m.event.type==='wake').event;
 assert(m.eventId===event.eventId&&m.window.end===65600&&event.detectorLagSamples===448,'fresh window ends at Heed consumed sample, not later analysis position');
 assert(m.samples.length===17920&&Math.abs(m.samples.at(-1)-.065599)<1e-7,'worker dispatches exact unscaled original audio');
 assert(event.accepted&&event.speechPass&&event.continuousSpeechTrace.length,'continuous decision and trace stay intact');
 // The Voicute classifier receives scaled audio, but fresh Silero gets the original PCM.
 messages.length=0;await prepare({generation:2,options:{engine:'off',speechThreshold:.6,requireSpeech:true,nearThreshold:.5,freshSpeech:true}});
 engineName='voicute';let predicted=false;voicute={audioSamplesNeeded:()=>16000,predict:async input=>{assert(Math.abs(input[0]-3276.7)<.01,'existing Voicute scaling retained');return {prob:.95};},detect:()=>!predicted&&(predicted=true),reset(){}};resampler={push:pcm=>pcm};
 for(let i=0;i<12;i++)await consume({generation:2,sentAt:Date.now(),sampleRate:16000,pcm:new Float32Array(1600).fill(.1),recording:true});
 const v=messages.find(m=>m.type==='fresh-audio');assert(v.window.requestedSamples===16000&&v.samples.every(x=>Math.abs(x-.1)<1e-6),'Voicute comparison preserves raw normalized audio');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack||''));
""")

    def test_client_lane_timing_busy_failure_and_cleared_logs(self):
        app=(ROOT/'js/lab/app.js').read_text()
        ui=app[app.index('const $='):app.index('function download(')].replace('import.meta.url', "'http://localhost/js/lab/'")
        evaluate(CORE+REVIEW+r"""
globalThis.testResult='pending';const assert=(v,m)=>{if(!v)throw Error(m);};
class Element{constructor(){this.children=[];this.value='';}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(){}}
const elements=new Map(),document={createElement:()=>new Element(),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
const writes=[],createLabStore=()=>({put:async record=>writes.push(record)});const requests=[],workers=[];
class Worker{constructor(){workers.push(this);}postMessage(m){if(m.type==='prepare')Promise.resolve().then(()=>this.onmessage({data:{type:'ready'}}));else requests.push(m);}terminate(){}}
class URL{constructor(path){this.href=path;}}const timers=new Map();let timer=0;const setTimeout=fn=>{timers.set(++timer,fn);return timer;},clearTimeout=id=>timers.delete(id);
"""+ui+r"""
(async()=>{
 await prepareFreshSpeech();assert(freshReady,'worker preparation resolves before comparison');
 const record={id:'run',settings:{speechThreshold:.6},reviews:[]},capture={record,freshAvailable:true};records.set('run',record);pendingCaptures.add('run');
 const add=id=>{const e={id:'run',eventId:id,type:'wake',at:new Date().toISOString(),accepted:false,speechPass:false,levelPass:true,review:'false negative'};record.reviews.push(e);events.push(e);return e;};
 const a=add('a'),b=add('b'),window={start:0,end:17920,samples:17920,leadingAlignmentSamples:320,incomplete:false};
 compareFreshSpeech(capture,{eventId:'a',window,samples:new Float32Array(17920),detectedAtMs:Date.now()-5});
 compareFreshSpeech(capture,{eventId:'b',window,samples:new Float32Array(17920),detectedAtMs:Date.now()});assert(a.freshSpeech.status==='checking'&&b.freshSpeech.status==='skipped-busy'&&requests.length===1,'one request at a time with explicit busy reporting');
 [...timers.values()][0]();assert(a.freshSpeech.status==='timed-out'&&freshPending,'deadline does not release a still-computing lane');
 workers[0].onmessage({data:{type:'result',id:requests[0].id,result:{speechPass:true,speechMax:.9,speechFrames:3,processingMs:4,sampleSeconds:1.12,trace:[{end:17920,prob:.9}],window}}});
 assert(a.freshSpeech.status==='late-result'&&!freshPending&&a.freshSpeech.totalMs>=5,'late result reports end-to-end added delay and frees lane');
 assert(!a.accepted&&a.review==='false negative','fresh verdict never changes actual action or shared label');
 const c=add('c');compareFreshSpeech(capture,{eventId:'c',window:{...window,incomplete:true},samples:new Float32Array(512),detectedAtMs:Date.now()});assert(c.freshSpeech.status==='incomplete'&&requests.length===1,'incomplete startup/gap window does not infer a verdict');
 compareFreshSpeech(capture,{eventId:'b',window,samples:new Float32Array(17920),detectedAtMs:Date.now()});record.reviews=[];
 workers[0].onmessage({data:{type:'result',id:requests[1].id,result:{speechPass:true}}});assert(b.freshSpeech.status==='checking','late results cannot restore cleared reviews');
 record.reviews=[b];compareFreshSpeech(capture,{eventId:'b',window,samples:new Float32Array(17920),detectedAtMs:Date.now()});workers[0].onerror({message:'worker crashed'});
 assert(b.freshSpeech.status==='error'&&!freshReady&&!freshPending,'worker failure retains recording and clears request lane');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack||''));
""")

if __name__=='__main__':
    unittest.main()
