import * as ort from './vendor/ort.min.mjs';
import { evaluateFreshSpeech } from './fresh-speech.js';
ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
let session,serial=Promise.resolve();
self.onmessage=({data:message})=>{
 serial=serial.then(async()=>{
  try{
   if(message.type==='prepare'){
    session=await ort.InferenceSession.create(new URL('./vendor/silero_vad_v5.onnx',import.meta.url).href,{executionProviders:['wasm']});
    await evaluateFreshSpeech(session,ort,new Float32Array(512),{window:{start:0,end:512},threshold:.6});
    self.postMessage({type:'ready'});
   }else if(message.type==='evaluate'){
    if(!session)throw Error('Fresh speech model is not prepared');
    const beganAtMs=Date.now(),result=await evaluateFreshSpeech(session,ort,message.samples,{window:message.window,threshold:message.threshold});
    self.postMessage({type:'result',id:message.id,result:{...result,dispatchToStartMs:Math.max(0,beganAtMs-message.dispatchedAtMs)}});
   }
  }catch(error){self.postMessage({type:'error',id:message.id,message:String(error.message||error)});}
 });
};
