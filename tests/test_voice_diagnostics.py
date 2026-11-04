"""Bounded opt-in diagnostic memory and Advanced UI; no microphone or model calls."""
from pathlib import Path
import unittest
from recording_test_support import evaluate

SOURCE=(Path(__file__).resolve().parents[1]/'js/voice-diagnostics.js').read_text().replace('export ', '')

class VoiceDiagnosticsTests(unittest.TestCase):
    def test_opt_in_bounds_copy_and_safe_failure(self):
        evaluate(SOURCE + r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const log=createVoiceDiagnostics({limit:3,now:()=>123,timestamp:()=>'test-time'});
log.record('command-prediction',{score:.9});assert(log.size===0&&!log.enabled,'off by default');
log.setEnabled(true);const scores={stop:.72};
log.record('command-prediction',{scores,audio:new Float32Array(20),samples:[1,2,3],stream:{track:'private'},transcript:'private',values:new Float32Array(10)});scores.stop=0;
log.record('another');log.record('last');const snapshot=log.snapshot({browser:'test'});
assert(snapshot.events.length===3&&snapshot.droppedEvents===1&&snapshot.events[0].type==='command-prediction','fixed-capacity ring drops oldest events and reports truncation');
assert(snapshot.events[0].scores.stop===.72&&!('audio' in snapshot.events[0])&&!('samples' in snapshot.events[0])&&!('stream' in snapshot.events[0])&&!('transcript' in snapshot.events[0])&&!('values' in snapshot.events[0]),'numeric snapshots are copied without raw audio or mutable media references');
snapshot.events[0].scores.stop=.1;assert(log.snapshot().events[0].scores.stop===.72,'export cannot mutate retained evidence');
log.onChange(()=>{throw Error('broken UI');});log.record('command-accepted',{command:'stop',windowId:7,sessionId:'session',generation:2,score:.72,threshold:.7});
assert(log.canMark,'failing UI observer cannot interrupt collection');log.markUnintended();
const mark=log.snapshot().events.at(-1);assert(mark.type==='unintended-confirmation'&&mark.windowId===7&&mark.acceptedSequence<mark.sequence&&!log.canMark,'marker links to accepted Stop');
log.clear();assert(log.size===0&&log.dropped===0&&!log.canMark&&log.enabled,'clear removes all diagnostic memory without disabling collection');
log.record('fresh');log.setEnabled(false);const size=log.size;log.record('ignored');assert(log.size===size&&!log.enabled,'disable retains exportable evidence without new logging');
const fresh=createVoiceDiagnostics();assert(!fresh.enabled&&fresh.size===0,'fresh page has no saved setting or log');
globalThis.testResult='PASS';
""")

    def test_advanced_controls_and_marker_do_not_control_audio(self):
        evaluate(r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const performance={now:()=>0};class Element{constructor(){this.handlers={};}addEventListener(type,fn){this.handlers[type]=fn;}}
const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
""" + SOURCE + r"""
initializeVoiceDiagnostics();const el=id=>elements.get(id),toggle=el('voiceDiagnosticsEnabled'),marker=el('markUnintendedConfirmation');
assert(!toggle.checked&&marker.hidden&&el('downloadVoiceDiagnostics').disabled,'initial UI has no enabled diagnostics or marker');
toggle.checked=true;toggle.handlers.change();assert(voiceDiagnostics.enabled&&marker.hidden,'enable observes without inventing an incident');
voiceDiagnostics.record('command-accepted',{command:'stop',windowId:4,score:.8,threshold:.7});assert(!marker.hidden,'Stop exposes marker even while confirmation prompt hides listening indicator');
marker.handlers.click();assert(marker.hidden&&voiceDiagnostics.snapshot().events.at(-1).type==='unintended-confirmation','mark hides marker and records incident only');
el('clearVoiceDiagnostics').handlers.click();assert(voiceDiagnostics.size===0&&el('downloadVoiceDiagnostics').disabled,'clear updates buttons');
toggle.checked=false;toggle.handlers.change();assert(!voiceDiagnostics.enabled&&marker.hidden,'disable hides marker');
globalThis.testResult='PASS';
""")

if __name__=='__main__':
    unittest.main()
