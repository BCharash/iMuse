import { datePrefix, filename, filenameSuffix, filenameKeywords, audioExtension, diagnosticEvent, interruptedMessage } from './core.js';
import { reviewWav, reviewClassification } from './review.js';
import { createWakeVerifier } from './verification.js';
import { createLabStore } from './store.js';
import { createLabCapture } from './capture.js';
import { createLabRecorderChoice, closeLabAudioContext, acquireLabMicrophoneAfterPreparation } from './media.js';
const $=id=>document.getElementById(id),store=createLabStore(),records=new Map(),rows=new Map(),pendingCaptures=new Set(),deleting=new Set();
let current=null,preparing=false,preparingCleanup=null,maintenance=false,generation=0,temporaryStream=null,playerUrl=null,whisper=null,whisperReady=false,whisperLoading=null,whisperSerial=0;
let events=[],displayStart=0,titleRequests=new Map(),offlinePreparing=false;
const LAB_BUILD='2026-11-04.10';$('build').textContent='Lab build '+LAB_BUILD;
const status=text=>$('status').textContent=text;
const modelStatus=text=>$('modelStatus').textContent=text;
const settings=()=>({verifyWake:$('verifyWake').checked&&$('liveAnalysis').checked&&$('labMode').value==='wake'&&$('engine').value!=='off',autoName:$('autoName').checked,nearThreshold:Number($('nearThreshold').value),formatPreference:$('format').value,liveAnalysis:$('liveAnalysis').checked,engine:$('engine').value,threshold:Number($('wakeThreshold').value),requireSpeech:$('speechGate').checked,speechThreshold:Number($('speechThreshold').value),minimumDb:$('levelGate').checked?Number($('minimumDb').value):null});
function log(type,data={}) {events.push(diagnosticEvent(type,data));if(reviewTypes.has(type))renderEvents();}
const reviewTypes=new Set(['wake','near-wake','missed-wake','manual-negative']);
let reviewWrites=Promise.resolve();
function persistReview(event) {
 const record=records.get(event.id);if(!record||deleting.has(event.id))return;
 // During capture, finalization writes this same review array with the recording.
 if(pendingCaptures.has(event.id))return;
 reviewWrites=reviewWrites.then(async()=>{
  if(!records.has(event.id)||deleting.has(event.id))return;
  await store.put({...record});
 }).catch(error=>status('Review is in memory only; export before leaving: '+error.message));
}
function reviewMetadata(event) {const {audio,...metadata}=event;return metadata;}
function renderEvents() {
 $('events').replaceChildren();
 for(const event of events.slice(displayStart).filter(event=>reviewTypes.has(event.type)).slice(-100).reverse()){
  const row=document.createElement('tr');
  const result=event.type==='wake'?(event.accepted?'Accepted':!event.levelPass?'Rejected: level':'Rejected: speech'):event.type==='near-wake'?'Near trigger':event.type==='missed-wake'?'Manual miss':'Manual negative';
  for(const value of [new Date(event.at).toLocaleTimeString(),result,event.prob?.toFixed(3)??'—',event.speechMax?.toFixed(3)??'—',event.inputDb?.toFixed(1)??'—',event.transportMs??'—']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
  const playback=document.createElement('td'),play=document.createElement('button');play.textContent=event.audio?'▶ Play clip':'Awaiting clip';play.disabled=!!current||preparing||!event.audio?.size;play.onclick=()=>playReview(event);playback.append(play);
  const info=document.createElement('p');info.textContent=event.duration===undefined?'':`${event.duration.toFixed(1)} s · event at ${event.eventOffset.toFixed(1)} s${event.shortPreRoll?' · short pre-roll':''}${event.shortPostRoll?' · short post-roll':''}`;playback.append(info);row.append(playback);
  const review=document.createElement('td'),choice=document.createElement('select');
  for(const label of ['unreviewed','true positive','false positive','true negative','false negative']){const option=document.createElement('option');option.value=label;option.textContent=label;choice.append(option);}
  choice.value=event.review||'unreviewed';choice.onchange=()=>{event.review=choice.value;persistReview(event);renderEvents();};review.append(choice);row.append(review);
  const notesCell=document.createElement('td'),notes=document.createElement('input');notes.type='text';notes.placeholder='Background / pronunciation / notes';notes.value=event.notes||'';notes.setAttribute('aria-label','Review notes');notes.oninput=()=>{event.notes=notes.value;};notes.onchange=()=>persistReview(event);notesCell.append(notes);row.append(notesCell);
  const verification=document.createElement('td'),v=event.verification;
  verification.textContent=!v?'Off / not tested':v.status==='complete'||v.status==='late-result'?`${v.phrasePresent?'Phrase found':'Phrase not found'} · ${Math.round(v.totalMs)} ms${v.withinBudget?'':' · over 500 ms'}${v.status==='late-result'?' · late result':''}${v.shortPreRoll?' · short input':''} · “${v.text||''}”`:v.status+(v.message?' · '+v.message:'');
  if(v?.inferenceMs!==undefined)verification.title=`Whisper inference ${Math.round(v.inferenceMs)} ms; input ${v.sampleSeconds.toFixed(2)} s; shadow verdict only`;
  row.append(verification);$('events').append(row);
 }
 const reviewed=events.filter(event=>reviewTypes.has(event.type));
 const describe=gate=>{const totals={'true positive':0,'false positive':0,'true negative':0,'false negative':0,unreviewed:0};for(const event of reviewed)totals[reviewClassification(event,gate)]++;return `${totals['true positive']} TP · ${totals['false positive']} FP · ${totals['true negative']} TN · ${totals['false negative']} FN · ${totals.unreviewed} unreviewed`;};
 $('comparison').textContent=`Same sampled events: without speech gate: ${describe(false)}. With speech gate: ${describe(true)}. Level gate stays equal. Near triggers and manual marks are sampled negatives; these are not whole-session accuracy rates. Counts include saved reviews and cleared rows.`;
 const verdicts=reviewed.map(event=>event.verification).filter(Boolean),completed=verdicts.filter(v=>['complete','late-result'].includes(v.status)),times=completed.map(v=>v.totalMs).sort((a,b)=>a-b);
 const percentile=p=>Math.round(times[Math.max(0,Math.ceil(times.length*p)-1)]);
 $('verificationSummary').textContent=verdicts.length?`Whisper: ${completed.length} completed · ${verdicts.filter(v=>v.status==='skipped-busy').length} skipped busy${times.length?` · median ${percentile(.5)} ms · 95th percentile ${percentile(.95)} ms · ${completed.filter(v=>v.withinBudget).length}/${completed.length} within 500 ms`:''}. Includes saved reviews; this is added verification delay, not phrase-end response time.`:'Whisper verification is optional; results never change wake actions.';
 const wakes=events.filter(event=>event.type==='wake');
 $('counts').textContent=`${wakes.length} candidates · ${wakes.filter(event=>event.accepted).length} accepted · ${wakes.filter(event=>!event.accepted).length} rejected`;
}
function playReview(event) {
 if(current||preparing){status('Stop recording before review playback.');return;}
 if(!event.audio?.size)return;
 if(playerUrl)URL.revokeObjectURL(playerUrl);playerUrl=URL.createObjectURL(event.audio);$('player').src=playerUrl;$('player').hidden=false;
 $('playing').textContent=`Review: ${new Date(event.at).toLocaleTimeString()} · event at ${event.eventOffset.toFixed(1)} s · ${event.review||'unreviewed'}`;
 $('player').play().catch(error=>status('Use the player’s Play control: '+error.message));
}
function download(name,blob) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function controls() {
 const busy=preparing||!!current;
 $('record').disabled=busy||offlinePreparing||maintenance;$('stop').disabled=!busy;$('pause').disabled=!current||current.stopping;
 $('prepare').disabled=busy||offlinePreparing||maintenance;$('clearRecordings').disabled=busy||maintenance||pendingCaptures.size>0||records.size===0;$('pause').textContent=current?.recorder.state==='paused'?'Resume':'Pause';
 $('missedWake').disabled=!current?.detectorReady||current?.stopping||$('engine').value==='off';$('markNegative').disabled=$('missedWake').disabled;
 renderEvents();
 for(const id of ['verifyWake','nearThreshold','labMode','format','liveAnalysis','engine','wakeThreshold','wakeAction','speechGate','speechThreshold','agc','noise','echo','levelGate','minimumDb'])$(id).disabled=busy;
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
  const remove=document.createElement('button');remove.textContent='Delete';remove.onclick=async()=>{if(pendingCaptures.has(record.id))return;if(!confirm('Permanently delete this lab recording?'))return;deleting.add(record.id);try{await reviewWrites;await store.delete(record.id);events=events.filter(event=>event.id!==record.id);records.delete(record.id);rows.delete(record.id);box.remove();controls();}catch(error){deleting.delete(record.id);status('Could not delete: '+error.message);}};
  actions.append(play,save,use,remove);box.append(name,description,suffix,suggestion,actions);$('recordings').prepend(box);row={box,name,description,suffix,suggestion,play,save,use,remove};rows.set(record.id,row);
 }
 row.name.textContent=filename(record.prefix,record.suffix,audioExtension(record.mime));if(document.activeElement!==row.suffix)row.suffix.value=record.suffix||'';
 row.description.textContent=`${record.state} · ${((record.audio?.size||record.bytes||0)/1024).toFixed(1)} KB · ${['recording','paused','starting'].includes(record.state)?(record.storageError?'Memory only':'Saving chunks locally'):(record.audio?.size===0?'No audio captured':record.saved?'Saved locally':'Memory only')}`+(record.storageError?' · Storage error; download before leaving.':'')+(record.captureError?' · '+record.captureError:'');
 row.suggestion.textContent=record.namingStatus||'Filename suggestion pending.';
 row.play.disabled=!!current||preparing||!record.audio?.size;row.save.disabled=!record.audio?.size;row.remove.disabled=pendingCaptures.has(record.id)||maintenance;row.suffix.disabled=pendingCaptures.has(record.id)||maintenance;
 row.use.disabled=!record.suggestedSuffix||pendingCaptures.has(record.id)||maintenance;
}
async function loadLibrary() {
 try{for(const record of (await store.list()).sort((a,b)=>(Date.parse(a.startedAt)||0)-(Date.parse(b.startedAt)||0))){
  if(!record.audio){const chunks=(await store.chunks(record.id)).sort((a,b)=>a.sequence-b.sequence);const contiguous=chunks.every((chunk,index)=>chunk.sequence===index);
   record.audio=new Blob(chunks.map(chunk=>chunk.audio),{type:record.mime});record.state='interrupted';record.namingStatus='Recovered available recording data. Playback may be incomplete.';if(!contiguous)record.captureError='Saved chunks have gaps.';}
  record.saved=true;records.set(record.id,record);for(const review of record.reviews||[]){if(review.verification?.status==='checking')review.verification={...review.verification,status:'interrupted',message:'Page closed before verification completed'};events.push(review);}renderRecord(record);
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
    else if(message.type==='ready'){whisperReady=true;whisperLoading=null;modelStatus('Whisper tiny.en loaded and warmed up.');resolve();}
    else if(message.type==='transcript'||message.type==='error'){
     if(message.id!==undefined){const request=titleRequests.get(message.id);if(request){titleRequests.delete(message.id);message.type==='error'?request.reject(Error(message.message)):request.resolve(message);}}
     else {whisperLoading=null;whisperReady=false;whisper.terminate();whisper=null;reject(Error(message.message));}
    }
   };
  }
  whisper.postMessage({type:'prepare'});
 });return whisperLoading;
}
function transcribeVerification(samples) {
 return new Promise((resolve,reject)=>{if(!whisper||!whisperReady){reject(Error('Whisper is unavailable'));return;}const id=++whisperSerial;titleRequests.set(id,{resolve,reject});
  try{whisper.postMessage({type:'transcribe',purpose:'verify',id,samples},[samples.buffer]);}catch(error){titleRequests.delete(id);reject(error);}});
}
const wakeVerifier=createWakeVerifier({transcribe:transcribeVerification,onUpdate:(entry,verification)=>{
 const record=records.get(entry.id);if(!record||deleting.has(entry.id)||!record.reviews?.includes(entry))return;
 entry.verification=verification;persistReview(entry);renderEvents();
}});
function verifyReview(capture,message) {
 const entry=capture.record.reviews?.find(item=>item.eventId===message.eventId);
 if(!entry||!records.has(entry.id)||deleting.has(entry.id))return;
 if(!capture.verificationAvailable){entry.verification={status:'unavailable',message:'Whisper preparation failed'};persistReview(entry);renderEvents();return;}
 // Naming from a previous session must not turn live checks into a transcription queue.
 if(titleRequests.size&&!wakeVerifier.busy){entry.verification={status:'skipped-busy'};persistReview(entry);renderEvents();return;}
 void wakeVerifier.submit(entry,message.samples,{engine:capture.record.settings.engine,transportMs:Math.max(0,Date.now()-message.sentAt),shortPreRoll:message.shortPreRoll});
}
async function suggestName(capture) {
 const record=capture.record;if(!records.has(record.id)||deleting.has(record.id)||record.state==='failed')return;if(record.settings?.liveAnalysis===false){record.namingStatus='Recorder-only mode: enter a title manually.';renderRecord(record);return;}if(!record.settings?.autoName){record.namingStatus='Automatic filename suggestions are off.';renderRecord(record);return;}
 record.namingStatus='Preparing filename suggestion…';renderRecord(record);
 try{
  const samples=await Promise.race([capture.titleAudio,new Promise(resolve=>setTimeout(()=>resolve(null),4000))]);
  if(!samples?.length){record.namingStatus='No opening speech was captured for a suggestion. You can enter a title.';return;}
  await prepareWhisper();record.namingStatus='Transcribing opening speech locally…';renderRecord(record);
  const text=await new Promise((resolve,reject)=>{const id=++whisperSerial;const timer=setTimeout(()=>{titleRequests.delete(id);reject(Error('Transcription timed out'));},120000);
   titleRequests.set(id,{resolve:message=>{clearTimeout(timer);resolve(message.text);},reject:error=>{clearTimeout(timer);reject(error);}});whisper.postMessage({type:'transcribe',id,samples},[samples.buffer]);});
  if(!records.has(record.id)||deleting.has(record.id))return;record.transcript=text;record.suggestedSuffix=filenameKeywords(text);record.namingStatus=record.suggestedSuffix?'Suggested: '+filename(record.prefix,record.suggestedSuffix,audioExtension(record.mime)):'No useful text found. You can enter a title.';
 }catch(error){record.namingStatus='Filename suggestion unavailable: '+error.message;}
 finally{if(records.has(record.id)&&!deleting.has(record.id)){try{if(!deleting.has(record.id))await store.put({...record});record.saved=true;}catch(error){record.saved=false;record.storageError=String(error);}renderRecord(record);}}
}
function stopAnalysis(capture) {
 if(capture.analysisStopped)return;capture.analysisStopped=true;
 capture.processor?.disconnect();capture.source?.disconnect();capture.silent?.disconnect();if(capture.processor?.port){capture.processor.port.onmessage=null;capture.processor.port.close();}
 void closeLabAudioContext(capture.context,error=>log('context-cleanup-error',{message:error.message}));capture.stream?.getTracks().forEach(track=>track.stop());
 if(capture.detectorReady)capture.worker.postMessage({type:'finish'});else capture.resolveTitle(null);
 setTimeout(()=>{capture.worker?.terminate();capture.resolveTitle(null);},4500);
}
function togglePause() {
 if(!current||current.stopping)return;
 try{current.recorder.state==='paused'?current.recorder.resume():current.recorder.pause();current.record.state=current.recorder.state;log('recording-state',{id:current.record.id,state:current.recorder.state});controls();}catch(error){status(error.message);}
}
async function start() {
 if(current||preparing||offlinePreparing||maintenance)return;await libraryReady;if(current||preparing||offlinePreparing||maintenance)return;
 preparing=true;const run=++generation;controls();$('player').pause();status('Preparing speech and wake models before opening the microphone…');
 let stream,context,capture,worker;
 try {
  const config=settings();if(config.liveAnalysis)worker=new Worker(new URL('./detection-worker.js',import.meta.url),{type:'module'});
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  let resolveTitle;const titleAudio=new Promise(resolve=>resolveTitle=resolve);const pending=new Set();let packet=0,resetNext=false;
  if(worker){worker.onmessage=event=>{
   const message=event.data;if(message.generation!==run)return;
   if(message.type==='ready')readyResolve();
   else if(message.type==='error'){readyReject(Error(message.message));if(capture){capture.detectorReady=false;worker.terminate();resolveTitle(null);}$('detectionStatus').textContent='Detection unavailable: '+message.message;log('detection-error',{id:capture?.record.id,message:message.message});}
   else if(message.type==='ack')pending.delete(message.id);
   else if(message.type==='gap'){log('analysis-gap',{id:capture?.record.id,reason:message.reason});$('detectionStatus').textContent='Analysis skipped delayed audio; recording continues.';}
   else if(message.type==='review-event'&&capture){
    const entry={...message.event,id:capture.record.id};events.push(entry);(capture.record.reviews??=[]).push(entry);persistReview(entry);renderEvents();
   }
   else if(message.type==='review-clip'&&capture){
    const entry=capture.record.reviews?.find(item=>item.eventId===message.entry.eventId);
    if(entry){const {review,notes}=entry;Object.assign(entry,message.entry,{review,notes,id:capture.record.id,audio:new Blob([reviewWav(message.samples,16000)],{type:'audio/wav'})});persistReview(entry);renderEvents();}
   }
   else if(message.type==='verify-audio'&&capture){verifyReview(capture,message);}
   else if(message.type==='title-audio'){resolveTitle(message.samples);worker.terminate();}
   else if(message.type==='measurement'){
    log('measurement',{...message,id:capture?.record.id});
    $('levels').textContent=`Wake score ${Number(message.prob||0).toFixed(3)} · Speech score ${Number(message.speech||0).toFixed(3)} · Input ${message.inputDb?.toFixed(1)??'−∞'} dBFS`;
    if(message.candidate){
     if(message.accepted&&$('wakeAction').value==='toggle'&&current===capture&&!capture.stopping)togglePause();}
   }
  };
  worker.onerror=event=>{readyReject(Error(event.message||'Detection worker failed'));if(capture){capture.detectorReady=false;worker.terminate();resolveTitle(null);}$('detectionStatus').textContent='Detection worker failed; audio recording remains available.';};}
  preparingCleanup=()=>{readyReject(Error('Preparation cancelled'));worker?.terminate();void closeLabAudioContext(context,error=>log('context-cleanup-error',{message:error.message}));stream?.getTracks().forEach(track=>track.stop());};
  if(worker)worker.postMessage({type:'prepare',options:config,generation:run});else{readyResolve();resolveTitle(null);}
  let detectorReady=config.liveAnalysis;
  let verificationAvailable=false;
  const verificationPreparation=config.verifyWake?(async()=>{let timer;try{await Promise.race([prepareWhisper(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Whisper preparation timed out')),45000);})]);verificationAvailable=true;}catch(error){log('verification-unavailable',{message:error.message});}finally{clearTimeout(timer);}})():Promise.resolve();
  const preparation=Promise.all([verificationPreparation,Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Model preparation timed out')),45000))])])
   .then(()=>{if(run===generation)$('detectionStatus').textContent=config.liveAnalysis?'Speech detector ready · '+(config.engine==='off'?'wake detector off':config.engine+' ready'):'Recorder only: live analysis is off.';})
   .catch(error=>{detectorReady=false;worker?.terminate();resolveTitle(null);if(run===generation)$('detectionStatus').textContent='Recording without detection: '+error.message;});
  stream=await acquireLabMicrophoneAfterPreparation(preparation,()=>{
   status('Opening microphone…');return navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},autoGainControl:{ideal:$('agc').checked},noiseSuppression:{ideal:$('noise').checked},echoCancellation:{ideal:$('echo').checked}}});
  },()=>run===generation);
  if(!stream){worker?.terminate();return;}temporaryStream=stream;
  if(!stream.active||!stream.getAudioTracks().some(track=>track.readyState==='live'))throw Error('The microphone ended before recording could start.');
  const choice=createLabRecorderChoice(stream,MediaRecorder,attempt=>log('recorder-construction-failed',attempt),config.formatPreference);
  const recorder=choice.recorder;
  const record={build:LAB_BUILD,id:crypto.randomUUID(),prefix:datePrefix(),startedAt:new Date().toISOString(),suffix:'',mime:recorder.mimeType||choice.requestedMime,state:'starting',saved:false,settings:config,microphone:stream.getAudioTracks()[0].getSettings(),reviews:[],namingStatus:config.autoName?'Opening speech will be used after Stop.':'Wake session: automatic naming is off.'};
  capture=createLabCapture({recorder,record,store,fallbacks:choice.fallbacks,onStartFailure:attempt=>log('recorder-start-attempt-failed',attempt),onUpdate:c=>{renderRecord(c.record);if(c.record.state==='interrupted'&&current===c){current=null;preparing=false;controls();status(interruptedMessage(c.record));}},
   onStopped:c=>stopAnalysis(c),onFinalized:c=>{pendingCaptures.delete(c.record.id);if(c.record.reviews?.length)persistReview(c.record.reviews[0]);if(current===c){current=null;preparing=false;status(c.record.state==='failed'?'Could not start recording: '+(c.record.captureError||'No audio was acquired.'):'Stopped. Recording retained.');}controls();void suggestName(c);}});
  Object.assign(capture,{stream,context,worker,titleAudio,resolveTitle,detectorReady,verificationAvailable});
  records.set(record.id,record);pendingCaptures.add(record.id);current=capture;

  const began=await capture.start();preparingCleanup=null;if(!began)return;preparing=false;temporaryStream=null;controls();status(config.autoName?'Recording. Say the subject in the first one or two sentences.':'Recording wake test. Triggers and near triggers collect review clips; mark missed wakes or negative samples as needed.');log('recording-started',{id:record.id,settings:config,microphone:record.microphone});
  capture.analysisStage='native-recording';
  stream.getAudioTracks()[0].addEventListener('ended',()=>{if(current===capture&&!capture.stopping){record.captureError='Microphone ended';record.interruptionStage=capture.analysisStage;status('Microphone ended; finishing available audio…');controls();log('microphone-ended',{id:record.id,stage:capture.analysisStage,contextState:capture.context?.state,elapsedMs:Date.now()-Date.parse(record.startedAt)});capture.stop();}});
  $('microphone').textContent=stream.getAudioTracks()[0].label+' · Browser reports '+JSON.stringify(record.microphone);
  if(capture.detectorReady)try{
   capture.analysisStage='creating-context';log('analysis-stage',{id:record.id,stage:capture.analysisStage});
   const inputRate=stream.getAudioTracks()[0].getSettings().sampleRate;
   context=new AudioContext(Number.isFinite(inputRate)?{sampleRate:inputRate}:undefined);capture.context=context;
   capture.analysisStage='resuming-context';
   await Promise.race([context.resume(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Audio analysis could not resume')),3000))]);
   if(current!==capture||capture.stopping){await closeLabAudioContext(context);return;}
   worker.postMessage({type:'configure-rate',generation:run,sampleRate:context.sampleRate});
   capture.analysisStage='loading-worklet';log('analysis-stage',{id:record.id,stage:capture.analysisStage,sampleRate:context.sampleRate,inputRate});
   if(!context.audioWorklet)throw Error('AudioWorklet is unavailable in this browser');
   await context.audioWorklet.addModule(new URL('./input-worklet.js',import.meta.url));
   if(current!==capture||capture.stopping){await closeLabAudioContext(context);return;}
   capture.analysisStage='connecting-worklet';
   capture.source=context.createMediaStreamSource(stream);capture.processor=new AudioWorkletNode(context,'imuse-lab-input',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});capture.silent=context.createGain();capture.silent.gain.value=0;
   capture.processor.port.onmessage=event=>{if(current!==capture||capture.stopping||!capture.detectorReady)return;
    if(pending.size>=8){resetNext=true;log('analysis-gap',{id:record.id,reason:'Analysis queue limit reached'});return;}
    const pcm=event.data,id=++packet;pending.add(id);
    worker.postMessage({type:'audio',pcm,id,generation:run,sentAt:Date.now(),sampleRate:context.sampleRate,recording:capture.recorder.state==='recording',reset:resetNext},[pcm.buffer]);resetNext=false;
   };
   capture.source.connect(capture.processor);capture.processor.connect(capture.silent);capture.silent.connect(context.destination);capture.analysisStage='running';log('analysis-stage',{id:record.id,stage:capture.analysisStage});
  }catch(error){capture.detectorReady=false;worker.terminate();resolveTitle(null);await closeLabAudioContext(context,cleanup=>log('context-cleanup-error',{message:cleanup.message}));if(current===capture){$('detectionStatus').textContent='Audio recording continues without analysis: '+error.message;log('analysis-start-failed',{id:record.id,message:error.message});}}
 }catch(error){
  log('recording-start-failed',{name:error.name,message:error.message,streamActive:stream?.active,tracks:stream?.getAudioTracks().map(track=>({state:track.readyState,muted:track.muted,enabled:track.enabled,settings:track.getSettings()})),formatAttempts:capture?.record.formatAttempts});
  if(capture){capture.record.captureError=String(error);capture.stop();}
  else{worker?.terminate();await closeLabAudioContext(context,cleanup=>log('context-cleanup-error',{message:cleanup.message}));stream?.getTracks().forEach(track=>track.stop());}
  if(run!==generation)return;preparingCleanup=null;preparing=false;temporaryStream=null;if(current===capture)current=null;controls();status('Could not start recording: '+error.message);
 }
}
$('record').onclick=start;$('pause').onclick=togglePause;$('stop').onclick=()=>{if(preparing&&!current){generation++;preparingCleanup?.();preparingCleanup=null;preparing=false;temporaryStream?.getTracks().forEach(track=>track.stop());temporaryStream=null;controls();status('Preparation cancelled.');return;}if(current){current.stop();controls();status('Finishing recording…');}};
function selectLabMode() {
 const naming=$('labMode').value==='filename';
 $('liveAnalysis').checked=true;$('autoName').checked=naming;$('engine').value=naming?'off':'heed';$('wakeThreshold').value=.7;
 $('wakePanel').hidden=naming;$('wakeEvents').hidden=naming;$('filenameOptions').hidden=!naming;
 $('sessionTitle').textContent=naming?'Filename lab':'Speech-gate comparison lab';
 renderEvents();
 status(naming?'Filename session: record opening speech, then Stop for a keyword suggestion.':'Wake session: speech-gated detection; automatic filename suggestions are off.');
}
$('labMode').onchange=selectLabMode;selectLabMode();
$('engine').onchange=()=>{$('wakeThreshold').value=$('engine').value==='voicute'?.9:.7;};
$('clearRecordings').onclick=async()=>{
 if(current||preparing||maintenance||pendingCaptures.size)return;
 if(!confirm('Permanently delete all recordings and their saved chunks from this lab? iMuse recordings and the old comparison lab are unaffected.'))return;
 maintenance=true;const ids=[...records.keys()];ids.forEach(id=>deleting.add(id));controls();
 try{await reviewWrites;await store.clear();events=[];displayStart=0;$('player').pause();$('player').removeAttribute('src');$('player').load();$('player').hidden=true;$('playing').textContent='';if(playerUrl)URL.revokeObjectURL(playerUrl);playerUrl=null;records.clear();rows.clear();$('recordings').replaceChildren();status('Lab recordings cleared.');}
 catch(error){ids.forEach(id=>deleting.delete(id));status('Could not clear recordings; loaded audio was kept: '+error.message);}finally{maintenance=false;controls();}
};
function markReview(kind) {
 if(!current?.detectorReady||current.stopping||$('engine').value==='off')return;
 current.worker.postMessage({type:'mark-review',kind,generation});
}
$('missedWake').onclick=()=>markReview('missed-wake');$('markNegative').onclick=()=>markReview('manual-negative');
$('exportReview').onclick=async()=>{
 if(current||preparing){status('Stop before exporting review audio.');return;}
 try{
  const clips=[];
  for(const event of events.filter(event=>reviewTypes.has(event.type))){
   let audioBase64=null;if(event.audio){const bytes=new Uint8Array(await event.audio.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));audioBase64=btoa(binary);}
   clips.push({...reviewMetadata(event),audioBase64,audioMime:event.audio?.type||null});
  }
  download('RecorderLab-review-'+Date.now()+'.json',new Blob([JSON.stringify({version:1,build:LAB_BUILD,clips,events:events.map(reviewMetadata),recordings:[...records.values()].map(({audio,reviews,...record})=>record)},null,2)],{type:'application/json'}));
 }catch(error){status('Review export failed: '+error.message);}
};
$('clearLog').onclick=()=>{displayStart=events.length;renderEvents();};
$('exportLog').onclick=()=>download('RecorderLab-diagnostics-'+Date.now()+'.json',new Blob([JSON.stringify({version:1,build:LAB_BUILD,exportedAt:new Date().toISOString(),events:events.map(reviewMetadata),recordings:[...records.values()].map(({audio,reviews,...record})=>record)},null,2)],{type:'application/json'}));
setInterval(()=>{if(!current)return;const seconds=Math.floor((Date.now()-Date.parse(current.record.startedAt))/1000);$('elapsed').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;},500);
globalThis.recorderLab={records,get events(){return events;},settings,prepareWhisper,start,get current(){return current;}};
