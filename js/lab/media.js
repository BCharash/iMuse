// Browser format declarations are hints; capture.js also checks actual start() failures.
export function createLabRecorderChoice(stream,Recorder=globalThis.MediaRecorder,onFailure=()=>{},preference='aac') {
 const aac=['audio/mp4;codecs=mp4a.40.2','audio/mp4'],webm=['audio/webm;codecs=opus','audio/webm'],ogg=['audio/ogg;codecs=opus','audio/ogg'];
 // Match production iMuse's AAC preference; retain explicit comparison modes.
 const formats=preference==='browser'?['',...aac,...webm,...ogg]:preference==='webm'?[...webm,...aac,...ogg,'']:[...aac,...webm,...ogg,''];
 const choices=formats.filter(mime=>!mime||typeof Recorder.isTypeSupported!=='function'||Recorder.isTypeSupported(mime))
  .map(mime=>({mime,create:()=>mime?new Recorder(stream,{mimeType:mime}):new Recorder(stream)}));
 const errors=[];
 while(choices.length){const choice=choices.shift();try{return {recorder:choice.create(),requestedMime:choice.mime,fallbacks:choices};}
  catch(error){const attempt={mime:choice.mime||'browser default',name:error.name,message:error.message};errors.push(attempt);onFailure(attempt);}}
 throw Error('No audio recorder could be created: '+errors.map(item=>`${item.mime}: ${item.message}`).join('; '));
}
const closingContexts=new WeakMap();
export function closeLabAudioContext(context,onError=()=>{}) {
 if(!context)return Promise.resolve();
 if(closingContexts.has(context))return closingContexts.get(context);
 if(context.state==='closed')return Promise.resolve();
 const closing=Promise.resolve().then(()=>context.state==='closed'?undefined:context.close()).catch(error=>{if(context.state!=='closed')onError(error);});
 closingContexts.set(context,closing);return closing;
}

// Model loading must not hold an idle microphone stream open in Safari.
export async function acquireLabMicrophoneAfterPreparation(preparation,acquire,isCurrent=()=>true) {
 await preparation;
 if(!isCurrent())return null;
 const stream=await acquire();
 if(!isCurrent()){stream.getTracks().forEach(track=>track.stop());return null;}
 return stream;
}
