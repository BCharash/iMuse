"""Passive microphone-level reporting and Settings polling; no real audio input."""
import unittest
from pathlib import Path
from recording_test_support import SOURCE, between, evaluate

SETTINGS = (Path(__file__).resolve().parents[1] / 'js/settings.js').read_text()
settings_start = SETTINGS.index('// Read the existing recording analyser')
UI = SETTINGS[settings_start:SETTINGS.index('function renderMicrophoneProcessing()', settings_start)]
METER = between('function publishLiveMicrophoneLevel()', 'function openDatabase()')

MOCKS = r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
class Target {
    constructor(){this.listeners=new Map();this.hidden=true;this.textContent='';this.attributes={};}
    setAttribute(name,value){this.attributes[name]=value;}
    getAttribute(name){return this.attributes[name];}
    removeAttribute(name){delete this.attributes[name];if(name==='hidden')this.hidden=false;}
    addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
    dispatchEvent(event){for(const callback of this.listeners.get(event.type)||[])callback(event);}
}
class Event {constructor(type){this.type=type;}}
class CustomEvent extends Event {constructor(type,options){super(type);this.detail=options.detail;}}
const intervals=new Map();let intervalId=0;
const window=new Target();
window.setInterval=(callback,ms)=>{assert(ms===200,'modest UI polling interval');const id=++intervalId;intervals.set(id,callback);return id;};
window.clearInterval=id=>intervals.delete(id);
const document=new Target();document.visibilityState='visible';
const panel=new Target(),button=new Target(),levels=new Target(),toggle=new Target();
const level=new Target(),dial=new Target(),needle=new Target();
const quietButton=new Target(),noisyButton=new Target(),quietMarker=new Target(),noisyMarker=new Target(),quietValue=new Target(),noisyValue=new Target();
const elements={microphoneLevelLive:level,microphoneLevelDial:dial,microphoneLevelNeedle:needle,
markQuietRoom:quietButton,markNoisyRoom:noisyButton,quietRoomMarker:quietMarker,noisyRoomMarker:noisyMarker,
quietRoomValue:quietValue,noisyRoomValue:noisyValue,microphoneLevelsDetail:levels,microphoneLevelsToggle:toggle};
document.getElementById=id=>elements[id];
let activeSession=null,reads=0,value=0.1;
const track={readyState:'live',muted:false};
const analyser={fftSize:2048,getFloatTimeDomainData(buffer){reads++;buffer.fill(value);}};
"""

TESTS = r"""
globalThis.testResult='pending';
assert(intervals.size===0&&reads===0,'no polling or microphone activity during initialization');
panel.hidden=false;levels.hidden=false;button.dispatchEvent(new Event('click'));
assert(intervals.size===1&&level.textContent==='Microphone inactive','opening levels with no session does not acquire a microphone');
activeSession={recorder:{state:'recording'},stream:{getAudioTracks:()=>[track]},audioContext:{state:'running'},analyser,audioSamples:new Float32Array([0.77])};
const tick=()=>[...intervals.values()][0]();
tick();
assert(level.textContent==='-20.0 dBFS'&&dial.getAttribute('aria-valuetext')===level.textContent,'single RMS readout and accessible dial agree');
assert(activeSession.audioSamples[0]>0.76,'meter uses a separate buffer from silence detection');
const buffer=activeSession.levelMeterSamples;
value=0.01;activeSession.recorder.state='paused';tick();
assert(level.textContent==='-40.0 dBFS'&&activeSession.levelMeterSamples===buffer,'paused readings work and reuse allocated buffer');
assert(microphoneLevelAngle(-70)===-90&&microphoneLevelAngle(-35)===0&&microphoneLevelAngle(0)===90,'dial maps full numeric range');
quietButton.dispatchEvent(new Event('click'));
assert(!quietMarker.hidden&&quietValue.textContent==='Q Quiet room: -40.0 dBFS','quiet marker captures measured room level');
const markedQuiet=quietMarker.getAttribute('transform');
value=0.1;tick();noisyButton.dispatchEvent(new Event('click'));
assert(!noisyMarker.hidden&&noisyValue.textContent==='N Noisy room: -20.0 dBFS'&&noisyMarker.getAttribute('transform')!==markedQuiet,'noisy marker captures a distinct measured level');
value=0.0001;tick();
assert(level.textContent==='-80.0 dBFS'&&needle.getAttribute('transform')==='rotate(-90 160 145)','numeric value remains accurate below dial range');
value=1;tick();assert(needle.getAttribute('transform')==='rotate(90 160 145)','full scale is right endpoint');
value=0;tick();assert(level.textContent==='−∞ dBFS','digital silence is not reported as a finite sound');
assert(quietButton.disabled&&noisyButton.disabled,'digital silence cannot set a misleading room reference');
value=NaN;tick();assert(level.textContent==='Input unavailable','invalid samples are not valid levels');
value=0.1;track.muted=true;const previousReads=reads;tick();
assert(reads===previousReads&&level.textContent==='Input unavailable','muted track clears stale reading without analyser reads');
track.muted=false;activeSession.audioContext.state='suspended';tick();
assert(reads===previousReads&&level.textContent==='Input unavailable','suspended audio is not resumed by meter');
activeSession.audioContext.state='running';
levels.hidden=true;toggle.dispatchEvent(new Event('click'));
assert(intervals.size===0&&level.textContent==='—','closing disclosure stops polling and clears level');
levels.hidden=false;toggle.dispatchEvent(new Event('click'));
assert(intervals.size===1,'reopening starts one poller');
button.dispatchEvent(new Event('click'));assert(intervals.size===1,'repeated open events do not duplicate pollers');
document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));
assert(intervals.size===0&&level.textContent==='—','background page stops measurement timer');
const hiddenReads=reads;publishLiveMicrophoneLevel();assert(reads===hiddenReads,'manually requested background report does not sample');
document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));
assert(intervals.size===1,'foreground visible levels resume UI polling');
panel.hidden=true;button.dispatchEvent(new Event('click'));
assert(intervals.size===0,'closing Settings stops timer');
panel.hidden=false;button.dispatchEvent(new Event('click'));
window.dispatchEvent(new Event('pagehide'));assert(intervals.size===0,'pagehide releases timer');
window.dispatchEvent(new Event('pageshow'));assert(intervals.size===1,'pageshow resumes only visible levels');
activeSession=null;tick();assert(level.textContent==='Microphone inactive','ending recording clears stale live reading');
assert(quietMarker.getAttribute('transform')===markedQuiet,'reference marker stays fixed as input changes');
globalThis.testResult='PASS';
"""


class MicrophoneLevelTests(unittest.TestCase):
    def test_passive_level_meter(self):
        evaluate(MOCKS + METER + UI + TESTS)


if __name__ == '__main__':
    unittest.main()
