// Loaded only on Combine. The worker has no microphone or database access.
export function runRecordingCombine(recordings, {onProgress=()=>{},signal}={}) {
    return new Promise((resolve,reject)=>{
        if(signal?.aborted){reject(new Error('Combine cancelled.'));return;}
        const worker=new Worker(new URL('./recording-combine-worker.js',import.meta.url),{type:'module'});
        let settled=false;
        const finish=(error,result)=>{if(settled)return;settled=true;worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
        const abort=()=>finish(new Error('Combine cancelled.'));
        signal?.addEventListener('abort',abort,{once:true});
        worker.onmessage=({data})=>{try{if(data.progress)onProgress(data.progress);else if(data.error)finish(new Error(data.error));else if(data.result)finish(null,data.result);}catch(error){finish(error);}};
        worker.onerror=event=>finish(new Error(event.message||'Could not prepare M4A combining.'));
        worker.onmessageerror=()=>finish(new Error('Could not read combined audio from the worker.'));
        try { worker.postMessage({recordings}); } catch(error) { finish(error); }
    });
}
