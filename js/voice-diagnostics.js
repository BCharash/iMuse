// Opt-in, page-memory-only observation. No model, microphone, recording or storage ownership.
export const VOICE_DIAGNOSTICS_VERSION = '2026-11-04.1';
export function createVoiceDiagnostics({limit=4000, now=()=>performance.now(), timestamp=()=>new Date().toISOString()}={}) {
    const capacity=Math.max(1,Math.min(10000,Math.floor(limit)||4000));
    let enabled=false,buffer=new Array(capacity),start=0,size=0,dropped=0,sequence=0,lastStop=null,onChange=()=>{};
    const forbidden=new Set(['audio','samples','pcm','stream','spectrogram','transcript','text']);
    function copy(value,depth=0) {
        if(value===null||typeof value==='boolean')return value;
        if(typeof value==='number')return Number.isFinite(value)?value:null;
        if(typeof value==='string')return value.slice(0,300);
        if(depth>=3||!value||Object.getPrototypeOf(value)!==Object.prototype)return undefined;
        const result={};
        for(const key of Object.keys(value).slice(0,40)){
            if(forbidden.has(key.toLowerCase()))continue;
            const item=copy(value[key],depth+1);if(item!==undefined)result[key]=item;
        }
        return result;
    }
    function changed(){try{onChange();}catch(_){/* UI diagnostics cannot affect recognition. */}}
    function record(type,details={}) {
        if(!enabled)return;
        try {
            const event={...copy(details),sequence:++sequence,type:String(type).slice(0,80),at:timestamp(),atMs:now()};
            if(size===capacity){buffer[start]=event;start=(start+1)%capacity;dropped++;}
            else{buffer[(start+size)%capacity]=event;size++;}
            if(type==='command-accepted'&&event.command==='stop'){
                lastStop={acceptedSequence:event.sequence,sessionId:event.sessionId,windowId:event.windowId,generation:event.generation,acceptedAt:event.at,score:event.score,threshold:event.threshold,elapsedMs:event.elapsedMs};changed();
            }else if(type!=='command-prediction')changed();
        }catch(_){/* Observational failures must never escape into capture/commands. */}
    }
    return {
        get enabled(){return enabled;},get size(){return size;},get dropped(){return dropped;},
        get canMark(){return enabled&&!!lastStop;},
        setEnabled(value){
            const next=Boolean(value);if(next===enabled)return;
            if(next){enabled=true;record('diagnostics-enabled');}
            else{record('diagnostics-disabled');enabled=false;lastStop=null;}
            changed();
        },
        record,
        clear(){buffer=new Array(capacity);start=0;size=0;dropped=0;sequence=0;lastStop=null;changed();},
        markUnintended(){if(!enabled||!lastStop)return;const incident=lastStop;lastStop=null;record('unintended-confirmation',incident);changed();},
        snapshot(environment={}){
            const events=Array.from({length:size},(_,i)=>copy(buffer[(start+i)%capacity]));
            return {schemaVersion:1,diagnosticVersion:VOICE_DIAGNOSTICS_VERSION,exportedAt:timestamp(),enabled,capacity,droppedEvents:dropped,environment:copy(environment),events};
        },
        onChange(callback){onChange=callback;changed();}
    };
}
export const voiceDiagnostics=createVoiceDiagnostics();

export function initializeVoiceDiagnostics() {
    const toggle=document.getElementById('voiceDiagnosticsEnabled'),download=document.getElementById('downloadVoiceDiagnostics');
    const clear=document.getElementById('clearVoiceDiagnostics'),marker=document.getElementById('markUnintendedConfirmation');
    const status=document.getElementById('voiceDiagnosticsStatus'),advanced=document.getElementById('advancedSettings');
    if(!toggle||!download||!clear||!marker||!status)return;
    function render(){
        toggle.checked=voiceDiagnostics.enabled;download.disabled=voiceDiagnostics.size===0;clear.disabled=voiceDiagnostics.size===0;
        marker.hidden=!voiceDiagnostics.canMark;
        status.textContent=`${voiceDiagnostics.enabled?'On':'Off'} · ${voiceDiagnostics.size} events retained${voiceDiagnostics.dropped?' · '+voiceDiagnostics.dropped+' older events dropped':''}. This page only; download before reloading. No audio is logged.`;
    }
    voiceDiagnostics.onChange(render);
    toggle.addEventListener('change',()=>voiceDiagnostics.setEnabled(toggle.checked));
    clear.addEventListener('click',()=>voiceDiagnostics.clear());
    marker.addEventListener('click',()=>voiceDiagnostics.markUnintended());
    advanced?.addEventListener('toggle',render);
    download.addEventListener('click',()=>{
        const data=voiceDiagnostics.snapshot({userAgent:navigator.userAgent,platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency,visibility:document.visibilityState});
        const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=`iMuse-voice-diagnostics-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    });
}
