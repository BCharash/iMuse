// Bounded, page-memory-only observation. No model, microphone, recording or storage ownership.
import { APP_BUILD } from './build-info.js';
export const VOICE_DIAGNOSTICS_VERSION = '2026-11-04.4';
export function createVoiceDiagnostics({limit=500, enabledByDefault=true, now=()=>performance.now(), timestamp=()=>new Date().toISOString()}={}) {
    const capacity=Math.max(1,Math.min(500,Math.floor(limit)||500));
    let enabled=Boolean(enabledByDefault),buffer=new Array(capacity),start=0,size=0,dropped=0,sequence=0,onChange=()=>{};
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
            if(type!=='command-prediction')changed();
        }catch(_){/* Observational failures must never escape into capture/commands. */}
    }
    return {
        get enabled(){return enabled;},get size(){return size;},get dropped(){return dropped;},
        setEnabled(value){
            const next=Boolean(value);if(next===enabled)return;
            if(next){enabled=true;record('diagnostics-enabled');}
            else{record('diagnostics-disabled');enabled=false;}
            changed();
        },
        record,
        clear(){buffer=new Array(capacity);start=0;size=0;dropped=0;sequence=0;changed();},
        snapshot(environment={}){
            const events=Array.from({length:size},(_,i)=>copy(buffer[(start+i)%capacity]));
            return {schemaVersion:1,appBuild:APP_BUILD,diagnosticVersion:VOICE_DIAGNOSTICS_VERSION,exportedAt:timestamp(),enabled,capacity,droppedEvents:dropped,environment:copy(environment),events};
        },
        onChange(callback){onChange=callback;changed();}
    };
}
export const voiceDiagnostics=createVoiceDiagnostics();

