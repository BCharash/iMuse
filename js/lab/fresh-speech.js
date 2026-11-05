import { SAMPLE_RATE, SileroV5Context, evaluateSpeechGate } from './core.js';

// End at the last sample actually consumed by the wake detector, not the
// later result-delivery time. Whole Silero blocks extend only the left edge.
export function detectorSpeechWindow({engine,end,windowSamples,consecutiveFrames=1,cadenceSamples=1600}) {
 const requestedSamples=windowSamples+(engine==='heed'?Math.max(0,consecutiveFrames-1)*cadenceSamples:0);
 if(!Number.isInteger(end)||!Number.isInteger(requestedSamples)||requestedSamples<=0)throw Error('Invalid detector audio window');
 const samples=Math.ceil(requestedSamples/512)*512;
 return {engine,start:end-samples,end,requestedStart:end-requestedSamples,requestedSamples,sampleRate:SAMPLE_RATE,
  samples,leadingAlignmentSamples:samples-requestedSamples};
}

// Pure inference orchestration: fresh recurrent AND audio context per candidate.
// The session/model stays warm. This never touches continuous detection state.
export async function evaluateFreshSpeech(session,ort,samples,{window,threshold=.6},now=()=>performance.now()) {
 if(!samples.length||samples.length%512||samples.length>3*SAMPLE_RATE)throw Error('Fresh speech input must contain complete blocks, up to three seconds');
 const began=now(),context=new SileroV5Context(),trace=[];
 let state=new ort.Tensor('float32',new Float32Array(256),[2,1,128]);
 const sr=new ort.Tensor('int64',BigInt64Array.from([16000n]),[]);
 for(let offset=0;offset<samples.length;offset+=512){
  const input=context.prepend(samples.subarray(offset,offset+512));
  const result=await session.run({input:new ort.Tensor('float32',input,[1,576]),state,sr});
  state=result.stateN;
  const prob=Number(result.output.data[0]);if(!Number.isFinite(prob))throw Error('Invalid Silero speech score');
  trace.push({start:window.start+offset,end:window.start+offset+512,prob});
 }
 const gate=evaluateSpeechGate(trace,window.end,{threshold});
 return {status:'complete',threshold,requiredFrames:2,window,sampleSeconds:samples.length/SAMPLE_RATE,
  speechPass:gate.speechPass,speechMax:gate.speechMax,speechFrames:gate.speechFrames,
  processingMs:now()-began,trace};
}
