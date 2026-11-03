"""Standalone lab clip boundaries and WAV encoding; no microphone or stored recordings."""
import re
import unittest
from pathlib import Path
from recording_test_support import evaluate

LAB = (Path(__file__).resolve().parents[1] / 'lab.html').read_text()
HELPERS = LAB[LAB.index('// Encode away from the detection thread.'):LAB.index('// END WAKE OPTIMIZATION HELPERS')]
CORE = LAB[LAB.index('// BEGIN WAKE CLIP CORE'):LAB.index('// END WAKE CLIP CORE')]


class WakeLabTests(unittest.TestCase):
    def test_audio_clip_boundaries_and_grouping(self):
        evaluate(CORE + r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const ready=[];const capture=new WakeClipBuffer({rate:10,onReady:(entry,pcm)=>ready.push({entry,pcm})});
const samples=(start,length)=>Float32Array.from({length},(_,i)=>(start+i)/1000);
capture.ingest(samples(0,100));
const entry=capture.observe({id:'first',end:100,prob:.6,nearThreshold:.5});
assert(!ready.length,'post-roll must arrive before finalization');
capture.ingest(samples(100,10));
const upgraded=capture.observe({end:110,prob:.95,triggered:true,threshold:.9});
assert(upgraded===entry&&entry.kind==='trigger','near event upgrades to real trigger without duplicate');
capture.ingest(samples(110,20));
assert(ready.length===1&&ready[0].pcm.length===60,'grouped clip includes three-second pre-roll plus extended post-roll');
assert(Math.abs(ready[0].pcm[0]-.07)<1e-6&&Math.abs(ready[0].pcm[59]-.129)<1e-6,'captured PCM has exact requested sample boundaries');
assert(entry.triggered&&entry.threshold===.9&&entry.triggerSample===110,'actual trigger metadata is retained');
assert(!entry.shortPreRoll&&!entry.shortPostRoll,'complete clip is not marked truncated');
assert(!capture.observe({end:130,prob:.1}),'low score does not produce a clip');
capture.observe({end:130,prob:.6});capture.flush(true);
assert(ready.length===2&&ready[1].entry.shortPostRoll,'stopping keeps incomplete post-roll with an honest flag');
const early=[];const startup=new WakeClipBuffer({rate:10,onReady:(e,p)=>early.push({e,p})});
const input=samples(0,10);startup.ingest(input);input.fill(1);
startup.observe({end:10,prob:.99,triggered:true});startup.ingest(samples(10,20));
assert(early[0].e.shortPreRoll&&early[0].p.length===30,'startup has short beginning');
assert(early[0].p[0]===0,'callback input is copied rather than retained by reference');
const missed=startup.observe({manual:true,prob:0,end:30});startup.flush(true);
assert(missed.label==='false negative'&&missed.kind==='manual miss','manual mark captures a below-threshold missed phrase');
const delayed=[];const history=new WakeClipBuffer({rate:10,historySeconds:8,onReady:(e,p)=>delayed.push({e,p})});
for(let i=0;i<20;i++)history.ingest(samples(i*10,10));
history.observe({end:40,prob:.9,triggered:true});
assert(delayed.length===1&&delayed[0].e.shortPreRoll&&delayed[0].p.length===0,'late inference does not fabricate expired history');
const sustained=[];const episode=new WakeClipBuffer({rate:10,onReady:(e,p)=>sustained.push({e,p})});
for(let i=0;i<40;i++){episode.ingest(samples(i*10,10));episode.observe({prob:.6});}
episode.flush(true);
assert(sustained.length===1&&sustained[0].p.length<=150,'sustained near scores are grouped and clip duration bounded');
const wav=new DataView(wakeClipWav(new Float32Array([-2,-.5,0,.5,2]),16000));
assert(wav.byteLength===54&&wav.getUint32(24,true)===16000&&wav.getUint32(40,true)===10,'WAV header has correct rate and PCM length');
assert(wav.getInt16(44,true)===-32768&&wav.getInt16(52,true)===32767,'PCM conversion clips full scale correctly');
globalThis.testResult='PASS';
""")

    def test_standalone_scripts_parse(self):
        import json
        scripts = re.findall(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>', LAB)
        evaluate('const scripts=' + json.dumps(scripts) + ';for(const script of scripts)new Function(script);globalThis.testResult="PASS";')

    def test_review_labels_archive_and_reload(self):
        ui = LAB[LAB.index('let clipBuffer=null'):LAB.index("$('nearThreshold').oninput")]
        evaluate(CORE + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
class Element {
 constructor(){this.children=[];this.value='';this.files=[];this.textContent='';}
 append(...items){this.children.push(...items);}prepend(item){this.children.unshift(item);}
 replaceChildren(...items){this.children=items;}add(item){this.append(item);if(!this.value)this.value=item.value;}
 setAttribute(){}play(){return Promise.resolve();}
}
class Option extends Element {constructor(text,value){super();this.textContent=text;this.value=value;}}
const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const document={createElement:()=>new Element()};
let confirmClear=false;const window={addEventListener:()=>{},confirm:()=>confirmClear};
let objectUrls=0,lastPlayedBlob=null;const URL={createObjectURL:blob=>{lastPlayedBlob=blob;return String(++objectUrls);},revokeObjectURL:()=>{}};
class Blob {
 constructor(parts,{type}={}){this.type=type;this.bytes=[];for(const part of parts){const bytes=part instanceof ArrayBuffer?new Uint8Array(part):part;this.bytes.push(...bytes);}this.size=this.bytes.length;}
 async arrayBuffer(){return Uint8Array.from(this.bytes).buffer;}
}
const btoa=input=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';for(let i=0;i<input.length;i+=3){const a=input.charCodeAt(i),b=input.charCodeAt(i+1),c=input.charCodeAt(i+2);const value=(a<<16)|((b||0)<<8)|(c||0);result+=alphabet[(value>>>18)&63]+alphabet[(value>>>12)&63]+(i+1<input.length?alphabet[(value>>>6)&63]:'=')+(i+2<input.length?alphabet[value&63]:'=');}return result;};
const atob=input=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';for(let i=0;i<input.length;i+=4){const v=(alphabet.indexOf(input[i])<<18)|(alphabet.indexOf(input[i+1])<<12)|((alphabet.indexOf(input[i+2])&63)<<6)|(alphabet.indexOf(input[i+3])&63);result+=String.fromCharCode((v>>>16)&255);if(input[i+2]!=='=')result+=String.fromCharCode((v>>>8)&255);if(input[i+3]!=='=')result+=String.fromCharCode(v&255);}return result;};
const stored=new Map(),runStored=new Map();let failWrites=false;
const db={transaction:(names,mode)=>{let clearing=false;const clearNames=[];const tx={objectStore:(selected=names)=>({
 put:entry=>{Promise.resolve().then(()=>{if(failWrites){tx.error=Error('quota');tx.onabort();}else{(selected==='runs'?runStored:stored).set(entry.id,entry);tx.oncomplete();}});},
 getAll:()=>{const request={};Promise.resolve().then(()=>{request.result=[...(selected==='runs'?runStored:stored).values()];request.onsuccess();});return request;},
 clear:()=>{clearNames.push(selected);if(clearing)return;clearing=true;Promise.resolve().then(()=>{if(failWrites){tx.error=Error('clear failed');tx.onabort();}else{for(const name of clearNames)(name==='runs'?runStored:stored).clear();tx.oncomplete();}});}
})};return tx;}};
const indexedDB={open:()=>{const request={};Promise.resolve().then(()=>{request.result=db;request.onsuccess();});return request;}};
const fmt=value=>Number.isFinite(value)?value.toFixed(3):'—';
const now=()=>new Date().toISOString();let running=false,stream=null,frames=[],events=[],marks=[],ended=now(),engineName='heed';
const render=()=>{};const downloads=[];const download=(name,text,type)=>downloads.push({name,text,type});
""" + HELPERS + ui + r"""
(async()=>{
 await reviewReady;
 runId='test';currentRunInfo={id:runId,engine:'heed',capturedAudioSeconds:12};frames=[{audioEndSample:75,prob:.6,inputRmsDbfs:-30},{audioEndSample:115,prob:.95,inputRmsDbfs:-25}];
 const capture=new WakeClipBuffer({rate:10,onReady:retainReviewClip});
 capture.ingest(new Float32Array(100));capture.observe({id:'test-1',at:now(),runId:'test',end:100,prob:.95,threshold:.9,triggered:true,phrase:'Hey Doc',condition:'background'});
 capture.ingest(new Float32Array(20));await Promise.allSettled([...compressionJobs]);await reviewWrites;
 persistReviewRun();await reviewWrites;assert(runStored.get('test').frames.length===2&&reviewClips[0].scoreTrace.length===2,'run log and clip trace retain original model scores');
 assert(reviewClips.length===1&&stored.has('test-1')&&reviewClips[0].saved,'finished clip persists to separate clip store');
 const row=reviewRowElements.get('test-1').row;
 const label=row.children[5].children[0];label.value='false positive';label.onchange();
 const note=row.children[6].children[0];note.value='Someone said another phrase';note.onchange();await reviewWrites;
 assert(stored.get('test-1').label==='false positive'&&stored.get('test-1').notes===note.value,'classification and notes persist');
 row.children[4].children[0].onclick();
 assert($('reviewAudio').src&&$('reviewPlaying').textContent.includes('Hey Doc'),'table Play opens retained WAV in shared player');
 running=true;updateReviewPlayback();const beforePlay=objectUrls;row.children[4].children[0].onclick();assert(objectUrls===beforePlay&&row.children[4].children[0].disabled,'monitoring blocks playback to prevent the lab hearing itself');running=false;updateReviewPlayback();
 const raw=reviewClips[0].audio;reviewClips[0].audio=new Blob([new Uint8Array([255,243,0,1])],{type:'audio/mpeg'});playReviewAudio(reviewClips[0],true);assert(lastPlayedBlob===raw&&$('reviewPlaying').textContent.includes('original WAV'),'original comparison plays pre-encoding source rather than MP3');reviewClips[0].audio=raw;
 const level=reviewSourceStats(new Float32Array([.001,.001]));assert(Math.abs(level.rmsDbfs+60)<1e-5&&level.clippedSamples===0,'original levels are measured without amplification');const clipped=reviewSourceStats(new Float32Array([1,-1,NaN]));assert(clipped.clippedSamples===2&&clipped.nonFiniteSamples===1&&clipped.peakDbfs===0,'diagnostics identify clipping and invalid source samples');
 for(let i=0;i<4;i++)rememberReviewOriginal({id:'bounded-'+i,audio:raw});assert(reviewOriginals.size===3&&!reviewOriginals.has('bounded-0'),'temporary original audio is bounded to three clips');
 await $('reviewExport').onclick();const archive=downloads.at(-1).text;
 assert(JSON.parse(archive).clips[0].audioBase64&&JSON.parse(archive).runs[0].frames[1].inputRmsDbfs===-25,'archive includes audio and original optimization data');
 await initializeReview();assert(reviewClips[0].label==='false positive','reload restores audio review classification');
 const existing=reviewClips[0];existing.label='uncertain';
 $('reviewImport').files=[{text:async()=>archive}];await $('reviewImport').onchange();
 assert(reviewClips.length===1&&reviewClips[0].label==='uncertain','import preserves edits to existing clip IDs');
 reviewClips=[];reviewRuns=[];runStored.clear();renderReview();$('reviewImport').files=[{text:async()=>archive}];await $('reviewImport').onchange();await reviewWrites;
 assert(reviewClips.length===1&&reviewClips[0].label==='false positive'&&reviewClips[0].audio.size===144&&runStored.get('test').frames.length===2,'archive round-trip preserves labels and exact PCM bytes');
 failWrites=true;reviewClips[0].label='uncertain';queueReviewSave(reviewClips[0]);await reviewWrites;
 assert(!reviewClips[0].saved&&$('reviewStatus').textContent.includes('only in memory'),'storage failure is visible and does not discard audio');
 await $('reviewExport').onclick();assert(JSON.parse(downloads.at(-1).text).clips[0].label==='uncertain','archive retains unsaved edits when storage fails');
 const legacy=JSON.parse(archive);legacy.version=1;legacy.clips=legacy.clips.map(clip=>({...clip,id:'legacy',wavBase64:clip.audioBase64,audioBase64:undefined,audioMimeType:undefined}));legacy.runs=[];
 failWrites=false;$('reviewImport').files=[{text:async()=>JSON.stringify(legacy)}];await $('reviewImport').onchange();await reviewWrites;assert(reviewClips.find(clip=>clip.id==='legacy')?.audio.type==='audio/wav','previous WAV archives remain importable');

 events=[{at:now(),type:'old'}];renderEventLog();clearEventLogDisplay();assert(events.length===1&&$('log').textContent==='','clearing display preserves diagnostic events');events.push({at:now(),type:'new'});renderEventLog();assert($('log').textContent.includes('new')&&!$('log').textContent.includes('old'),'new events do not restore hidden old entries');
 const countBefore=reviewClips.length;await clearReviewHistory();assert(reviewClips.length===countBefore,'cancelled clear preserves reviews');
 confirmClear=true;failWrites=true;await clearReviewHistory();assert(reviewClips.length===countBefore&&stored.size>0&&runStored.size>0,'failed clear keeps both memory and stored history');
 failWrites=false;let release;const wait=new Promise(resolve=>release=resolve);const late=wait.then(()=>queueReviewSave(reviewClips[0]));compressionJobs.add(late);
 const clearing=clearReviewHistory();await Promise.resolve();assert(reviewMaintenance,'clear locks review mutations while waiting for compression');release();await clearing;compressionJobs.delete(late);await reviewWrites;
 assert(reviewClips.length===0&&reviewRuns.length===0&&stored.size===0&&runStored.size===0,'confirmed clear waits for late saves then clears both stores');
 assert(reviewOriginals.size===0&&$('reviewCount').textContent==='0'&&!reviewMaintenance,'clear releases originals and updates UI');
 globalThis.testResult='PASS';
})().catch(error=>{globalThis.testResult=String(error)+String(error.stack||'');});
""")

    def test_compression_worker_and_source_retention(self):
        evaluate(HELPERS + r"""
globalThis.testResult='pending';
const assert=(value,message)=>{if(!value)throw Error(message);};
class Blob {constructor(parts,{type}){this.type=type;this.size=parts.reduce((size,part)=>size+(part.byteLength??part.length),0);this.parts=parts;}}
const URL={createObjectURL:blob=>{assert(blob.parts[0].includes('lamejs@1.2.1'),'encoder version is pinned');assert(blob.parts[0].includes('Mp3Encoder(1,rate,64)'),'mono 64 kbps selected');new Function(blob.parts[0]);return 'worker';},revokeObjectURL:()=>{}};
let fail=false;
class Worker {
 postMessage(message,transfer){assert(transfer[0]===message.pcm.buffer,'PCM is transferred to worker');Promise.resolve().then(()=>this.onmessage({data:fail?{id:message.id,error:'encoder failed'}:{id:message.id,bytes:new Uint8Array([255,243,0,1]).buffer}}));}
}
let timerId=0;const setTimeout=()=>++timerId,clearTimeout=()=>{};
const saved=[];const queueReviewSave=clip=>saved.push(clip.audio.type),updateReviewRow=()=>{},reviewStatus=()=>{};
(async()=>{
 const original=new Blob([new Uint8Array(44)],{type:'audio/wav'}),clip={sampleRate:48000,audio:original};
 compressReviewClip(clip,new Float32Array(480));await Promise.allSettled([...compressionJobs]);
 assert(clip.audio.type==='audio/mpeg'&&clip.encodingInfo.bitrateKbps===64&&!clip.encoding,'successful encoding replaces audio with MP3');
 assert(saved[0]==='audio/mpeg'&&compressionJobs.size===0,'completed compressed audio is queued for persistence');
 fail=true;const backup={sampleRate:48000,audio:original};compressReviewClip(backup,new Float32Array(480));await Promise.allSettled([...compressionJobs]);
 assert(backup.audio===original&&backup.compressionError.includes('encoder failed')&&!backup.encoding,'encoding failure retains original audio and records reason');
 assert(Math.abs(reviewFrameRms(new Float32Array([.1,.1]))+20)<1e-5,'raw input RMS is retained independently of compressed audio');
 assert(reviewFrameRms(new Float32Array(10))===null,'digital silence has explicit nonfinite-free representation');
 globalThis.testResult='PASS';
})().catch(error=>{globalThis.testResult=String(error)+String(error.stack||'');});
""")


if __name__ == '__main__':
    unittest.main()