// Summaries describe classifier decisions, not whether someone actually spoke.
export function summarizeVoiceDiagnostics(snapshot) {
    const windows=new Map();
    for(const event of snapshot.events) {
        if(event.windowId===undefined)continue;
        const key=(event.sessionId||'unreported-session')+':'+event.windowId;
        let window=windows.get(key);
        if(!window){window={id:event.windowId,sessionId:event.sessionId,at:event.at,phase:event.phase,result:'Partial window',peakStop:null};windows.set(key,window);}
        if(event.type==='command-window-created')window.result='Preparing';
        if(event.type==='listener-ready'&&!event.cancelled)window.result='Listening';
        if(event.type==='command-window-close'&&!window.command&&window.result!=='Timed out — no command')window.result='Closed';
        if(event.type==='command-window-timeout'&&!window.command)window.result='Timed out — no command';
        if(event.type==='command-window-error'||event.type==='listener-shutdown-error')window.error=event.message||'Listener error';
        if(event.type==='command-prediction'&&Number.isFinite(event.scores?.stop))window.peakStop=Math.max(window.peakStop??0,event.scores.stop);
        if(event.type==='command-accepted')Object.assign(window,{command:event.command,result:'Accepted '+event.command[0].toUpperCase()+event.command.slice(1),score:event.score,threshold:event.threshold,elapsedMs:event.elapsedMs});
    }
    const rows=[...windows.values()];
    return {windows:rows,goStopWindows:rows.filter(row=>row.phase==='go-stop').length,stops:rows.filter(row=>row.command==='stop').length,gos:rows.filter(row=>row.command==='go').length};
}
const eventNames={
    'diagnostics-ready':'Diagnostics ready','diagnostics-enabled':'Diagnostics enabled','diagnostics-disabled':'Diagnostics disabled',
    'wake-command-entry':'Wake opened commands','command-window-created':'Command window opened',
    'model-preload-request':'Preparing command model','model-preload-ready':'Command model prepared',
    'model-load-request':'Loading command model','model-load-ready':'Command model ready',
    'prompt-start':'Prompt started','prompt-end':'Prompt finished','prompt-error':'Prompt failed',
    'listener-start-request':'Listener starting','listener-ready':'Listener ready',
    'listener-shutdown-request':'Listener stopping','listener-shutdown-complete':'Listener stopped',
    'listener-shutdown-error':'Listener shutdown failed','listener-deadline':'Listening deadline set',
    'command-prediction':'Prediction','command-accepted':'Command accepted',
    'command-window-close':'Command window closed','command-window-timeout':'Listening timed out',
    'command-window-error':'Command window failed','model-preload-error':'Model preparation failed'
};
const scoreText=value=>Number.isFinite(value)?value.toFixed(2):'—';
const secondsText=value=>Number.isFinite(value)?(value/1000).toFixed(2)+' s':'—';
const phaseText=phase=>phase==='go-stop'?'Go / Stop':phase==='yes-no'?'Yes / No':'—';
function diagnosticTime(at){const date=new Date(at);return Number.isFinite(date.getTime())?date.toLocaleTimeString():String(at||'—');}
function appendDiagnosticRow(body,values) {
    const row=document.createElement('tr');
    for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}
    body.append(row);
}
function recognitionRows(snapshot) {
    return summarizeVoiceDiagnostics(snapshot).windows.slice(-30).reverse().map(window => [
        diagnosticTime(window.at), window.id, phaseText(window.phase), window.error ? 'Error: '+window.error : window.result,
        scoreText(window.score)+' / '+scoreText(window.threshold), secondsText(window.elapsedMs), scoreText(window.peakStop)
    ]);
}
function activityRows(snapshot) {
    return snapshot.events.slice(-500).reverse().map(event => {
        let detail=event.message||'';
        if(event.type==='command-prediction') {
            const words=event.phase==='yes-no'?['yes','no']:['go','stop'];
            detail=`Top match: ${event.scores?.top||'—'} (${scoreText(event.scores?.topScore)}) · `+words.map(word=>`${word} ${scoreText(event.scores?.[word])} / threshold ${scoreText(event.thresholds?.[word])}`).join(' · ');
        } else if(event.type==='command-accepted') detail=`${event.command} · score ${scoreText(event.score)} / threshold ${scoreText(event.threshold)}`;
        else if(event.prompt) detail=({confirmStop:'Confirm stop recording',pause:'Pause',yes:'Acknowledgement',newRecording:'New recording',recording:'Recording',stopped:'Stopped'})[event.prompt]||event.prompt;
        else if(event.windowSeconds) detail=event.windowSeconds+' s listening window';
        else if(event.cancelled) detail='Cancelled before startup completed';
        return [diagnosticTime(event.at),event.windowId??'—',eventNames[event.type]||event.type.replaceAll('-',' '),detail,secondsText(event.elapsedMs)];
    });
}
function readableReport(title, headings, rows) {
    return title+'\n'+[headings,...rows].map(row=>row.map(value=>String(value).replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n')+'\n';
}
export function voiceRecognitionReport(snapshot) {
    return readableReport('Voice recognition results', ['Time','Window','Listening for','Result','Accepted score / threshold','After','Highest Stop score'], recognitionRows(snapshot));
}
export function voiceDiagnosticReport(snapshot) {
    return readableReport('Detailed voice diagnostics', ['Time','Window','Event','Details','After'], activityRows(snapshot));
}
export function initializeVoiceDiagnostics() {
    const toggle=document.getElementById('voiceDiagnosticsEnabled'),download=document.getElementById('downloadVoiceDiagnostics');
    const clear=document.getElementById('clearVoiceDiagnostics'),status=document.getElementById('voiceDiagnosticsStatus');
    const advanced=document.getElementById('advancedSettings'),settings=document.getElementById('settingsPanel'),audioSection=document.getElementById('audioSettingsSection');
    const settingsButton=document.getElementById('settingsButton');
    const view=document.getElementById('voiceDiagnosticsView');
    const detailView=document.getElementById('voiceDiagnosticsDetailView');
    const summary=document.getElementById('voiceDiagnosticsSummary'),windows=document.getElementById('voiceDiagnosticsWindows');
    const events=document.getElementById('voiceDiagnosticsEvents'),refresh=document.getElementById('refreshVoiceDiagnostics');
    if(!toggle||!download||!clear||!status||!view||!summary||!windows||!events||!refresh)return;
    // Keep voice diagnostics at the bottom of the Voice commands category.
    if(audioSection&&advanced)audioSection.appendChild(advanced);
    function renderView(){
        const snapshot=voiceDiagnostics.snapshot(),report=summarizeVoiceDiagnostics(snapshot);
        summary.textContent=report.windows.length?`${report.goStopWindows} listening periods · ${report.gos} Go and ${report.stops} Stop recognitions. These are model decisions, not verified speech.${snapshot.droppedEvents?' Older data was dropped; some attempts may be incomplete.':''}`:voiceDiagnostics.enabled?'No voice recognition results yet. Say the wake phrase to open a Go/Stop listening period.':'Diagnostics are off. Enable collection to log new voice recognition results.';
        windows.replaceChildren();events.replaceChildren();
        for (const row of recognitionRows(snapshot)) appendDiagnosticRow(windows,row);
        for (const row of activityRows(snapshot)) appendDiagnosticRow(events,row);
    }
    function render(){
        toggle.checked=voiceDiagnostics.enabled;download.disabled=voiceDiagnostics.size===0;clear.disabled=voiceDiagnostics.size===0;
        status.textContent=`${voiceDiagnostics.enabled?'On':'Off'} · ${voiceDiagnostics.size} / 500 events retained${voiceDiagnostics.dropped?' · '+voiceDiagnostics.dropped+' older events dropped':''}. This page only; download before reloading. No audio is logged.`;
        if((!view.hidden||detailView&&!detailView.hidden)&&advanced?.open&&!settings?.hidden&&!audioSection?.hidden)renderView();
    }
    function wireVisibility(id, target, label) {
        const button=document.getElementById(id);
        button?.addEventListener('click',()=>{
            if(!target)return;
            target.hidden=!target.hidden;
            button.textContent=(target.hidden?'Show ':'Hide ')+label;
            button.setAttribute('aria-expanded',String(!target.hidden));
            if(!target.hidden)renderView();
        });
    }
    wireVisibility('toggleRecognitionResults',view,'results');
    wireVisibility('toggleVoiceDiagnostics',detailView,'diagnostics');
    function wireCopy(id, report, label) {
        document.getElementById(id)?.addEventListener('click',async()=>{
            try {await navigator.clipboard.writeText(report(voiceDiagnostics.snapshot()));status.textContent=label+' copied.';}
            catch(_){status.textContent='Clipboard access unavailable. Use Download '+label.toLowerCase()+' instead.';}
        });
    }
    wireCopy('copyRecognitionResults',voiceRecognitionReport,'Results');
    wireCopy('copyVoiceDiagnostics',voiceDiagnosticReport,'Diagnostics');
    function saveReport(text,filename,type='text/plain') {
        const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    document.getElementById('downloadRecognitionResults')?.addEventListener('click',()=>saveReport(
        voiceRecognitionReport(voiceDiagnostics.snapshot()),`iMuse-voice-recognition-results-${Date.now()}.txt`));
    document.getElementById('downloadVoiceDiagnosticsJSON')?.addEventListener('click',()=>saveReport(
        JSON.stringify(voiceDiagnostics.snapshot({userAgent:navigator.userAgent,platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency,visibility:document.visibilityState}),null,2),
        `iMuse-voice-diagnostics-${Date.now()}.json`,'application/json'));
    voiceDiagnostics.onChange(render);
    toggle.addEventListener('change',()=>voiceDiagnostics.setEnabled(toggle.checked));
    clear.addEventListener('click',()=>voiceDiagnostics.clear());
    refresh.addEventListener('click',render);
    advanced?.addEventListener('toggle',render);
    settingsButton?.addEventListener('click',render);
    if(voiceDiagnostics.size===0)voiceDiagnostics.record('diagnostics-ready',{diagnosticVersion:VOICE_DIAGNOSTICS_VERSION});
    download.addEventListener('click',()=>saveReport(voiceDiagnosticReport(voiceDiagnostics.snapshot()),
        `iMuse-voice-diagnostics-${Date.now()}.txt`));
}
