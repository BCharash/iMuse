import { pipeline, env } from './vendor/transformers.min.js';
env.useBrowserCache=false;env.allowLocalModels=true;env.allowRemoteModels=false;env.localModelPath=new URL('./models/',import.meta.url).href;
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;env.backends.onnx.wasm.wasmPaths=new URL('./vendor/whisper/',import.meta.url).href;
let loading;
function prepare(){return loading||(loading=pipeline('automatic-speech-recognition','whisper-tiny.en',{device:'wasm',dtype:'q8',progress_callback:progress=>self.postMessage({type:'progress',progress})}).catch(error=>{loading=null;throw error;}));}
let serial=Promise.resolve();
self.onmessage=event=>{
 const message=event.data;serial=serial.then(async()=>{
 try {
  const transcriber=await prepare();
  if(message.type==='prepare'){self.postMessage({type:'ready'});return;}
  if(message.type==='transcribe'){
   const result=await transcriber(message.samples,{max_new_tokens:64,do_sample:false,return_timestamps:false});
   self.postMessage({type:'transcript',id:message.id,text:result.text});
  }
 }catch(error){self.postMessage({type:'error',id:message.id,message:String(error.stack||error)});}
});
};
