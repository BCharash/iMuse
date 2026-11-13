"""Production provenance and worker lifecycle. Real AAC/IDB check is separate."""
import unittest
from pathlib import Path
from recording_test_support import evaluate
ROOT=Path(__file__).resolve().parents[1]
CORE=(ROOT/'js/recording-combine-metadata.js').read_text().replace('export ','')
BASE=r'''
const assert=(value,message)=>{if(!value)throw Error(message);};
class TextEncoder {encode(text){return Uint8Array.from(unescape(encodeURIComponent(text)),c=>c.charCodeAt(0));}}
class TextDecoder {decode(bytes){return decodeURIComponent(escape(String.fromCharCode(...bytes)));}}
class Blob {
 constructor(parts=[]){this.bytes=Uint8Array.from(parts.flatMap(part=>Array.from(part instanceof Blob?part.bytes:part instanceof ArrayBuffer?new Uint8Array(part):typeof part==='string'?new TextEncoder().encode(part):part)));this.size=this.bytes.length;}
 slice(start,end){return new Blob([this.bytes.slice(start,end)]);}
 async arrayBuffer(){return this.bytes.buffer.slice(0);}
 async text(){return new TextDecoder().decode(this.bytes);}
}
let serial=0;const uuid=()=>`id-${++serial}`,createdAt='2026-11-13T12:00:00Z';
const source=(id,day)=>({filename:id+'.m4a',metadata:originalCombineMetadata({id,startedAt:`2026-02-0${day}T12:00:00Z`,mimeType:'audio/mp4'},
 {sampleRate:48000,channels:1,packetCount:10,sampleCount:10240},id+'.m4a',uuid)});
const A=()=>source('A',1),B=()=>source('B',2),C=()=>source('C',3);
function fails(fn,phrase){let error;try{fn();}catch(e){error=e;}assert(error&&error.message.includes(phrase),'Expected '+phrase);}
'''

def check(script):
 evaluate(CORE+BASE+"\nglobalThis.testResult='pending';(async()=>{\n"+script+"\nglobalThis.testResult='PASS';})().catch(error=>{globalThis.testResult=String(error.stack||error);});")

class RecordingCombineTests(unittest.TestCase):
 def test_nested_chronology_offsets_and_originals(self):
  check(r'''
const inputs=[C(),A()],before=JSON.stringify(inputs),ac=planCombinedRecording(inputs,{uuid,createdAt});
assert(JSON.stringify(inputs)===before,'originals unchanged');
const abc=planCombinedRecording([{filename:'AC.m4a',metadata:ac.metadata},B()],{uuid,createdAt});
assert(abc.metadata.segments.map(s=>s.sourceId).join(',')==='A,B,C','flattened chronology');
assert(abc.metadata.parents.length===2&&abc.metadata.sources.length===3,'parents and original snapshots');
assert(abc.pieces.map(p=>p.inputPacketStart).join(',')==='0,0,10','nested packet offsets');
assert(abc.metadata.segments.map(s=>s.outputPacketStart).join(',')==='0,10,20','contiguous output');
assert(abc.metadata.packetCount===30&&abc.metadata.sampleCount===30720&&abc.metadata.id!==ac.metadata.id,'new identity and complete audio');
''')
 def test_repeated_occurrences_are_not_deduplicated(self):
  check(r'''
const abc=planCombinedRecording([C(),B(),A()],{uuid,createdAt});
const repeated=planCombinedRecording([A(),{filename:'ABC.m4a',metadata:abc.metadata}],{uuid,createdAt}).metadata;
assert(repeated.sources.length===3&&repeated.segments.map(s=>s.sourceId).join(',')==='A,A,B,C','duplicates retained');
assert(new Set(repeated.segments.map(s=>s.occurrenceId)).size===4,'unique occurrence identities');
''')
 def test_metadata_in_m4a_roundtrip_and_invalid_boxes(self):
  check(r'''
const meta=planCombinedRecording([B(),A()],{uuid,createdAt}).metadata,box=provenanceBox(meta);
const ftyp=new Uint8Array([0,0,0,12,102,116,121,112,77,52,65,32]);
assert(JSON.stringify(await readCombineMetadata(new Blob([ftyp,box])))===JSON.stringify(meta),'full metadata roundtrip');
assert(await readCombineMetadata(new Blob([ftyp]))===null,'ordinary M4A');
let error;try{await readCombineMetadata(new Blob([ftyp,box,box]));}catch(e){error=e;}assert(error,'duplicate provenance rejected');
error=null;try{await readCombineMetadata(new Blob([box.slice(0,box.length-1)]));}catch(e){error=e;}assert(error,'truncated box rejected');
''')
 def test_bad_history_and_incompatible_formats_rejected(self):
  check(r'''
const a=A(),b=B();b.metadata.channels=2;fails(()=>planCombinedRecording([a,b],{uuid,createdAt}),'matching');
fails(()=>planCombinedRecording([a],{uuid,createdAt}),'two');
const invalid=A().metadata;invalid.segments[0].outputPacketStart=1;fails(()=>validateCombineMetadata(invalid),'timeline');
const conflict=A();conflict.metadata.sources[0].filename='different.m4a';fails(()=>planCombinedRecording([a,conflict],{uuid,createdAt}),'Conflicting');
const bounds=A().metadata;bounds.segments[0].packetCount=11;fails(()=>validateCombineMetadata(bounds),'packet range');
''')
 def test_worker_success_cancel_failure_and_cleanup(self):
  worker=(ROOT/'js/recording-combine.js').read_text().replace('export ','').replace('import.meta.url',"'file:///worker.js'")
  evaluate(worker+r'''
const assert=(v,m)=>{if(!v)throw Error(m);};const workers=[];
class URL{};
class Worker{constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){this.stopped=true;}}
function signal(){return {aborted:false,listeners:new Set(),addEventListener(_,fn){this.listeners.add(fn);},removeEventListener(_,fn){this.listeners.delete(fn);},abort(){this.aborted=true;for(const fn of this.listeners)fn();}};}
globalThis.testResult='pending';(async()=>{
 const s=signal(),progress=[];let promise=runRecordingCombine([{blob:'source'}],{signal:s,onProgress:m=>progress.push(m)});
 workers[0].onmessage({data:{progress:'Reading'}});workers[0].onmessage({data:{result:{blob:'result'}}});
 assert((await promise).blob==='result'&&progress[0]==='Reading'&&workers[0].stopped&&s.listeners.size===0,'success cleans worker');
 const cancelled=signal();promise=runRecordingCombine([],{signal:cancelled}).catch(e=>e);cancelled.abort();
 assert((await promise).message.includes('cancelled')&&workers[1].stopped&&cancelled.listeners.size===0,'cancel cleanup');
 promise=runRecordingCombine([]).catch(e=>e);workers[2].onmessage({data:{error:'bad M4A'}});
 assert((await promise).message==='bad M4A'&&workers[2].stopped,'worker error cleanup');
 promise=runRecordingCombine([]).catch(e=>e);workers[3].onerror({message:'load failed'});
 assert((await promise).message==='load failed'&&workers[3].stopped,'load failure cleanup');
 globalThis.testResult='PASS';})().catch(e=>globalThis.testResult=String(e.stack||e));
''')

if __name__=='__main__':unittest.main()
