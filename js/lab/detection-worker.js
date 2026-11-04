import * as ort from './vendor/ort.min.mjs';
import { WakeWordDetector } from '../heed/wakeword.js';
import { StreamingResampler, SAMPLE_RATE, evaluateSpeechGate, rmsDb, joinFloat } from './core.js';
globalThis.ort=ort;globalThis.window=globalThis;
ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
let engineName='heed',options={},vadSession,heed,voicute,resampler,state,buffer=new Float32Array(0),wakePending=new Float32Array(0);
let rolling=new Float32Array(0),history=[],position=0,lastWakeEnd=0,serial=Promise.resolve(),title=[],titleCount=0,titleStarted=false,titlePre=[],runGeneration=0;
const send=data=>self.postMessage(data);
function resetSignal() {state=new ort.Tensor('float32',new Float32Array(256),[2,1,128]);buffer=new Float32Array(0);wakePending=new Float32Array(0);rolling=new Float32Array(0);history=[];heed?.reset();voicute?.reset();lastWakeEnd=position;}
async function prepare(message) {
 options=message.options;engineName=options.engine;
 resampler=new StreamingResampler(message.sampleRate);position=0;title=[];titleCount=0;titleStarted=false;titlePre=[];runGeneration=message.generation;
 vadSession=await ort.InferenceSession.create(new URL('./vendor/silero_vad_v5.onnx',import.meta.url).href,{executionProviders:['wasm']});
 if(engineName==='heed') {
  const meta=await (await fetch(new URL('../heed/wake.json',import.meta.url))).json();
  const session=await ort.InferenceSession.create(new URL('../heed/wake.onnx',import.meta.url).href,{executionProviders:['wasm']});
  await session.run({mel:new ort.Tensor('float32',new Float32Array(40*101),[1,40,101])});
  heed=new WakeWordDetector(session,meta);heed.threshold=options.threshold;
 }else if(engineName==='voicute') {
  await import('./vendor/voicute.js');voicute=globalThis.VoicuteWakeWord.create();
  await voicute.load(new URL('./models/voicute/model_info.json',import.meta.url).href,new URL('./models/voicute/melspectrogram.onnx',import.meta.url).href);
  voicute.setThreshold(options.threshold);voicute.setL1(true);voicute.setL3(true);voicute.setL2(false);voicute.setL4(false);voicute.setL5(false);
  await voicute.predict(new Float32Array(voicute.audioSamplesNeeded()));
 }
 resetSignal();send({type:'ready',generation:runGeneration});
}
function collectTitle(frame,prob,recording) {
 if(!recording)return;
 if(!titleStarted){titlePre.push(frame.slice());while(titlePre.length>10)titlePre.shift();
  if(history.filter(item=>position-item.end<=SAMPLE_RATE&&item.prob>=options.speechThreshold).length<2)return;titleStarted=true;title=titlePre;titlePre=[];titleCount=title.reduce((n,x)=>n+x.length,0);return;}
 if(titleCount>=15*SAMPLE_RATE)return;
 const part=frame.slice(0,Math.min(frame.length,15*SAMPLE_RATE-titleCount));title.push(part);titleCount+=part.length;
}
async function consume(message) {
 if(message.generation!==runGeneration)return;
 const started=performance.now();
 if(Date.now()-message.sentAt>350){resetSignal();resampler=new StreamingResampler(message.sampleRate);send({type:'gap',generation:runGeneration,reason:'Stale analysis audio discarded'});return;}
 if(message.reset){resetSignal();resampler=new StreamingResampler(message.sampleRate);}
 const pcm=resampler.push(message.pcm);buffer=joinFloat([buffer,pcm]);
 while(buffer.length>=512) {
  const frame=buffer.slice(0,512);buffer=buffer.slice(512);position+=512;
  const result=await vadSession.run({input:new ort.Tensor('float32',frame,[1,512]),state,sr:new ort.Tensor('int64',BigInt64Array.from([16000n]),[])});
  state=result.stateN;const speech=Number(result.output.data[0]);history.push({end:position,prob:speech});while(history.length&&history[0].end<position-SAMPLE_RATE)history.shift();
  collectTitle(frame,speech,message.recording);
  rolling=joinFloat([rolling,frame]);if(rolling.length>32000)rolling=rolling.slice(-32000);
  let prediction=null;
  if(engineName==='heed') {
   wakePending=joinFloat([wakePending,frame]);
   if(wakePending.length>=1600){const part=wakePending.slice(0,1600);wakePending=wakePending.slice(1600);prediction=await heed.step(part);}
  }else if(engineName==='voicute') {
   const count=voicute.audioSamplesNeeded();
   if(rolling.length>=count&&position-lastWakeEnd>=1600){lastWakeEnd=position;const raw=rolling.slice(-count);for(let i=0;i<raw.length;i++)raw[i]*=32767;
    const r=await voicute.predict(raw);prediction={...r,triggered:!!voicute.detect(r.word,r.prob,r.consFrames,options.threshold,1500,Date.now(),r.sigmoid)};}
  }
  if(engineName==='off'&&position%2048===0)prediction={prob:0,triggered:false};
  if(prediction) {
   const inputDb=rmsDb(rolling.slice(-SAMPLE_RATE));const gate=evaluateSpeechGate(history,position,{enabled:options.requireSpeech,threshold:options.speechThreshold,minimumDb:options.minimumDb,inputDb});
   send({type:'measurement',generation:runGeneration,engine:engineName,seconds:position/SAMPLE_RATE,prob:prediction.prob,speech,inputDb:Number.isFinite(inputDb)?inputDb:null,
    candidate:!!prediction.triggered,accepted:!!prediction.triggered&&gate.pass,...gate,analysisMs:performance.now()-started,transportMs:Date.now()-message.sentAt,gateEnabled:options.requireSpeech,threshold:options.threshold,recentSpeech:history.map(item=>item.prob)});
  }
 }
}
self.onmessage=event=>{
 const message=event.data;
 serial=serial.then(async()=>{
  if(message.type==='prepare')await prepare(message);
  else if(message.type==='audio') {try{await consume(message);}finally{send({type:'ack',id:message.id,generation:message.generation});}}
  else if(message.type==='finish'){const samples=joinFloat(title);self.postMessage({type:'title-audio',generation:runGeneration,samples},[samples.buffer]);}
 }).catch(error=>send({type:'error',generation:message.generation,message:String(error.stack||error)}));
};
