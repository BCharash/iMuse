"""Spoken response gain, serialization and cancellation checks."""
import unittest
from pathlib import Path
from recording_test_support import MOCKS, evaluate

SOURCE = (Path(__file__).resolve().parents[1] / 'js/audio-response-manager.js').read_text().replace('export ', '')
HARNESS = r"""
const players=[], gains=[];
class Audio {
 constructor(){this.events=new Map();this.volume=1;players.push(this);}
 setAttribute(){} pause(){}
 addEventListener(type,fn){this.events.set(type,fn);}
 removeEventListener(type){this.events.delete(type);}
 play(){this.playCount=(this.playCount||0)+1;return Promise.resolve();}
}
class AudioContext {
 constructor(){this.state='suspended';}
 createMediaElementSource(){return {connect(){}};}
 createGain(){const gain={gain:{value:1},connect(){}};gains.push(gain);return gain;}
 async resume(){this.state='running';}
}
globalThis.AudioContext=AudioContext;
async function fetch(){return {ok:true,blob:async()=>new Blob(['wav'])};}
async function settle(){for(let i=0;i<60;i++)await Promise.resolve();}
"""

class AudioPromptTests(unittest.TestCase):
    def test_gain_and_serialized_prompt_volume(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 const first=playSpokenResponse('recording',{volume:.37});await settle();
 assert(gains.length===1&&gains[0].gain.value===.37&&players[0].volume===1,'gain supplies volume independently of media element support');
 const second=playSpokenResponse('stopped',{volume:0});await settle();
 assert(players[0].playCount===1,'prompts remain serialized');
 players[0].events.get('ended')();await first;await settle();
 assert(gains[0].gain.value===0&&players[0].playCount===2,'zero volume preserved for next prompt');
 players[0].events.get('ended')();await second;
 const third=playSpokenResponse('yes',{volume:1});await settle();
 assert(gains[0].gain.value===1&&gains.length===1,'full volume restored on shared graph');
 players[0].events.get('ended')();await third;globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_active_and_queued_cancellation(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 const controller=new AbortController();
 const first=playSpokenResponse('stopped',{signal:controller.signal});await settle();
 controller.abort();assert(!(await first).ok,'active prompt resolves when cancelled');
 const second=playSpokenResponse('stopped',{signal:controller.signal});
 assert(!(await second).ok&&players[0].playCount===1,'cancelled queued prompt never plays later');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")
