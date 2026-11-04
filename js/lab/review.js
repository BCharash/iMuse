// Sample-based review audio, independent of MediaRecorder pause/codec timestamps.
export class ReviewBuffer {
 constructor({rate=16000,onReady}) {this.rate=rate;this.onReady=onReady;this.cursor=0;this.blocks=[];this.pending=[];}
 ingest(input) {
  this.blocks.push({start:this.cursor,data:input.slice()});this.cursor+=input.length;this.flush(false);
  const retainFrom=Math.min(this.cursor-3*this.rate,...this.pending.map(entry=>entry.start));
  while(this.blocks.length&&this.blocks[0].start+this.blocks[0].data.length<retainFrom)this.blocks.shift();
 }
 mark(metadata) {
  if(this.pending.length>=32)return false;
  this.pending.push({...metadata,eventSample:this.cursor,start:Math.max(0,this.cursor-3*this.rate),end:this.cursor+2*this.rate,sampleRate:this.rate});return true;
 }
 flush(stopping) {
  for(const entry of [...this.pending]) {
   if(!stopping&&this.cursor<entry.end)continue;
   this.pending.splice(this.pending.indexOf(entry),1);
   const start=Math.max(entry.start,this.blocks[0]?.start??this.cursor),end=Math.max(start,Math.min(entry.end,this.cursor)),pcm=new Float32Array(end-start);
   for(const block of this.blocks){const lo=Math.max(start,block.start),hi=Math.min(end,block.start+block.data.length);if(hi>lo)pcm.set(block.data.subarray(lo-block.start,hi-block.start),lo-start);}
   this.onReady({...entry,capturedStart:start,capturedEnd:end,duration:pcm.length/this.rate,eventOffset:(entry.eventSample-start)/this.rate,shortPreRoll:entry.eventSample<3*this.rate||start>entry.start,shortPostRoll:end<entry.end},pcm);
  }
 }
 gap() {this.flush(true);this.blocks=[];}
}
export function reviewClassification(event,requireSpeech=false) {
 const truth=['true positive','false negative','wake'].includes(event.review)?true:['false positive','true negative','speech','noise'].includes(event.review)?false:null;
 if(truth===null)return 'unreviewed';
 const positive=event.type==='wake'&&event.levelPass!==false&&(!requireSpeech||event.speechPass);
 return truth?(positive?'true positive':'false negative'):(positive?'false positive':'true negative');
}
export function reviewWav(pcm,rate) {
 const buffer=new ArrayBuffer(44+pcm.length*2),view=new DataView(buffer);
 const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
 ascii(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 ascii(36,'data');view.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++){const x=Math.max(-1,Math.min(1,pcm[i]));view.setInt16(44+i*2,x<0?x*32768:x*32767,true);}return buffer;
}
