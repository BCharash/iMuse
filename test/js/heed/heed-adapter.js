// Heed-specific inference adapter. Does not own the recorder or microphone.
import {WakeWordDetector} from "./wakeword.js";
const ORT_URL="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js";
let scriptPromise;
async function ensureOrt(){
 if(window.ort)return;
 if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{
  const s=document.createElement("script");s.src=ORT_URL;s.onload=resolve;s.onerror=()=>reject(new Error("ONNX Runtime unavailable"));document.head.append(s);
 });
 await scriptPromise;
 if(!window.ort)throw new Error("ONNX Runtime did not initialize");
}
export async function loadHeedWakeWord({threshold=.667,onStatus=()=>{}}={}){
 onStatus("Loading Heed Hey Doc model…");await ensureOrt();
 const base=new URL("./",import.meta.url);
 const response=await fetch(new URL("wake.json",base));if(!response.ok)throw new Error("Heed metadata HTTP "+response.status);
 const meta=await response.json();
 const session=await window.ort.InferenceSession.create(new URL("wake.onnx",base).href,{executionProviders:["wasm"]});
 const detector=new WakeWordDetector(session,meta);detector.threshold=threshold;
 let pending=new Float32Array(0),busy=false;
 const frameSize=1600; // 100 ms at 16 kHz
 return {phrase:"Hey Doc",engine:{reset(){detector.reset();pending=new Float32Array(0)},setThreshold(v){detector.threshold=v},
  async consume(raw,sampleRate){
   if(busy)return null;
   // Recorder supplies PCM samples scaled to signed 16-bit; normalize first.
   const n=Math.floor(raw.length*16000/sampleRate),scaled=new Float32Array(n);
   for(let i=0;i<n;i++){const pos=i*sampleRate/16000,lo=Math.floor(pos),hi=Math.min(lo+1,raw.length-1),f=pos-lo;scaled[i]=(raw[lo]*(1-f)+raw[hi]*f)/32767;}
   const joined=new Float32Array(pending.length+scaled.length);joined.set(pending);joined.set(scaled,pending.length);pending=joined;
   if(pending.length<frameSize)return null;
   const chunk=pending.slice(0,frameSize);pending=pending.slice(frameSize);
   busy=true;try{return await detector.step(chunk)}finally{busy=false}
  }} };
}
