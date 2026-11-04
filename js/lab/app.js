import { datePrefix, filename, filenameSuffix, audioExtension, diagnosticEvent } from './core.js';
import { createLabStore } from './store.js';
import { createLabCapture } from './capture.js';
const $=id=>document.getElementById(id),store=createLabStore(),records=new Map(),rows=new Map(),pendingCaptures=new Set(),deleting=new Set();
let current=null,preparing=false,preparingCleanup=null,maintenance=false,generation=0,temporaryStream=null,playerUrl=null,whisper=null,whisperReady=false,whisperLoading=null,whisperSerial=0;
let events=[],displayStart=0,candidates=0,accepted=0,rejected=0,titleRequests=new Map(),offlinePreparing=false;
const status=text=>$('status').textContent=text;
const modelStatus=text=>$('modelStatus').textContent=text;
const settings=()=>({engine:$('engine').value,threshold:Number($('wakeThreshold').value),requireSpeech:$('speechGate').checked,speechThreshold:Number($('speechThreshold').value),minimumDb:$('levelGate').checked?Number($('minimumDb').value):null});
function log(type,data={}) {events.push(diagnosticEvent(type,data));if(type==='wake')renderEvents();}
function renderEvents() {
 $('events').replaceChildren();for(const event of events.slice(displayStart).filter(event=>event.type==='wake').slice(-100).reverse()){
  const row=document.createElement('tr');for(const value of [new Date(event.at).toLocaleTimeString(),event.accepted?'Accepted':event.speechPass?'Rejected: level':'Rejected: speech',event.prob?.toFixed(3),event.speechMax?.toFixed(3),event.inputDb?.toFixed(1)??'−∞',event.transportMs]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('events').append(row);
 }
 $('counts').textContent=`${candidates} candidates · ${accepted} accepted · ${rejected} rejected`;
}
function download(name,blob) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function controls() {
 const busy=preparing||!!current;
 $('record').disabled=busy||offlinePreparing||maintenance;$('stop').disabled=!busy;$('pause').disabled=!current||current.stopping;
 $('prepare').disabled=busy||offlinePreparing||maintenance;$('clearRecordings').disabled=busy||maintenance||pendingCaptures.size>0||records.size===0;$('pause').textContent=current?.recorder.state==='paused'?'Resume':'Pause';
 for(const id of ['engine','wakeThreshold','wakeAction','speechGate','speechThreshold','agc','noise','echo','levelGate','minimumDb'])$(id).disabled=busy;
 for(const record of records.values())renderRecord(record);
}
function showPlayer(record) {
 if(current||preparing){status('Stop recording before playback.');return;}
 if(!record.audio?.size)return;
 if(playerUrl)URL.revokeObjectURL(playerUrl);playerUrl=URL.createObjectURL(record.audio);$('player').src=playerUrl;$('player').hidden=false;$('playing').textContent=filename(record.prefix,record.suffix,audioExtension(record.mime));
 $('player').play().catch(error=>status('Use the player’s Play control: '+error.message));
}
function renderRecord(record) {
 let row=rows.get(record.id);
 if(!row){
  const box=document.createElement('div');box.className='recording';const name=document.createElement('p'),description=document.createElement('p');description.className='muted';
  const suffix=document.createElement('input');suffix.type='text';suffix.placeholder='Optional title after date and time';suffix.setAttribute('aria-label','Recording title');suffix.maxLength=90;
  suffix.onchange=async()=>{record.suffix=filenameSuffix(suffix.value);suffix.value=record.suffix;try{if(!deleting.has(record.id))await store.put({...record});record.saved=true;}catch(error){record.saved=false;record.storageError=String(error);}renderRecord(record);};
  const suggestion=document.createElement('p');suggestion.className='muted';const actions=document.createElement('div');actions.className='actions';
  const play=document.createElement('button');play.textContent='▶ Play';play.onclick=()=>showPlayer(record);
  const save=document.createElement('button');save.textContent='Download';save.onclick=()=>download(filename(record.prefix,record.suffix,audioExtension(record.mime)),record.audio);
  const use=document.createElement('button');use.textContent='Use suggested name';use.onclick=async()=>{record.suffix=record.suggestedSuffix;suffix.value=record.suffix;try{if(!deleting.has(record.id))await store.put({...record});record.saved=true;}catch(error){record.saved=false;record.storageError=String(error);}renderRecord(record);};
  const remove=document.createElement('button');remove.textContent='Delete';remove.onclick=async()=>{if(pendingCaptures.has(record.id))return;if(!confirm('Permanently delete this lab recording?'))return;deleting.add(record.id);try{await store.delete(record.id);records.delete(record.id);rows.delete(record.id);box.remove();controls();}catch(error){deleting.delete(record.id);status('Could not delete: '+error.message);}};
  actions.append(play,save,use,remove);box.append(name,description,suffix,suggestion,actions);$('recordings').prepend(box);row={box,name,description,suffix,suggestion,play,save,use,remove};rows.set(record.id,row);
 }
 row.name.textContent=filename(record.prefix,record.suffix,audioExtension(record.mime));if(document.activeElement!==row.suffix)row.suffix.value=record.suffix||'';
 row.description.textContent=`${record.state} · ${((record.audio?.size||record.bytes||0)/1024).toFixed(1)} KB · ${['recording','paused','starting'].includes(record.state)?(record.storageError?'Memory only':'Saving chunks locally'):(record.saved?'Saved locally':'Memory only')}`+(record.storageError?' · Storage error; download before leaving.':'')+(record.captureError?' · '+record.captureError:'');
 row.suggestion.textContent=record.namingStatus||'Filename suggestion pending.';
 row.play.disabled=!!current||preparing||!record.audio?.size;row.save.disabled=!record.audio?.size;row.remove.disabled=pendingCaptures.has(record.id)||maintenance;row.suffix.disabled=pendingCaptures.has(record.id)||maintenance;
 row.use.disabled=!record.suggestedSuffix||pendingCaptures.has(record.id)||maintenance;
}
async function loadLibrary() {
 try{for(const record of await store.list()){
  if(!record.audio){const chunks=(await store.chunks(record.id)).sort((a,b)=>a.sequence-b.sequence);const contiguous=chunks.every((chunk,index)=>chunk.sequence===index);
   record.audio=new Blob(chunks.map(chunk=>chunk.audio),{type:record.mime});record.state='interrupted';record.namingStatus='Recovered available recording data. Playback may be incomplete.';if(!contiguous)record.captureError='Saved chunks have gaps.';}
  record.saved=true;records.set(record.id,record);renderRecord(record);
 }}catch(error){status('Recording storage unavailable. New recordings will remain in memory: '+error.message);}finally{controls();}
}
const libraryReady=loadLibrary();
let swReady=Promise.resolve();
if('serviceWorker' in navigator&&location.protocol!=='file:') {
 swReady=Promise.all(['lab.html','js/lab/'].map(async scope=>{
  const registration=await navigator.serviceWorker.register('lab-sw.js',{scope:new URL(scope,location.href).pathname});
  if(registration.active)return;
  const worker=registration.installing||registration.waiting;if(!worker)throw Error('Offline worker did not start');
  await new Promise((resolve,reject)=>{const check=()=>{if(worker.state==='activated')resolve();else if(worker.state==='redundant')reject(Error('Offline worker installation failed'));};worker.addEventListener('statechange',check);check();});
 })).catch(error=>{modelStatus('Offline page caching unavailable: '+error.message);});
}
async function prepareOffline() {
 if(current||preparing||offlinePreparing||maintenance)return;offlinePreparing=true;controls();
 try {
  await swReady;const manifest=await (await fetch('js/lab/manifest.json',{cache:'no-store'})).json();const cache=await caches.open('imuse-simple-lab-v1');let bytes=0;
  for(let i=0;i<manifest.assets.length;i++){const asset=manifest.assets[i],url=new URL(asset.path,location.href).href;
   modelStatus(`Preparing offline: ${i+1}/${manifest.assets.length} files · ${(bytes/1048576).toFixed(0)} MB`);
   if(!await cache.match(url)){const response=await fetch(url);if(!response.ok)throw Error(`${asset.path}: ${response.status}`);await cache.put(url,response);}bytes+=asset.bytes;
  }
  await prepareWhisper();modelStatus(`Offline files cached (${(bytes/1048576).toFixed(0)} MB). Whisper ready. Test offline reload before relying on it.`);
 }catch(error){modelStatus('Offline preparation failed: '+error.message);}finally{offlinePreparing=false;controls();}
}
$('prepare').onclick=prepareOffline;
function prepareWhisper() {
 if(whisperReady)return Promise.resolve();if(whisperLoading)return whisperLoading;
 whisperLoading=new Promise((resolve,reject)=>{
  if(!whisper){whisper=new Worker(new URL('./whisper-worker.js',import.meta.url),{type:'module'});
   whisper.onerror=error=>{reject(Error(error.message||'Whisper worker failed'));for(const request of titleRequests.values())request.reject(Error('Whisper worker failed'));titleRequests.clear();whisper.terminate();whisper=null;whisperReady=false;whisperLoading=null;};
   whisper.onmessage=event=>{
    const message=event.data;
    if(message.type==='progress'){if(message.progress.status==='progress')modelStatus('Loading Whisper: '+(message.progress.file||'model')+' '+Math.round(message.progress.progress||0)+'%');}
    else if(message.type==='ready'){whisperReady=true;whisperLoading=null;modelStatus('Whisper tiny.en ready for local filename suggestions.');resolve();}
    else if(message.type==='transcript'||message.type==='error'){
     if(message.id!==undefined){const request=titleRequests.get(message.id);if(request){titleRequests.delete(message.id);message.type==='error'?request.reject(Error(message.message)):request.resolve(message.text);}}
     else {whisperLoading=null;whisperReady=false;whisper.terminate();whisper=null;reject(Error(message.message));}
    }
   };
  }
  whisper.postMessage({type:'prepare'});
 });return whisperLoading;
}
async function suggestName(capture) {
 const record=capture.record;if(!records.has(record.id)||deleting.has(record.id))return;if(!$('autoName').checked){record.namingStatus='Automatic filename suggestions are off.';renderRecord(record);return;}
 record.namingStatus='Preparing filename suggestion…';renderRecord(record);
 try{
  const samples=await Promise.race([capture.titleAudio,new Promise(resolve=>setTimeout(()=>resolve(null),4000))]);
  if(!samples?.length){record.namingStatus='No opening speech was captured for a suggestion. You can enter a title.';return;}
  await prepareWhisper();record.namingStatus='Transcribing opening speech locally…';renderRecord(record);
  const text=await new Promise((resolve,reject)=>{const id=++whisperSerial;const timer=setTimeout(()=>{titleRequests.delete(id);reject(Error('Transcription timed out'));},120000);
   titleRequests.set(id,{resolve:text=>{clearTimeout(timer);resolve(text);},reject:error=>{clearTimeout(timer);reject(error);}});whisper.postMessage({type:'transcribe',id,samples},[samples.buffer]);});
  if(!records.has(record.id)||deleting.has(record.id))return;record.transcript=text;record.suggestedSuffix=filenameSuffix(text);record.namingStatus=record.suggestedSuffix?'Suggested: '+filename(record.prefix,record.suggestedSuffix,audioExtension(record.mime)):'No useful text found. You can enter a title.';
 }catch(error){record.namingStatus='Filename suggestion unavailable: '+error.message;}
 finally{if(records.has(record.id)&&!deleting.has(record.id)){try{if(!deleting.has(record.id))await store.put({...record});record.saved=true;}catch(error){record.saved=false;record.storageError=String(error);}renderRecord(record);}}
}
function stopAnalysis(capture) {
 if(capture.analysisStopped)return;capture.analysisStopped=true;
 capture.processor?.disconnect();capture.source?.disconnect();capture.silent?.disconnect();if(capture.processor)capture.processor.onaudioprocess=null;
 void capture.context?.close();capture.stream?.getTracks().forEach(track=>track.stop());
 if(capture.detectorReady)capture.worker.postMessage({type:'finish'});else capture.resolveTitle(null);
 setTimeout(()=>{capture.worker?.terminate();capture.resolveTitle(null);},4500);
}
function togglePause() {
 if(!current||current.stopping)return;
 try{current.recorder.state==='paused'?current.recorder.resume():current.recorder.pause();current.record.state=current.recorder.state;log('recording-state',{id:current.record.id,state:current.recorder.state});controls();}catch(error){status(error.message);}
}
async function start() {
 if(current||preparing||offlinePreparing||maintenance)return;await libraryReady;if(current||preparing||offlinePreparing||maintenance)return;
 preparing=true;const run=++generation;controls();$('player').pause();status('Opening microphone and preparing speech detection…');
 let stream,context,capture,worker;
 try {
  stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},autoGainControl:{ideal:$('agc').checked},noiseSuppression:{ideal:$('noise').checked},echoCancellation:{ideal:$('echo').checked}}});
  if(run!==generation){stream.getTracks().forEach(track=>track.stop());return;}temporaryStream=stream;
  context=new AudioContext();await context.resume();worker=new Worker(new URL('./detection-worker.js',import.meta.url),{type:'module'});
  const config=settings();let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  let resolveTitle;const titleAudio=new Promise(resolve=>resolveTitle=resolve);const pending=new Set();let packet=0,resetNext=false;
  worker.onmessage=event=>{
   const message=event.data;if(message.generation!==run)return;
   if(message.type==='ready')readyResolve();
   else if(message.type==='error'){readyReject(Error(message.message));if(capture){capture.detectorReady=false;worker.terminate();resolveTitle(null);}$('detectionStatus').textContent='Detection unavailable: '+message.message;log('detection-error',{id:capture?.record.id,message:message.message});}
   else if(message.type==='ack')pending.delete(message.id);
   else if(message.type==='gap'){log('analysis-gap',{id:capture?.record.id,reason:message.reason});$('detectionStatus').textContent='Analysis skipped delayed audio; recording continues.';}
   else if(message.type==='title-audio'){resolveTitle(message.samples);worker.terminate();}
   else if(message.type==='measurement'){
    log('measurement',{...message,id:capture?.record.id});
    $('levels').textContent=`Wake score ${Number(message.prob||0).toFixed(3)} · Speech score ${Number(message.speech||0).toFixed(3)} · Input ${message.inputDb?.toFixed(1)??'−∞'} dBFS`;
    if(message.candidate){candidates++;message.accepted?accepted++:rejected++;log('wake',{...message,id:capture?.record.id});
     if(message.accepted&&$('wakeAction').value==='toggle'&&current===capture&&!capture.stopping)togglePause();}
   }
  };
  worker.onerror=event=>{readyReject(Error(event.message||'Detection worker failed'));if(capture){capture.detectorReady=false;worker.terminate();resolveTitle(null);}$('detectionStatus').textContent='Detection worker failed; audio recording remains available.';};
  preparingCleanup=()=>{readyReject(Error('Preparation cancelled'));worker.terminate();void context.close();stream.getTracks().forEach(track=>track.stop());};
  worker.postMessage({type:'prepare',options:config,sampleRate:context.sampleRate,generation:run});
  let detectorReady=true;try{await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Model preparation timed out')),45000))]);$('detectionStatus').textContent='Speech detector ready · '+(config.engine==='off'?'wake detector off':config.engine+' ready');}
  catch(error){if(run!==generation)return;detectorReady=false;worker.terminate();resolveTitle(null);$('detectionStatus').textContent='Recording without detection: '+error.message;}
  if(run!==generation){worker.terminate();await context.close();stream.getTracks().forEach(track=>track.stop());return;}
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
  const record={id:crypto.randomUUID(),prefix:datePrefix(),startedAt:new Date().toISOString(),suffix:'',mime:recorder.mimeType,state:'starting',saved:false,settings:config,microphone:stream.getAudioTracks()[0].getSettings(),namingStatus:'Opening speech will be used after Stop.'};
  capture=createLabCapture({recorder,record,store,onUpdate:c=>{renderRecord(c.record);if(c.record.state==='interrupted'&&current===c){current=null;preparing=false;controls();status('Recording interrupted. Available audio was retained.');}},
   onStopped:c=>stopAnalysis(c),onFinalized:c=>{pendingCaptures.delete(c.record.id);if(current===c){current=null;preparing=false;status('Stopped. Recording retained.');}controls();void suggestName(c);}});
  Object.assign(capture,{stream,context,worker,titleAudio,resolveTitle,detectorReady});
  records.set(record.id,record);pendingCaptures.add(record.id);current=capture;
  if(detectorReady){capture.source=context.createMediaStreamSource(stream);capture.processor=context.createScriptProcessor(1024,1,1);capture.silent=context.createGain();capture.silent.gain.value=0;
   capture.source.connect(capture.processor);capture.processor.connect(capture.silent);capture.silent.connect(context.destination);
   capture.processor.onaudioprocess=event=>{event.outputBuffer.getChannelData(0).fill(0);if(current!==capture||capture.stopping||!capture.detectorReady)return;
    if(pending.size>=8){resetNext=true;log('analysis-gap',{id:record.id,reason:'Analysis queue limit reached'});return;}
    const pcm=event.inputBuffer.getChannelData(0).slice(),id=++packet;pending.add(id);
    worker.postMessage({type:'audio',pcm,id,generation:run,sentAt:Date.now(),sampleRate:context.sampleRate,recording:recorder.state==='recording',reset:resetNext},[pcm.buffer]);resetNext=false;
   };
  }
  const began=await capture.start();preparingCleanup=null;if(!began)return;preparing=false;temporaryStream=null;controls();status('Recording. Say the subject near the beginning for a filename suggestion.');log('recording-started',{id:record.id,settings:config,microphone:record.microphone});
  stream.getAudioTracks()[0].addEventListener('ended',()=>{if(current===capture&&!capture.stopping){record.captureError='Microphone ended';capture.stop();}});
  $('microphone').textContent=stream.getAudioTracks()[0].label+' · Browser reports '+JSON.stringify(record.microphone);
 }catch(error){worker?.terminate();void context?.close();stream?.getTracks().forEach(track=>track.stop());if(run!==generation)return;preparingCleanup=null;if(capture){capture.record.captureError=String(error);capture.stop();}preparing=false;temporaryStream=null;if(current===capture)current=null;controls();status('Could not start recording: '+error.message);}
}
$('record').onclick=start;$('pause').onclick=togglePause;$('stop').onclick=()=>{if(preparing&&!current){generation++;preparingCleanup?.();preparingCleanup=null;preparing=false;temporaryStream?.getTracks().forEach(track=>track.stop());temporaryStream=null;controls();status('Preparation cancelled.');return;}if(current){current.stop();controls();status('Finishing recording…');}};
$('engine').onchange=()=>{$('wakeThreshold').value=$('engine').value==='voicute'?.9:.7;};
$('clearRecordings').onclick=async()=>{
 if(current||preparing||maintenance||pendingCaptures.size)return;
 if(!confirm('Permanently delete all recordings and their saved chunks from this lab? iMuse recordings and the old comparison lab are unaffected.'))return;
 maintenance=true;const ids=[...records.keys()];ids.forEach(id=>deleting.add(id));controls();
 try{await store.clear();$('player').pause();$('player').removeAttribute('src');$('player').load();$('player').hidden=true;$('playing').textContent='';if(playerUrl)URL.revokeObjectURL(playerUrl);playerUrl=null;records.clear();rows.clear();$('recordings').replaceChildren();status('Lab recordings cleared.');}
 catch(error){ids.forEach(id=>deleting.delete(id));status('Could not clear recordings; loaded audio was kept: '+error.message);}finally{maintenance=false;controls();}
};
$('clearLog').onclick=()=>{displayStart=events.length;renderEvents();};
$('exportLog').onclick=()=>download('RecorderLab-diagnostics-'+Date.now()+'.json',new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),events,recordings:[...records.values()].map(({audio,...record})=>record)},null,2)],{type:'application/json'}));
setInterval(()=>{if(!current)return;const seconds=Math.floor((Date.now()-Date.parse(current.record.startedAt))/1000);$('elapsed').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;},500);
globalThis.recorderLab={records,events,settings,prepareWhisper,start,get current(){return current;}};
