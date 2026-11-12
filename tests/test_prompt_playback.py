"""Temporary prompt telemetry observes playback without changing output behavior."""
from pathlib import Path
import unittest
from recording_test_support import evaluate
SOURCE=(Path(__file__).resolve().parents[1]/'js/audio-response-manager.js').read_text().replace('export ', '')
MOCKS=r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
const console={warn(){}};const navigator={audioSession:{type:'auto',state:'active'}};
const timers=new Map();let nextTimer=0;
const setTimeout=fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout=id=>timers.delete(id);
const fetch=async()=>({ok:true,blob:async()=>({})}),URL={createObjectURL:()=> 'blob:prompt'};
let player;class Audio{
 constructor(){player=this;this.events=new Map();this.volume=1;this.muted=false;this.paused=true;this.currentTime=0;this.duration=1.056;this.readyState=4;this.networkState=1;this.playbackRate=1;}
 setAttribute(){}addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
 removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
 pause(){this.paused=true;}emit(type){for(const fn of this.events.get(type)||[])fn();}
 play(){this.paused=false;this.emit('playing');return Promise.resolve();}
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
'''
class PromptPlaybackTests(unittest.TestCase):
 def test_events_success_cleanup_and_no_route_writes(self):
  evaluate(MOCKS+SOURCE+r'''
globalThis.testResult='pending';(async()=>{
 const observations=[];const playing=playSpokenResponse('stopped',event=>observations.push(event));await flush();
 player.currentTime=1.056;player.emit('ended');const result=await playing;
 assert(result.ok&&observations.some(e=>e.event==='playing')&&observations.some(e=>e.event==='play-resolved'),'actual playback lifecycle observed');
 const end=observations.find(e=>e.event==='finish');
 assert(end.reason==='ended'&&end.currentTime===1.056&&end.duration===1.056&&end.volume===1&&!end.muted,'finish includes truthful player state');
 assert(end.source==='audio/recording-stopped.wav'&&end.sessionType==='auto'&&navigator.audioSession.type==='auto','original source and session unchanged');
 assert([...player.events.values()].every(set=>set.size===0)&&timers.size===0,'temporary listeners/timer removed');
 const next=playSpokenResponse('newRecording',()=>{throw Error('observer failure');});await flush();player.emit('ended');assert((await next).ok,'observer failure cannot disrupt next prompt');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack));
''')
 def test_failure_is_distinguished_from_ended(self):
  evaluate(MOCKS+SOURCE+r'''
globalThis.testResult='pending';(async()=>{
 const events=[];const playing=playSpokenResponse('stopped',event=>events.push(event));await flush();
 player.error={code:3,message:'decode failed'};player.emit('error');
 assert(!(await playing).ok&&events.at(-1).reason==='media-error'&&events.at(-1).errorCode===3,'error completion is not reported as ended');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e)+String(e.stack));
''')
if __name__=='__main__':unittest.main()
