// Pure helpers for the standalone lab. No microphone, model, or production storage access.
export const SAMPLE_RATE = 16000;
export function diagnosticEvent(type,data={},at=new Date().toISOString()) {return {...data,at,type};}
export function interruptedMessage(record) {
 const reason=record.captureError||'The recorder did not finish normally';const bytes=record.audio?.size??record.bytes??0;
 return `Recording interrupted: ${reason}. ${bytes?'Available audio was retained.':'No audio was captured.'}`;
}
export function datePrefix(date = new Date()) {
 const n=value=>String(value).padStart(2,'0');
 return `${date.getFullYear()}-${n(date.getMonth()+1)}-${n(date.getDate())}_${n(date.getHours())}-${n(date.getMinutes())}-${n(date.getSeconds())}`;
}
export function filenameSuffix(text) {
 return String(text||'').replace(/^\s*(?:title|file\s*name|subject)\s*[:,-]?\s*/i,'')
  .replace(/<\|[^>]+\|>/g,'').replace(/[^\p{L}\p{N}\s-]/gu,' ').trim().split(/\s+/).slice(0,7).join('-').slice(0,70).replace(/-+$/,'');
}
// Opening-sentence keywords, in spoken order. Keep negations and topic words.
export function filenameKeywords(text) {
 const common=new Set(('a an the and or but so as at by for from in into of on onto to with about after before between during over under is am are was were be been being have has had do does did i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those there here then than um uh erm hmm well okay ok hello hi hey imuse doc docs friday please just really very also today now').split(' '));
 const sentences=(String(text||'').replace(/<\|[^>]+\|>/g,'').match(/[^.!?]+[.!?]*/g)||[]).slice(0,2);
 for(const sentence of sentences){
  const opening=sentence.trim()
   .replace(/^(?:(?:hey\s+(?:imuse|doc|friday)|hello|hi|okay|ok)[,!.]?\s*)+/i,'')
   .replace(/^(?:(?:today\s+)?I\s+(?:want to|would like to|am going to)\s+(?:talk about|discuss)|(?:this is|lets|let’s|let us)\s+(?:a recording about|talk about|discuss)|(?:title|subject|file name)\s*:)\s*/i,'');
  const words=opening.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)||[];
  const selected=[],seen=new Set();
  for(const word of words){const key=word.toLowerCase();if(common.has(key)||seen.has(key))continue;
   if(selected.length===6||[...selected,word].join('-').length>48)break;selected.push(word);seen.add(key);}
  if(selected.length)return selected.join('-');
 }
 return '';
}
export function filename(prefix,suffix,extension) {const clean=filenameSuffix(suffix);return `${prefix}${clean?'_'+clean:''}.${extension}`;}
export function audioExtension(mime='') {return mime.includes('mp4')?'m4a':mime.includes('webm')?'webm':mime.includes('ogg')?'ogg':'audio';}
export function rmsDb(samples) {let sum=0;for(const v of samples)sum+=v*v;return sum>0?10*Math.log10(sum/samples.length):-Infinity;}
// Silero v5 expects 64 preceding audio samples plus each new 512-sample block.
// https://github.com/snakers4/silero-vad/blob/v5.1/src/silero_vad/utils_vad.py
export class SileroV5Context {
 constructor(){this.reset();}
 reset(){this.samples=new Float32Array(64);}
 prepend(frame){
  if(frame.length!==512)throw Error('Silero v5 requires 512 new samples at 16 kHz');
  const input=new Float32Array(576);input.set(this.samples);input.set(frame,64);
  this.samples=frame.slice(-64);return input;
 }
}
export function evaluateSpeechGate(history,end,{enabled=true,threshold=.6,minimumDb=null,inputDb=-Infinity}={}) {
 const recent=history.filter(frame=>frame.end<=end&&end-frame.end<=SAMPLE_RATE);
 const positive=recent.filter(frame=>frame.prob>=threshold);
 const max=recent.reduce((value,frame)=>Math.max(value,frame.prob),0);
 const speechPass=positive.length>=2;
 const levelPass=minimumDb===null||inputDb>=minimumDb;
 return {pass:(!enabled||speechPass)&&levelPass,speechPass,levelPass,speechMax:max,speechFrames:positive.length};
}
export function joinFloat(chunks) {const out=new Float32Array(chunks.reduce((n,x)=>n+x.length,0));let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}
// Windowed-sinc anti-aliasing with fractional phases; state survives callback boundaries.
export class StreamingResampler {
 constructor(inputRate,outputRate=SAMPLE_RATE) {
  if(inputRate<outputRate)throw Error('Input sample rate is below the lab’s 16 kHz requirement');
  this.step=inputRate/outputRate;this.radius=32;this.buffer=new Float32Array(0);this.base=0;this.position=0;
  const cutoff=.44*outputRate/inputRate;
  this.kernels=Array.from({length:128},(_,phase)=>{
   const taps=new Float64Array(this.radius*2+1);let sum=0;
   for(let i=-this.radius;i<=this.radius;i++){const d=i-phase/128,angle=2*Math.PI*cutoff*d;
    const sinc=Math.abs(angle)<1e-12?1:Math.sin(angle)/angle;
    const weight=2*cutoff*sinc*(.5+.5*Math.cos(Math.PI*d/(this.radius+1)));taps[i+this.radius]=weight;sum+=weight;}
   for(let i=0;i<taps.length;i++)taps[i]/=sum;return taps;
  });
 }
 push(input) {
  const joined=new Float32Array(this.buffer.length+input.length);joined.set(this.buffer);joined.set(input,this.buffer.length);this.buffer=joined;
  const end=this.base+this.buffer.length,output=[];
  while(Math.floor(this.position)+this.radius<end){
   const center=Math.floor(this.position),fraction=this.position-center;
   const weights=this.kernels[Math.min(127,Math.floor(fraction*128))];let value=0;
   for(let tap=-this.radius;tap<=this.radius;tap++){const index=center+tap-this.base;if(index>=0)value+=this.buffer[index]*weights[tap+this.radius];}
   output.push(value);this.position+=this.step;
  }
  const remove=Math.max(0,Math.floor(this.position)-this.radius-this.base);
  if(remove){this.buffer=this.buffer.slice(remove);this.base+=remove;}
  return Float32Array.from(output);
 }
}
