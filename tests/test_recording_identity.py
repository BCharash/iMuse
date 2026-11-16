"""Container-native portable recording IDs. Synthetic audio; browser checks separate."""
import unittest
from pathlib import Path
from recording_test_support import evaluate
ROOT=Path(__file__).resolve().parents[1]
CORE=(ROOT/'js/recording-identity.js').read_text(encoding='utf-8').replace('export ','')
COMBINE=(ROOT/'js/recording-combine-metadata.js').read_text(encoding='utf-8').replace('export ','')
BASE=r'''
const assert=(ok,message)=>{if(!ok)throw Error(message);};
class TextEncoder{encode(text){return Uint8Array.from(unescape(encodeURIComponent(text)),c=>c.charCodeAt(0));}}
class TextDecoder{decode(input){let text='';for(let i=0;i<input.length;i+=8192)text+=String.fromCharCode(...input.slice(i,i+8192));return decodeURIComponent(escape(text));}}
class Blob{
 constructor(parts=[],options={}){this.bytes=Uint8Array.from(parts.flatMap(p=>Array.from(p instanceof Blob?p.bytes:p instanceof ArrayBuffer?new Uint8Array(p):typeof p==='string'?new TextEncoder().encode(p):p)));this.size=this.bytes.length;this.type=options.type||'';}
 slice(start,end){return new Blob([this.bytes.slice(start,end)]);}async arrayBuffer(){return this.bytes.buffer.slice(0);}async text(){return new TextDecoder().decode(this.bytes);}
}
const ID='4cd30ed1-dad7-4f9b-876c-0ba7f9d53ed9',OTHER='12345678-1234-4234-8234-123456789abc';
async function rejects(work,phrase){let failure;try{await work();}catch(e){failure=e;}assert(failure&&failure.message.includes(phrase),'Expected '+phrase+', got '+failure);}
const box=(type,body)=>join([u32(body.length+8),encoder.encode(type),body]);
const m4a=()=>new Blob([box('ftyp',encoder.encode('M4A ')),box('mdat',Uint8Array.from([1,2,3,4,5]))],{type:'audio/mp4'});
const minimalWebm=(unknown=true,clusterUnknown=false,width=3)=>{
 const info=element('1549a966',new Uint8Array()),block=element('a3',Uint8Array.from([0x81,0,0,0x80,1,2,3]));
 const cluster=clusterUnknown?join([hex('1f43b675'),new Uint8Array([255]),block]):element('1f43b675',block),body=join([info,cluster]);
 return new Blob([element('1a45dfa3',element('4282',encoder.encode('webm'))),hex('18538067'),unknown?new Uint8Array([255]):ebmlSize(body.length,width),body],{type:'audio/webm;codecs=opus'});
};
function oggFixture({large=false,vorbis=false}={}){
 const serial=0x12345678,head=vorbis?join([new Uint8Array([1]),encoder.encode('vorbis'),new Uint8Array(22)]):join([encoder.encode('OpusHead'),new Uint8Array([1,1,0,0,128,187,0,0,0,0,0])]);
 const originalComment=encoder.encode('TITLE='+(large?'x'.repeat(64900):'keep café 東京'));
 const vendor=encoder.encode('iMuse fixture'),signature=vorbis?join([new Uint8Array([3]),encoder.encode('vorbis')]):encoder.encode('OpusTags');
 const packet=join([signature,u32(vendor.length,true),vendor,u32(1,true),u32(originalComment.length,true),originalComment,vorbis?new Uint8Array([1]):new Uint8Array([0,0])]);
 const parts=[oggPage(serial,0,[head.length],head,{bos:true})];let pos=0,seq=1;
 const laces=Array(Math.floor(packet.length/255)).fill(255);laces.push(packet.length%255);
 for(let i=0;i<laces.length;i+=255){const group=laces.slice(i,i+255),length=group.reduce((n,v)=>n+v,0);parts.push(oggPage(serial,seq++,group,packet.slice(pos,pos+length),{continued:i>0,granule:i+255<laces.length?new Uint8Array(8).fill(255):new Uint8Array(8)}));pos+=length;}
 const audio=new Uint8Array([248,255,254]),granule=new Uint8Array(8);new DataView(granule.buffer).setUint32(0,960,true);
 parts.push(oggPage(serial,seq,[audio.length],audio,{eos:true,granule}));return new Blob(parts,{type:'audio/ogg;codecs=opus'});
}
async function pages(blob){let offset=0,result=[];while(offset<blob.size){const page=await readOggPage(blob,offset);result.push(page);offset=page.end;}return result;}
'''
def check(script):
 evaluate(BASE+CORE+'\nglobalThis.testResult="pending";(async()=>{'+script+'\nglobalThis.testResult="PASS";})().catch(e=>globalThis.testResult=String(e.stack||e));')

