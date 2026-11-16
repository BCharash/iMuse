// Portable identity only. No capture, database, naming, playback or audio decoding.
export const RECORDING_ID_BOX_UUID = "91c3892e-57a4-4f78-a983-3a19947c9c01";
const boxId = Uint8Array.from(RECORDING_ID_BOX_UUID.replaceAll("-", "").match(/../g), value => parseInt(value, 16));
const combineId = Uint8Array.from([0x69,0x4d,0x75,0x73,0x65,0x43,0x6f,0x6d,0x62,0x69,0x6e,0x65,0,0,0,1]);
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", {fatal:true});
const MAX_METADATA = 4096, MAX_COMMENTS = 1024 * 1024, TAG = "IMUSE_RECORDING_METADATA";
const check = (value, message) => { if (!value) throw Error(message); };
const ascii = bytes => String.fromCharCode(...bytes);
const same = (a,b) => a.length === b.length && a.every((n,i)=>n===b[i]);
const join = parts => { const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result; };
const u32 = (value,little=false) => { const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,value,little);return bytes; };
const bytes = async (blob,start,end) => new Uint8Array(await blob.slice(start,end).arrayBuffer());
const cloneBlob = (blob,parts) => new Blob(parts,{type:blob.type});

export function recordingIdentityPayload(recordingId) {
    check(typeof recordingId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordingId), "A stable recording UUID is required.");
    return {format:"imuse-recording",version:1,recordingId};
}
function parsePayload(data) {
    check(data.length>0 && data.length<=MAX_METADATA,"Invalid recording metadata size.");
    let meta;try{meta=JSON.parse(decoder.decode(data));}catch{throw Error("Invalid recording identity metadata.");}
    check(meta?.format==="imuse-recording"&&meta.version===1,"Unsupported recording identity format/version.");
    return recordingIdentityPayload(meta.recordingId);
}
function oneIdentity(found,next) { check(!found,"Duplicate recording identity metadata.");return next; }
async function format(blob) {
    const head=await bytes(blob,0,16);
    if(ascii(head.slice(4,8))==="ftyp")return "mp4";
    if(same(head.slice(0,4),Uint8Array.from([0x1a,0x45,0xdf,0xa3])))return "webm";
    if(ascii(head.slice(0,4))==="OggS")return "ogg";
    if(ascii(head.slice(0,4))==="RIFF"&&ascii(head.slice(8,12))==="WAVE")return "wav";
    throw Error("This audio container does not support the verified identity exporter.");
}
async function mp4(blob,data) {
    let offset=0,found=null,lastZero=null;
    while(offset<blob.size){
        const h=await bytes(blob,offset,offset+32);check(h.length>=8,"Truncated MP4 header.");
        const view=new DataView(h.buffer),type=ascii(h.slice(4,8));let size=view.getUint32(0),start=8;
        if(size===1){check(h.length>=16,"Truncated extended MP4 header.");size=view.getUint32(8)*4294967296+view.getUint32(12);start=16;}
        if(size===0){size=blob.size-offset;lastZero={offset,size};}
        check(Number.isSafeInteger(size)&&size>=start&&offset+size<=blob.size,"Invalid MP4 box length.");
        if(type==="uuid"){
            check(size>=start+16,"Truncated MP4 UUID box.");
            if(same(h.slice(start,start+16),boxId)){check(size-start-16<=MAX_METADATA,"Oversized recording identity box.");found=oneIdentity(found,parsePayload(await bytes(blob,offset+start+16,offset+size)));}
            if(data&&same(h.slice(start,start+16),combineId)){
                check(size-start-16<=MAX_COMMENTS,"Oversized combined provenance.");
                const existing=JSON.parse(decoder.decode(await bytes(blob,offset+start+16,offset+size)));
                check(existing.id===parsePayload(data).recordingId,"Recording ID conflicts with combined provenance.");
            }
        }
        offset+=size;
    }
    if(!data)return found;
    if(found){check(found.recordingId===parsePayload(data).recordingId,"Conflicting existing recording ID.");return blob;}
    let original=blob;
    if(lastZero){check(lastZero.size<=0xffffffff,"Cannot safely extend this oversized open-ended MP4 box.");original=cloneBlob(blob,[blob.slice(0,lastZero.offset),u32(lastZero.size),blob.slice(lastZero.offset+4)]);}
    return cloneBlob(blob,[original,u32(24+data.length),encoder.encode("uuid"),boxId,data]);
}

