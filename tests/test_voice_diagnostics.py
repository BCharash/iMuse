"""Bounded diagnostic memory and Advanced UI; no microphone or model calls."""
from pathlib import Path
import unittest
from recording_test_support import SOURCE as RECORDER, between, evaluate

ROOT=Path(__file__).resolve().parents[1]
BUILD=(ROOT/'js/build-info.js').read_text().replace('export ', '')
DIAGNOSTICS=(ROOT/'js/voice-diagnostics.js').read_text()
SOURCE=BUILD+'\n'+'\n'.join(line for line in DIAGNOSTICS.splitlines() if not line.startswith('import ')).replace('export ', '')

class VoiceDiagnosticsTests(unittest.TestCase):
    def test_build_identity_display_and_recording_export(self):
        self.assertIn('displayBuildInfo(document.getElementById("appBuild"));', RECORDER)
        html=(ROOT/'index.html').read_text()
        self.assertLess(html.index('</nav>'), html.index('id="appBuild"'))
        self.assertLess(html.index('id="appBuild"'), html.index('id="settingsPanel"'))
        evaluate(BUILD+r"""
globalThis.testResult='pending';
const assert=(v,m)=>{if(!v)throw Error(m);};
const label={};displayBuildInfo(label);displayBuildInfo(null);
assert(/^\d{4}-\d{2}-\d{2}\.[1-9]\d*$/.test(APP_BUILD)&&label.textContent==='iMuse build '+APP_BUILD,'production format and runtime label');
let report,copied;const item={id:'old-session'},events=[{type:'stopped'}];
const getRecordingEvents=async()=>events,getSession=async()=>item;
class Blob{constructor(parts){report=JSON.parse(parts.join(''));}}
const URL={createObjectURL:()=> 'blob:test',revokeObjectURL(){}};
class Element {
 constructor(){this.children=[];this.events={};}
 setAttribute(){} addEventListener(name,fn){this.events[name]=fn;}
 append(...nodes){this.children.push(...nodes);} appendChild(node){this.children.push(node);}
 click(){return this.events.click?.();} remove(){} showModal(){this.open=true;} close(){this.open=false;this.events.close?.();}
}
const document={body:new Element(),createElement:()=>new Element()};
const navigator={clipboard:{writeText:async text=>copied=text}};
let stopDiagnosticsDialog=null;
const setTimeout=()=>{};
"""+between('async function downloadRecordingEvents(', 'function getAllSessions()')+r"""
(async()=>{
 await downloadRecordingEvents('old-session');
 assert(!report&&stopDiagnosticsDialog.open,'opening diagnostics does not initiate download');
 const dialog=stopDiagnosticsDialog,actions=dialog.children[1].children,detail=dialog.children[3];
 assert(detail.hidden,'detail initially hidden');actions[0].click();assert(!detail.hidden&&actions[0].textContent==='Hide','View reveals diagnostics');
 await actions[1].click();assert(copied===detail.textContent,'Copy matches displayed report');
 actions[2].click();
 assert(report.appBuild===APP_BUILD&&report.sessionId==='old-session'&&report.session.id===item.id&&report.events[0].type==='stopped','export adds current app build without changing saved session/events');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack||''));
""")

    def test_default_collection_bounds_copy_and_safe_failure(self):
        evaluate(SOURCE + r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const log=createVoiceDiagnostics({limit:3,enabledByDefault:false,now:()=>123,timestamp:()=>'test-time'});
log.record('command-prediction',{score:.9});assert(log.size===0&&!log.enabled,'off by default');
log.setEnabled(true);const scores={stop:.72};
log.record('command-prediction',{scores,audio:new Float32Array(20),samples:[1,2,3],stream:{track:'private'},transcript:'private',values:new Float32Array(10)});scores.stop=0;
log.record('another');log.record('last');const snapshot=log.snapshot({browser:'test'});
assert(snapshot.appBuild===APP_BUILD&&snapshot.diagnosticVersion===VOICE_DIAGNOSTICS_VERSION&&snapshot.schemaVersion===1,'app build accompanies distinct diagnostic format/version');
assert(snapshot.events.length===3&&snapshot.droppedEvents===1&&snapshot.events[0].type==='command-prediction','fixed-capacity ring drops oldest events and reports truncation');
assert(snapshot.events[0].scores.stop===.72&&!('audio' in snapshot.events[0])&&!('samples' in snapshot.events[0])&&!('stream' in snapshot.events[0])&&!('transcript' in snapshot.events[0])&&!('values' in snapshot.events[0]),'numeric snapshots are copied without raw audio or mutable media references');
snapshot.events[0].scores.stop=.1;assert(log.snapshot().events[0].scores.stop===.72,'export cannot mutate retained evidence');
log.onChange(()=>{throw Error('broken UI');});log.record('command-accepted',{command:'stop',windowId:7,sessionId:'session',generation:2,score:.72,threshold:.7});
assert(log.snapshot().events.at(-1).command==='stop','failing UI observer cannot interrupt collection');
log.clear();assert(log.size===0&&log.dropped===0&&log.enabled,'clear removes diagnostic memory without disabling collection');
log.record('fresh');log.setEnabled(false);const size=log.size;log.record('ignored');assert(log.size===size&&!log.enabled,'disable retains exportable evidence without new logging');
const fresh=createVoiceDiagnostics({now:()=>0});assert(fresh.enabled&&fresh.size===0&&fresh.snapshot().capacity===500,'fresh page collects by default with a 500-event cap');
for(let i=0;i<600;i++)fresh.record('command-prediction',{index:i});assert(fresh.size===500&&fresh.dropped===100&&fresh.snapshot().events[0].index===100,'default collector retains only the latest 500 events');
globalThis.testResult='PASS';
""")

    def test_readable_window_summary_and_partial_data(self):
        evaluate(SOURCE + r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const base={sessionId:'one',windowId:1,phase:'go-stop',at:'2026-11-04T10:00:00Z'};
const events=[{...base,type:'command-window-created'},{...base,type:'listener-ready'},
 {...base,type:'command-prediction',scores:{stop:.72}},{...base,type:'command-accepted',command:'stop',score:.72,threshold:.7,elapsedMs:4200},
 {...base,type:'command-window-close'},
 {...base,windowId:2,phase:'yes-no',type:'command-window-created'},
 {...base,windowId:2,phase:'yes-no',type:'command-accepted',command:'no',score:.9,threshold:.55},
 {...base,windowId:3,type:'command-window-timeout'},{...base,windowId:3,type:'command-window-close'},
 {...base,sessionId:'two',type:'command-prediction',scores:{stop:.2}}];
events.push({...base,sessionId:undefined,windowId:4,type:'command-accepted',command:'go',score:.9});
const report=summarizeVoiceDiagnostics({events});
assert(report.goStopWindows===4&&report.stops===1,'summary counts retained windows and model Stop decisions, not user intent');
assert(report.windows[0].result==='Accepted Stop'&&report.windows[0].score===.72&&report.windows[0].threshold===.7&&report.windows[0].elapsedMs===4200&&report.windows[0].peakStop===.72,'readable row preserves accepted score, threshold, timing and peak');
assert(report.windows[1].result==='Accepted No'&&report.windows[2].result==='Timed out — no command','confirmation and timeout remain distinct after shutdown');
assert(report.windows[4].command==='go'&&report.gos===1,'missing session metadata does not silently hide a logged command');
assert(report.windows[3].result==='Partial window'&&report.windows[3].sessionId==='two','truncated data and repeated window IDs across sessions do not merge');
globalThis.testResult='PASS';
""")

    def test_readable_exports_match_the_two_views(self):
        evaluate(SOURCE + r"""
const assert=(v,m)=>{if(!v)throw Error(m);};
const snapshot={events:[
 {type:'command-accepted',windowId:1,sessionId:'a',phase:'go-stop',command:'stop',score:.9,threshold:.8,at:'2026-11-11T12:00:00Z',elapsedMs:100},
 {type:'speech-gate',message:'paused: speech rejected',at:'2026-11-11T12:00:01Z'}]};
const results=voiceRecognitionReport(snapshot),details=voiceDiagnosticReport(snapshot);
assert(results.startsWith('Voice recognition results')&&results.includes('Accepted Stop')&&results.includes('0.90 / 0.80'),'results export contains formatted summary');
assert(!results.includes('speech rejected')&&details.includes('speech rejected')&&details.includes('Command accepted'),'details export contains events absent from summary');
assert(recognitionRows(snapshot)[0].every(value=>results.includes(String(value))),'displayed summary cells are all exported');
assert(activityRows(snapshot).every(row=>row.every(value=>details.includes(String(value)))),'displayed event cells are all exported');
globalThis.testResult='PASS';
""")

    def test_advanced_readable_view_refresh_clear_and_disable(self):
        evaluate(r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const performance={now:()=>0};class Element{constructor(){this.handlers={};this.children=[];}addEventListener(type,fn){this.handlers[type]=fn;}appendChild(item){this.children=this.children.filter(child=>child!==item);this.children.push(item);}setAttribute(){}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}}
