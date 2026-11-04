// Temporary level-only capture. Never creates a recorder, model or stored audio.
export function createMicrophoneLevelCheck({acquire,release,createContext,isRecordingBusy,publishProcessing=()=>{},onChange=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,durationMs=10000}) {
    let generation=0,resources=null,closing=null,timer=null;
    let state={phase:'idle',message:'Check input levels without making a recording.'};
    function notify(phase,message){state={phase,message};onChange(state);}
    function stop(message='Microphone check ended.') {
        ++generation;clearTimer(timer);timer=null;
        if(closing)return closing;
        const owned=resources;resources=null;
        if(!owned){notify('idle',message);return Promise.resolve();}
        notify('closing','Releasing microphone…');
        try{publishProcessing(owned.stream,false);}catch(_){}
        try{owned.source?.disconnect();}catch(_){}
        try{release(owned.stream);}catch(_){}
        closing=Promise.resolve().then(()=>owned.audioContext?.state!=='closed'?owned.audioContext?.close():undefined).catch(()=>{}).then(()=>{
            closing=null;notify('idle',message);
        });
        return closing;
    }
    return {
        get source(){return state.phase==='checking'?resources:null;},
        get state(){return state;},
        stop,
        async start(){
            if(isRecordingBusy()||state.phase!=='idle'||closing)return;
            const run=++generation;notify('opening','Requesting microphone for a level check…');
            try {
                const stream=await acquire(()=>run===generation&&!isRecordingBusy());
                if(run!==generation||isRecordingBusy()){release(stream);return;}
                const track=stream.getAudioTracks()[0];
                resources={stream,checking:true};
                // Bound microphone use even if resuming Web Audio never completes.
                timer=setTimer(()=>{void stop('Microphone check finished.');},durationMs);
                track?.addEventListener('ended',()=>{if(run===generation)void stop('Microphone disconnected.');});
                const context=createContext();resources.audioContext=context;
                await context.resume();
                if(run!==generation)return;
                if(isRecordingBusy()){await stop();return;}
                const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();
                analyser.fftSize=2048;source.connect(analyser);
                Object.assign(resources,{audioSource:source,source,analyser});
                publishProcessing(stream,true);
                notify('checking','Checking microphone levels for 10 seconds…');
            }catch(error){
                if(run!==generation)return;
                await stop('Microphone check unavailable: '+(error.message||error));
            }
        }
    };
}
