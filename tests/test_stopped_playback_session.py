"""Reversible iPhone-only playback-intent experiment; no microphone or actual route simulation."""
from pathlib import Path
import unittest
from recording_test_support import evaluate
SOURCE=(Path(__file__).resolve().parents[1]/'js/audio-response-manager.js').read_text().replace('export ', '')
MOCKS=r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
const navigator={userAgent:'iPhone',audioSession:{type:'auto'}};
const console={warn(){}};
const timers=new Map();let next=0;
const setTimeout=fn=>{timers.set(++next,fn);return next;},clearTimeout=id=>timers.delete(id);
const fetch=async()=>({ok:true,blob:async()=>({})}),URL={createObjectURL:()=> 'blob:test'};
let player;class Audio {
 constructor(){player=this;this.handlers=new Map();}
 setAttribute(){}pause(){}addEventListener(type,fn){this.handlers.set(type,fn);}removeEventListener(type){this.handlers.delete(type);}
 play(){return Promise.resolve();}
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
'''
def check(script):
 evaluate(MOCKS+SOURCE+"\nglobalThis.testResult='pending';(async()=>{\n"+script+"\nglobalThis.testResult='PASS';})().catch(e=>globalThis.testResult=String(e)+String(e.stack));")
class StoppedPlaybackSessionTests(unittest.TestCase):
 def test_iphone_idle_stop_only_and_restoration(self):
  check(r'''
const release=requestStoppedPlaybackSession('stopped',()=>true);
assert(navigator.audioSession.type==='playback','idle iPhone stop requests media playback');release();assert(navigator.audioSession.type==='auto','prior type restored');
for(const [name,idle] of [['newRecording',true],['pause',true],['stopped',false]]){
 requestStoppedPlaybackSession(name,()=>idle);assert(navigator.audioSession.type==='auto','other prompts/active capture unaffected');}
navigator.userAgent='Macintosh';requestStoppedPlaybackSession('stopped',()=>true);assert(navigator.audioSession.type==='auto','Mac unaffected');
navigator.userAgent='iPhone';delete navigator.audioSession;requestStoppedPlaybackSession('stopped',()=>true);
''')
 def test_actual_player_ended_timeout_failure_and_capture_handoff(self):
  check(r'''
const options={canUsePlaybackSession:()=>true};
const playing=playSpokenResponse('stopped',options);await flush();assert(navigator.audioSession.type==='playback'&&player.src==='blob:test','request at actual playback');
releaseStoppedPlaybackSession();assert(navigator.audioSession.type==='auto','new microphone acquisition can release override immediately');
navigator.audioSession.type='play-and-record';player.handlers.get('ended')();assert((await playing).ok&&navigator.audioSession.type==='play-and-record','old completion cannot change new capture session');
navigator.audioSession.type='auto';const timeout=playSpokenResponse('stopped',options);await flush();[...timers.values()][0]();assert(!(await timeout).ok&&navigator.audioSession.type==='auto','timeout restores mode');
const failed=playSpokenResponse('stopped',options);await flush();player.error={message:'failed'};player.handlers.get('error')();assert(!(await failed).ok&&navigator.audioSession.type==='auto','media error restores mode');
''')
 def test_session_assignment_failure_does_not_block_playback(self):
  check(r'''
let writes=0;Object.defineProperty(navigator.audioSession,'type',{get:()=> 'auto',set(){writes++;throw Error('unsupported');}});
const playing=playSpokenResponse('stopped',{canUsePlaybackSession:()=>true});await flush();player.handlers.get('ended')();
assert((await playing).ok&&writes===1,'unsupported assignment leaves ordinary playback usable');
''')
if __name__=='__main__':unittest.main()
