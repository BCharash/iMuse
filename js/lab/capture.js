// MediaRecorder journaling for the lab. Each capture retains its own parts and pending writes.
export function createLabCapture({recorder,record,store,fallbacks=[],onStartFailure=()=>{},onUpdate=()=>{},onStopped=()=>{},onFinalized=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}) {
 const capture={record,recorder,parts:[],pending:Promise.resolve(),sequence:0,timer:null,fullFinished:false,stopping:false,started:false};
 function detach(candidate){candidate.ondataavailable=null;candidate.onstop=null;candidate.onerror=null;}
 function attach(candidate) {
  candidate.ondataavailable=event=>{if(!event.data?.size)return;capture.parts.push(event.data);record.bytes=(record.bytes||0)+event.data.size;onUpdate(capture);const sequence=capture.sequence++;
   capture.pending=capture.pending.then(()=>store.append(record.id,sequence,event.data)).catch(error=>{record.storageError=String(error);onUpdate(capture);});};
  candidate.onstop=()=>{capture.stopping=true;onStopped(capture);void finish(false);};
  candidate.onerror=event=>{record.captureError=String(event.error||'Recorder error');capture.stop();};
 }
 async function finish(partial=false) {
  if(capture.fullFinished)return;if(!partial){capture.fullFinished=true;clearTimer(capture.timer);}
  await capture.pending;if(partial&&capture.fullFinished)return;
  record.audio=new Blob(capture.parts,{type:recorder.mimeType||record.mime});record.mime=record.audio.type;
  record.state=partial?'interrupted':capture.started?(record.captureError?'interrupted':'stopped'):record.audio.size?'interrupted':'failed';record.endedAt=new Date().toISOString();record.bytes=record.audio.size;
  if(record.state==='failed')record.namingStatus='No audio was acquired.';
  try{await store.finalize({...record,saved:true,storageError:null});record.saved=true;record.storageError=null;}catch(error){record.saved=false;record.storageError=String(error);}
  onUpdate(capture);if(!partial)onFinalized(capture);return record;
 }
 attach(recorder);
 capture.start=async()=>{
  try{await store.put({...record});record.saved=true;}catch(error){record.saved=false;record.storageError=String(error);}
  if(capture.stopping)return false;
  const initial=recorder,attempts=[{mime:record.mime||'',create:()=>initial},...fallbacks];record.formatAttempts=[];
  for(const attempt of attempts) {
   let candidate;
   try {
    candidate=attempt.create();recorder=candidate;capture.recorder=candidate;attach(candidate);
    candidate.start(250);capture.started=true;record.mime=candidate.mimeType||attempt.mime||'';record.state='recording';
    record.formatAttempts.push({mime:attempt.mime||'browser default',actualMime:record.mime,started:true});onUpdate(capture);return true;
   }catch(error){
    const failure={mime:attempt.mime||'browser default',name:error.name,message:error.message,started:false};record.formatAttempts.push(failure);onStartFailure(failure);
    // Never switch encoders once any data or an active recorder needs preservation.
    if(candidate&&(candidate.state!=='inactive'||capture.parts.length))throw error;
    if(candidate)detach(candidate);
   }
  }
  throw Error('No audio format could start recording. '+record.formatAttempts.map(item=>`${item.mime}: ${item.message}`).join('; '));
 };
 capture.stop=()=>{if(capture.stopping)return;capture.stopping=true;capture.timer=setTimer(()=>{void finish(true);onStopped(capture);},5000);
  try{if(recorder.state!=='inactive')recorder.stop();else if(!capture.started)void finish(false);}catch(error){record.captureError=String(error);void finish(true);}
  onStopped(capture);};
 return capture;
}
