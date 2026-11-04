import { pipeline, env } from './vendor/transformers.min.js';
env.useBrowserCache=false;env.allowLocalModels=true;env.allowRemoteModels=false;env.localModelPath=new URL('./models/',import.meta.url).href;
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;env.backends.onnx.wasm.wasmPaths=new URL('./vendor/whisper/',import.meta.url).href;
let loading,warming;
function prepare(){return loading||(loading=pipeline('automatic-speech-recognition','whisper-tiny.en',{device:'wasm',dtype:'q8',progress_callback:progress=>self.postMessage({type:'progress',progress})}).catch(error=>{loading=null;throw error;}));}
let serial=Promise.resolve();
self.onmessage=event=>{
 const message=event.data;serial=serial.then(async()=>{
 try {
  const transcriber=await prepare();
  if(message.type==='prepare'){
   // Exercise inference before recording, rather than timing first-use setup as verification.
   await (warming||(warming=transcriber(new Float32Array(16000),{max_new_tokens:1,do_sample:false}).catch(error=>{warming=null;throw error;})));
   self.postMessage({type:'ready'});return;
  }
  if(message.type==='transcribe'){
   const began=performance.now();
   const result=await transcriber(message.samples,{max_new_tokens:message.purpose==='verify'?24:64,do_sample:false,return_timestamps:false});
   self.postMessage({type:'transcript',id:message.id,text:result.text,inferenceMs:performance.now()-began});
  }
 }catch(error){self.postMessage({type:'error',id:message.id,message:String(error.stack||error)});}
});
};