// EBML integers preserve their existing byte width, so cluster/cue offsets do
// not shift. Unknown-size MediaRecorder clusters are walked structurally.
function vint(input,offset,id=false){
    check(offset<input.length&&input[offset]!==0,"Invalid EBML integer.");let width=1,mask=128;
    while(!(input[offset]&mask)){mask>>=1;width++;}
    check(width<=(id?4:8)&&offset+width<=input.length,"Truncated EBML integer.");
    let value=id?input[offset]:input[offset]&(mask-1),unknown=!id&&value===mask-1;
    for(let i=1;i<width;i++){value=value*256+input[offset+i];unknown&&=input[offset+i]===255;}
    check(unknown||Number.isSafeInteger(value),"Oversized EBML integer.");return {value,width,unknown};
}
function ebmlSize(value,width=null){
    if(width===null){width=1;while(value>=Math.pow(2,7*width)-1)width++;}
    check(width<=8&&value<Math.pow(2,7*width)-1,"EBML size cannot grow without moving audio offsets.");
    const result=new Uint8Array(width);let n=value;for(let i=width-1;i>=0;i--){result[i]=n%256;n=Math.floor(n/256);}result[0]|=1<<(8-width);return result;
}
const hex = value => Uint8Array.from(value.match(/../g),v=>parseInt(v,16));
const element = (id,data) => join([hex(id),ebmlSize(data.length),data]);
async function webm(blob,data){
    let cacheStart=-1,cache=new Uint8Array();
    async function header(offset){
        if(offset<cacheStart||offset+12>cacheStart+cache.length){cacheStart=offset;cache=await bytes(blob,offset,Math.min(blob.size,offset+65536));}
        const at=offset-cacheStart,id=vint(cache,at,true),size=vint(cache,at+id.width);
        const start=offset+id.width+size.width;check(start<=blob.size&&(size.unknown||start+size.value<=blob.size),"Truncated EBML element.");
        return {offset,id:id.value,start,end:size.unknown?null:start+size.value,sizeAt:offset+id.width,size};
    }
    const ebml=await header(0);check(ebml.id===0x1a45dfa3&&ebml.end!==null,"Invalid WebM header.");
    const segment=await header(ebml.end);check(segment.id===0x18538067&&(segment.end===null||segment.end===blob.size),"Expected one complete WebM segment.");
    const levelOne=new Set([0x114d9b74,0x1549a966,0x1654ae6b,0x1f43b675,0x1c53bb6b,0x1941a469,0x1043a770,0x1254c367]);
    let found=null,count=0;
    async function tags(start,end,depth=0){
        check(depth<8,"Excessively nested WebM tags.");let name=null,value=null;
        for(let pos=start;pos<end;){const h=await header(pos);check(++count<1000000&&h.end!==null&&h.end<=end,"Invalid WebM metadata element.");
            if(h.id===0x45a3||h.id===0x4487){check(h.end-h.start<=MAX_METADATA,"Oversized WebM identity tag.");const text=decoder.decode(await bytes(blob,h.start,h.end));if(h.id===0x45a3)name=text;else value=text;}
            else if([0x7373,0x67c8].includes(h.id))await tags(h.start,h.end,depth+1);
            pos=h.end;
        }
        if(name===TAG){check(value!==null,"Recording identity tag has no value.");found=oneIdentity(found,parsePayload(encoder.encode(value)));}
    }
    let pos=segment.start;
    while(pos<blob.size){const h=await header(pos);check(++count<1000000,"Too many WebM elements.");
        check(h.id!==0xbf,"WebM segment checksum requires a separate verified writer.");
        if(h.id===0x1254c367){check(h.end!==null&&h.end-h.start<=MAX_COMMENTS,"Oversized WebM tags.");await tags(h.start,h.end);}
        if(h.end!==null){pos=h.end;continue;}
        check(h.id===0x1f43b675,"Unsupported unknown-size WebM element.");
        pos=h.start;
        while(pos<blob.size){const child=await header(pos);check(++count<1000000,"Too many WebM cluster elements.");if(levelOne.has(child.id))break;check(child.end!==null,"Unsupported unknown-size cluster child.");pos=child.end;}
    }
    if(!data)return found;
    if(found){check(found.recordingId===parsePayload(data).recordingId,"Conflicting existing recording ID.");return blob;}
    const tag=element("1254c367",element("7373",join([element("63c0",new Uint8Array()),element("67c8",join([element("45a3",encoder.encode(TAG)),element("4487",data)]))])));
    if(segment.size.unknown)return cloneBlob(blob,[blob,tag]);
    const size=ebmlSize(segment.size.value+tag.length,segment.size.width);
    return cloneBlob(blob,[blob.slice(0,segment.sizeAt),size,blob.slice(segment.sizeAt+size.length),tag]);
}