const elements=new Map(),document={createElement:()=>new Element(),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
""" + SOURCE + r"""
const el=id=>document.getElementById(id);el('advancedSettings').open=true;
initializeVoiceDiagnostics();const toggle=el('voiceDiagnosticsEnabled');
assert(toggle.checked&&!el('downloadVoiceDiagnostics').disabled,'default collection and startup event are visible without a second View button');
assert(el('audioSettingsSection').children.at(-1)===el('advancedSettings'),'voice Advanced remains at the bottom of the voice category');
assert(el('voiceDiagnosticsSummary').textContent.includes('No voice recognition results yet')&&el('voiceDiagnosticsEvents').children.length===1,'startup entry proves collector/viewer are connected');
const metadata={windowId:4,sessionId:'session',phase:'go-stop'};
voiceDiagnostics.record('command-accepted',{...metadata,command:'stop',score:.8,threshold:.7,elapsedMs:4200});
assert(el('voiceDiagnosticsWindows').children[0].children[3].textContent==='Accepted Stop','live state boundary updates readable window result');
assert(el('voiceDiagnosticsWindows').children[0].children[4].textContent==='0.80 / 0.70'&&el('voiceDiagnosticsWindows').children[0].children[5].textContent==='4.20 s','human scores and timing are formatted');
voiceDiagnostics.record('command-prediction',{...metadata,scores:{top:'stop',topScore:.8,stop:.8},thresholds:{stop:.7},elapsedMs:4300});
assert(el('voiceDiagnosticsEvents').children[0].children[2].textContent==='Command accepted','prediction does not force repeated DOM rendering');
el('refreshVoiceDiagnostics').handlers.click();assert(el('voiceDiagnosticsEvents').children[0].children[2].textContent==='Prediction','manual refresh shows latest prediction scores');
el('clearVoiceDiagnostics').handlers.click();assert(voiceDiagnostics.size===0&&el('voiceDiagnosticsWindows').children.length===0&&el('downloadVoiceDiagnostics').disabled,'clear resets visible tables and log');
toggle.checked=false;toggle.handlers.change();assert(!voiceDiagnostics.enabled,'disable keeps viewer usable');
toggle.checked=true;toggle.handlers.change();el('settingsPanel').hidden=true;voiceDiagnostics.record('command-accepted',{...metadata,command:'go',score:.9});el('settingsPanel').hidden=false;el('settingsButton').handlers.click();assert(el('voiceDiagnosticsWindows').children[0].children[3].textContent==='Accepted Go','opening Settings refreshes commands received while it was hidden');
globalThis.testResult='PASS';
""")

if __name__=='__main__':
    unittest.main()
