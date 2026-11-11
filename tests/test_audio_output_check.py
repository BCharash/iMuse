"""Isolated output-check ownership and post-release playback; no real microphone."""
from pathlib import Path
import unittest
from recording_test_support import evaluate
SOURCE=(Path(__file__).resolve().parents[1]/'js/audio-output-check.js').read_text()
SOURCE='\n'.join(line for line in SOURCE.splitlines() if not line.startswith('import '))
MOCKS=r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,{checked:id!=='analysis',value:'',disabled:false});return elements.get(id);}};
const window={addEventListener(){}};
let gate=null,calls=0,closed=0,stopped=0;
function track(){return {readyState:'live',stop(){this.readyState='ended';stopped++;},getSettings(){return {sampleRate:48000};}};}
function streamFor(t){return {getTracks:()=>[t],getAudioTracks:()=>[t]};}
const navigator={userAgent:'test',audioSession:{type:'auto',state:'inactive'},mediaDevices:{getUserMedia:async()=>gate?await gate:streamFor(track())}};
class MediaRecorder {
 constructor(){this.state='inactive';this.listeners={};}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 start(){this.state='recording';}stop(){this.state='inactive';for(const fn of this.listeners.stop||[])fn();}
}
class AudioContext {
 constructor(){this.state='running';this.destination={};this.sampleRate=48000;}
 node(){return {connect(){},disconnect(){},gain:{value:1}};}
 createMediaStreamSource(){return this.node();}createAnalyser(){return this.node();}createGain(){return this.node();}createScriptProcessor(){return this.node();}
 async resume(){}async close(){closed++;this.state='closed';}
}
function prepareSpokenResponses(){}
async function playSpokenResponse(){assert(stream===null&&context===null,'no capture retained during message');calls++;return {ok:true};}
'''
class AudioOutputCheckTests(unittest.TestCase):
 def test_post_capture_playback_and_session_restore(self):
  evaluate(MOCKS+SOURCE+r'''
globalThis.testResult='pending';(async()=>{
 await start();assert(phase==='capturing','capture starts');await stop();assert(stopped===1&&calls===1,'microphone stopped before automatic message');
 document.getElementById('analysis').checked=true;await start();await stop();assert(closed===1&&calls===2,'graph closed before message');
 await message('playback');assert(navigator.audioSession.type==='auto'&&calls===3,'explicit playback mode restored after test');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack));
''')
 def test_cancelled_permission_cannot_take_microphone_ownership(self):
  evaluate(MOCKS+SOURCE+r'''
globalThis.testResult='pending';(async()=>{
 let resolve;gate=new Promise(done=>resolve=done);const opening=start();
 await stop();const late=track();resolve(streamFor(late));await opening;
 assert(late.readyState==='ended'&&stream===null&&phase==='idle','late canceled microphone is released');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack));
''')
if __name__=='__main__':unittest.main()