// Ogg payload packets remain untouched. Updating the comment packet may add
// pages; only page sequence numbers/checksums of following pages are rewritten.
function oggCrc(input){let crc=0;for(const byte of input){crc^=byte<<24;for(let bit=0;bit<8;bit++)crc=(crc&0x80000000)?(crc<<1)^0x04c11db7:crc<<1;}return crc>>>0;}
function oggPage(serial,sequence,laces,body,{continued=false,bos=false,eos=false,granule=null}={}){
    const out=new Uint8Array(27+laces.length+body.length),v=new DataView(out.buffer);out.set(encoder.encode("OggS"));out[5]=(continued?1:0)|(bos?2:0)|(eos?4:0);
    if(granule)out.set(granule,6);v.setUint32(14,serial,true);v.setUint32(18,sequence,true);out[26]=laces.length;out.set(laces,27);out.set(body,27+laces.length);v.setUint32(22,oggCrc(out),true);return out;
}
async function readOggPage(blob,offset){
    const head=await bytes(blob,offset,offset+27);check(head.length===27&&ascii(head.slice(0,4))==="OggS"&&head[4]===0,"Invalid/truncated Ogg page.");
    const laces=await bytes(blob,offset+27,offset+27+head[26]);check(laces.length===head[26],"Truncated Ogg lacing.");
    const length=27+laces.length+laces.reduce((n,v)=>n+v,0);check(offset+length<=blob.size,"Truncated Ogg payload.");
    const content=await bytes(blob,offset,offset+length),view=new DataView(content.buffer),crc=view.getUint32(22,true);view.setUint32(22,0,true);check(oggCrc(content)===crc,"Ogg page checksum mismatch.");view.setUint32(22,crc,true);
    return {offset,end:offset+length,head,laces,body:content.subarray(27+laces.length),serial:view.getUint32(14,true),sequence:view.getUint32(18,true)};
}
function comments(packet,signatureLength){
    let at=signatureLength;const v=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
    const number=()=>{check(at+4<=packet.length,"Truncated Ogg comments.");const n=v.getUint32(at,true);at+=4;return n;};
    const block=()=>{const n=number();check(n<=MAX_COMMENTS&&at+n<=packet.length,"Oversized/truncated Ogg comment.");const value=packet.slice(at,at+n);at+=n;return value;};
    const vendor=block(),n=number();check(n<=10000,"Too many Ogg comments.");const list=[];let found=null;
    for(let i=0;i<n;i++){const value=block();list.push(value);const text=decoder.decode(value);if(text.toUpperCase().startsWith(TAG+"="))found=oneIdentity(found,parsePayload(encoder.encode(text.slice(TAG.length+1))));}
    return {vendor,list,found,tail:packet.slice(at)};
}
async function ogg(blob,data){
    const first=await readOggPage(blob,0);check(first.head[5]===2&&first.sequence===0&&first.laces.length&&first.laces.at(-1)<255&&first.laces.slice(0,-1).every(n=>n===255),"Unsupported Ogg identification page.");
    const opus=ascii(first.body.slice(0,8))==="OpusHead",vorbis=first.body[0]===1&&ascii(first.body.slice(1,7))==="vorbis";
    check(opus||vorbis,"Only Ogg Opus/Vorbis identity metadata is supported.");
    let offset=first.end,sequence=1,commentPages=0,fragments=[],length=0,last=null,tailLaces=null,tailBody=null,complete=false;
    while(!complete){
        const page=await readOggPage(blob,offset);check(page.serial===first.serial&&page.sequence===sequence++&&!!(page.head[5]&1)===(commentPages>0)&&!(page.head[5]&2),"Invalid Ogg comment sequence.");
        commentPages++;let used=0;
        for(let i=0;i<page.laces.length;i++){used+=page.laces[i];if(page.laces[i]<255){tailLaces=page.laces.slice(i+1);tailBody=page.body.slice(used);complete=true;break;}}
        fragments.push(page.body.slice(0,used));length+=used;check(length<=MAX_COMMENTS,"Ogg comments exceed the supported limit.");last=page;offset=page.end;
    }
    const packet=join(fragments),signature=opus?8:7;check(opus?ascii(packet.slice(0,8))==="OpusTags":packet[0]===3&&ascii(packet.slice(1,7))==="vorbis","Missing Ogg comment header.");
    check(!opus||!tailLaces.length,"Opus comment header must finish its page.");
    const parsed=comments(packet,signature);
    if(!data)return parsed.found;
    if(parsed.found){check(parsed.found.recordingId===parsePayload(data).recordingId,"Conflicting existing recording ID.");return blob;}
    const tag=join([encoder.encode(TAG+"="),data]);
    const changed=join([packet.slice(0,signature),u32(parsed.vendor.length,true),parsed.vendor,u32(parsed.list.length+1,true),...parsed.list.flatMap(value=>[u32(value.length,true),value]),u32(tag.length,true),tag,parsed.tail]);
    const laces=[];for(let n=changed.length;n>=255;n-=255)laces.push(255);laces.push(changed.length%255);
    const parts=[blob.slice(0,first.end)];let position=0,newSequence=1;
    for(let i=0;i<laces.length;i+=255){const group=laces.slice(i,i+255),n=group.reduce((a,b)=>a+b,0),isLast=i+255>=laces.length;
        const granule=isLast?new Uint8Array(8):new Uint8Array(8).fill(255);
        parts.push(oggPage(first.serial,newSequence++,group,changed.slice(position,position+n),{continued:i>0,eos:isLast&&!tailLaces.length&&!!(last.head[5]&4),granule}));position+=n;
    }
    if(tailLaces.length)parts.push(oggPage(first.serial,newSequence++,tailLaces,tailBody,{eos:!!(last.head[5]&4),granule:last.head.slice(6,14)}));
    const shift=newSequence-sequence;
    while(offset<blob.size){const page=await readOggPage(blob,offset);check(page.serial===first.serial&&page.sequence===sequence++&&!(page.head[5]&2),"Chained/multiplexed Ogg is not supported by the identity exporter.");
        if(shift===0)parts.push(blob.slice(offset,page.end));
        else {const out=oggPage(page.serial,page.sequence+shift,page.laces,page.body,{continued:!!(page.head[5]&1),eos:!!(page.head[5]&4),granule:page.head.slice(6,14)});parts.push(out.subarray(0,27+page.laces.length),blob.slice(offset+27+page.laces.length,page.end));}
        offset=page.end;
    }
    return cloneBlob(blob,parts);
}
async function wav(blob,data){
    const h=await bytes(blob,0,12);check(new DataView(h.buffer).getUint32(4,true)+8===blob.size,"Incomplete or oversized WAV RIFF container.");
    let offset=12,found=null;
    while(offset<blob.size){const head=await bytes(blob,offset,offset+8);check(head.length===8,"Truncated WAV chunk.");const size=new DataView(head.buffer).getUint32(4,true);check(offset+8+size+(size%2)<=blob.size,"Invalid WAV chunk size.");
        if(ascii(head.slice(0,4))==="imID"){check(size<=MAX_METADATA,"Oversized recording identity chunk.");found=oneIdentity(found,parsePayload(await bytes(blob,offset+8,offset+8+size)));}offset+=8+size+(size%2);
    }
    if(!data)return found;
    if(found){check(found.recordingId===parsePayload(data).recordingId,"Conflicting existing recording ID.");return blob;}
    const chunk=join([encoder.encode("imID"),u32(data.length,true),data,...(data.length%2?[new Uint8Array(1)]:[])]);check(blob.size+chunk.length-8<=0xffffffff,"WAV exceeds RIFF size limit.");
    return cloneBlob(blob,[blob.slice(0,4),u32(blob.size+chunk.length-8,true),blob.slice(8),chunk]);
}
const containers={mp4,webm,ogg,wav};
export async function readRecordingIdentity(blob){return containers[await format(blob)](blob,null);}
export async function embedRecordingIdentity(blob,recordingId){
    const payload=recordingIdentityPayload(recordingId),data=encoder.encode(JSON.stringify(payload));
    const output=await containers[await format(blob)](blob,data);
    check((await readRecordingIdentity(output))?.recordingId===recordingId,"Recording identity failed export readback.");return output;
}
