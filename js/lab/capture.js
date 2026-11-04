// MediaRecorder journaling for the lab. Each capture retains its own parts and pending writes.
export function createLabCapture({recorder,record,store,onUpdate=()=>{},onStopped=()=>{},onFinalized=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}) {
 const capture={record,recorder,parts:[],pending:Promise.resolve(),sequence:0,timer:null,fullFinished:false,stopping:false};
 recorder.ondataavailable=event=>{if(!event.data?.size)return;capture.parts.push(event.data);record.bytes=(record.bytes||0)+event.data.size;onUpdate(capture);const sequence=capture.sequence++;
  capture.pending=capture.pending.then(()=>store.append(record.id,sequence,event.data)).catch(error=>{record.storageError=String(error);onUpdate(capture);});};
 async function finish(partial=false) {
  if(capture.fullFinished)return;if(!partial){capture.fullFinished=true;clearTimer(capture.timer);}
  await capture.pending;if(partial&&capture.fullFinished)return;
  record.audio=new Blob(capture.parts,{type:recorder.mimeType||record.mime});record.mime=record.audio.type;
  record.state=partial?'interrupted':'stopped';record.endedAt=new Date().toISOString();record.bytes=record.audio.size;
  try{await store.finalize({...record,saved:true,storageError:null});record.saved=true;record.storageError=null;}catch(error){record.saved=false;record.storageError=String(error);}
  onUpdate(capture);if(!partial)onFinalized(capture);return record;
 }
 capture.start=async()=>{try{await store.put({...record});record.saved=true;}catch(error){record.saved=false;record.storageError=String(error);}if(capture.stopping)return false;recorder.start(250);record.state='recording';onUpdate(capture);return true;};
 capture.stop=()=>{if(capture.stopping)return;capture.stopping=true;capture.timer=setTimer(()=>{void finish(true);onStopped(capture);},5000);
  try{if(recorder.state!=='inactive')recorder.stop();else void finish(false);}catch(error){record.captureError=String(error);void finish(true);}
  onStopped(capture);};
 recorder.onstop=()=>{capture.stopping=true;onStopped(capture);void finish(false);};
 recorder.onerror=event=>{record.captureError=String(event.error||'Recorder error');capture.stop();};
 return capture;
}