class RecordingIdentityTests(unittest.TestCase):
 def test_m4a_roundtrip_packet_bytes_idempotence_conflict(self):
  check(r'''
const original=m4a(),snapshot=original.bytes.slice(),tagged=await embedRecordingIdentity(original,ID);
assert((await readRecordingIdentity(tagged)).recordingId===ID,'identity readback');
assert(same(tagged.bytes.slice(0,original.size),snapshot)&&same(original.bytes,snapshot),'original MP4/media bytes changed');
assert(tagged.type===original.type,'MIME changed');
assert(await embedRecordingIdentity(tagged,ID)===tagged,'repeated export adds metadata');
await rejects(()=>embedRecordingIdentity(tagged,OTHER),'Conflicting');
''')
 def test_combined_m4a_history_preserved_and_identity_matches(self):
  wrapper='const history=(()=>{'+COMBINE+';return {originalCombineMetadata,provenanceBox,readCombineMetadata};})();\n'
  check(wrapper+r'''
const meta=history.originalCombineMetadata({id:ID,startedAt:'2026-11-16T09:00:00Z',mimeType:'audio/mp4'},{sampleRate:48000,channels:1,packetCount:1,sampleCount:960},'original.m4a',()=>OTHER);
const original=new Blob([m4a(),history.provenanceBox(meta)],{type:'audio/mp4'});
const tagged=await embedRecordingIdentity(original,ID);
assert(same(tagged.bytes.slice(0,original.size),original.bytes),'combined box/audio bytes changed');
assert(JSON.stringify(await history.readCombineMetadata(tagged))===JSON.stringify(meta),'combined source history changed');
await rejects(()=>embedRecordingIdentity(original,OTHER),'conflicts with combined provenance');
''')
 def test_mp4_zero_size_box_is_bounded_before_appending(self):
  check(r'''
const original=new Blob([box('ftyp',encoder.encode('M4A ')),u32(0),encoder.encode('mdat'),new Uint8Array([4,3,2,1])],{type:'audio/mp4'});
const tagged=await embedRecordingIdentity(original,ID);
assert((await readRecordingIdentity(tagged)).recordingId===ID,'zero-size box swallowed identity');
assert(same(tagged.bytes.slice(20,24),original.bytes.slice(20,24)),'mdat payload changed');
const bad=new Blob([box('ftyp',encoder.encode('M4A ')),u32(8192),encoder.encode('uuid'),boxId,new Uint8Array(8192-24)],{type:'audio/mp4'});
await rejects(()=>readRecordingIdentity(bad),'Oversized recording identity');
''')
 def test_webm_fixed_unknown_and_unknown_cluster_sizes(self):
  check(r'''
for(const original of [minimalWebm(true),minimalWebm(false),minimalWebm(true,true)]){
 const snapshot=original.bytes.slice(),tagged=await embedRecordingIdentity(original,ID);
 assert((await readRecordingIdentity(tagged)).recordingId===ID,'WebM ID missing');
 assert(same(original.bytes,snapshot),'original WebM mutated');
 const audioMarker=element('a3',Uint8Array.from([0x81,0,0,0x80,1,2,3]));
 assert(tagged.bytes.some((_,i)=>same(tagged.bytes.slice(i,i+audioMarker.length),audioMarker)),'WebM block changed');
 assert(await embedRecordingIdentity(tagged,ID)===tagged,'duplicate WebM ID');
 await rejects(()=>embedRecordingIdentity(tagged,OTHER),'Conflicting');
}
await rejects(()=>embedRecordingIdentity(minimalWebm(false,false,1),ID),'without moving audio offsets');
''')
 def test_ogg_opus_audio_granules_vendor_comments_and_page_growth(self):
  check(r'''
for(const large of [false,true]){
 const original=oggFixture({large}),before=await pages(original),tagged=await embedRecordingIdentity(original,ID),after=await pages(tagged);
 assert((await readRecordingIdentity(tagged)).recordingId===ID,'Ogg ID missing');
 assert(same(before[0].body,after[0].body)&&same(before.at(-1).body,after.at(-1).body),'Opus header/audio packet changed');
 assert(same(before.at(-1).head.slice(6,14),after.at(-1).head.slice(6,14))&&before.at(-1).serial===after.at(-1).serial,'Ogg timing/stream changed');
 assert(await embedRecordingIdentity(tagged,ID)===tagged,'duplicate Ogg ID');
 assert(after.at(-1).head[5]===4,'end-of-stream flag lost');
 if(large)assert(after.length>before.length,'comment page expansion not exercised');
 await rejects(()=>embedRecordingIdentity(tagged,OTHER),'Conflicting');
}
''')
 def test_ogg_vorbis_and_corrupt_crc(self):
  check(r'''
const original=oggFixture({vorbis:true}),tagged=await embedRecordingIdentity(original,ID);
assert((await readRecordingIdentity(tagged)).recordingId===ID,'Vorbis comment framing lost');
const before=await pages(original),after=await pages(tagged);assert(same(before.at(-1).body,after.at(-1).body),'Vorbis audio changed');
const bad=original.bytes.slice();bad[bad.length-1]^=1;
await rejects(()=>embedRecordingIdentity(new Blob([bad]),ID),'checksum mismatch');
''')
 def test_wav_keeps_pcm_and_updates_riff_size(self):
  check(r'''
const pcm=new Uint8Array([1,0,2,0,3,0,4,0]),chunks=join([encoder.encode('data'),u32(pcm.length,true),pcm]);
const original=new Blob([encoder.encode('RIFF'),u32(4+chunks.length,true),encoder.encode('WAVE'),chunks],{type:'audio/wav'});
const tagged=await embedRecordingIdentity(original,ID);
assert((await readRecordingIdentity(tagged)).recordingId===ID,'WAV ID missing');
assert(same(tagged.bytes.slice(8,original.size),original.bytes.slice(8)),'WAV chunks/PCM changed');
assert(new DataView(tagged.bytes.buffer).getUint32(4,true)+8===tagged.size,'RIFF length wrong');
assert(await embedRecordingIdentity(tagged,ID)===tagged,'duplicate WAV metadata');
''')
 def test_invalid_duplicate_future_and_unsupported_inputs(self):
  check(r'''
await rejects(()=>embedRecordingIdentity(m4a(),'not-a-uuid'),'stable recording UUID');
await rejects(()=>embedRecordingIdentity(new Blob(['not audio']),ID),'container');
const tagged=await embedRecordingIdentity(m4a(),ID),extra=tagged.bytes.slice(m4a().size);
await rejects(()=>readRecordingIdentity(new Blob([tagged,extra])),'Duplicate');
const future=encoder.encode(JSON.stringify({format:'imuse-recording',version:2,recordingId:ID}));
await rejects(()=>readRecordingIdentity(new Blob([m4a(),u32(24+future.length),encoder.encode('uuid'),boxId,future])),'Unsupported');
const bad=new Blob([box('ftyp',encoder.encode('M4A ')),u32(100),encoder.encode('mdat')]);
await rejects(()=>embedRecordingIdentity(bad,ID),'Invalid MP4 box');
''')

if __name__=='__main__':unittest.main()
