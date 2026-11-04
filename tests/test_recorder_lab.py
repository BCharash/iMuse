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
assert(filename(prefix,'','webm')===prefix+'.webm','empty recognition preserves usable date-only name');
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


if __name__ == '__main__':
    unittest.main()
