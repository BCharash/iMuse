"""Spoken response gain, serialization and cancellation checks."""
import unittest
from pathlib import Path
from recording_test_support import MOCKS, evaluate

SOURCE = (Path(__file__).resolve().parents[1] / 'js/audio-response-manager.js').read_text().replace('export ', '')
HARNESS = r"""
const players=[], gains=[], bufferSources=[];
let decodeCount=0;
Blob.prototype.arrayBuffer=async()=>new ArrayBuffer(8);
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
 createGain(){const gain={gain:{value:1},connect(){},disconnect(){}};gains.push(gain);return gain;}
 async decodeAudioData(){decodeCount++;return {duration:.456,fullOriginal:true};}
 createBufferSource(){const source={connect(){},disconnect(){this.disconnected=true;},start(...args){this.startArgs=args;},stop(){this.stopped=true;}};bufferSources.push(source);return source;}
 async resume(){this.state='running';}
}
globalThis.AudioContext=AudioContext;
async function fetch(){return {ok:true,blob:async()=>new Blob(['wav'])};}
async function settle(){for(let i=0;i<60;i++)await Promise.resolve();}
"""

class AudioPromptTests(unittest.TestCase):
    def test_fallback_gain_and_serialized_prompt_volume(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 AudioContext.prototype.decodeAudioData=undefined;
 const first=playSpokenResponse('recording',{volume:.37});await settle();
 assert(gains.length===1&&gains[0].gain.value===.37&&players[0].volume===1,'gain supplies volume independently of media element support');
 const second=playSpokenResponse('stopped',{volume:0});await settle();
 assert(players[0].playCount===1,'prompts remain serialized');
 players[0].events.get('ended')();await first;await settle();
 assert(gains[0].gain.value===0&&players[0].playCount===2,'zero volume preserved for next prompt');
 players[0].events.get('ended')();await second;
 const third=playSpokenResponse('pause',{volume:1});await settle();
 assert(gains[0].gain.value===1&&gains.length===1,'full volume restored on shared graph');
 players[0].events.get('ended')();await third;globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_fallback_active_and_queued_cancellation(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 AudioContext.prototype.decodeAudioData=undefined;
 const controller=new AbortController();
 const first=playSpokenResponse('stopped',{signal:controller.signal});await settle();
 controller.abort();assert(!(await first).ok,'active prompt resolves when cancelled');
 const second=playSpokenResponse('stopped',{signal:controller.signal});
 assert(!(await second).ok&&players[0].playCount===1,'cancelled queued prompt never plays later');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_yes_predecoded_once_and_plays_full_buffer_at_selected_volume(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 prepareSpokenResponses();await settle();
 assert(decodeCount===6&&bufferSources.length===0,'Prompts are decoded before playback without starting audio');
 const first=playSpokenResponse('yes',{volume:.42});await settle();
 const source=bufferSources[0];
 assert(source.buffer.fullOriginal&&source.startArgs.join(',')==='0,0','entire original acknowledgement starts at sample zero');
 assert(gains.at(-1).gain.value===.42&&!players.some(player=>player.playCount),'buffer supplies selected volume without a media-element start');
 let completed=false;first.then(()=>completed=true);await settle();
 assert(!completed,'command acknowledgement remains pending until audio ends');
 source.onended();assert((await first).ok&&source.disconnected,'completion releases buffer source');
 const second=playSpokenResponse('yes',{volume:1});await settle();
 assert(decodeCount===6&&bufferSources.length===2&&gains.at(-1).gain.value===1,'repeated Yes reuses decoded audio at full volume');
 bufferSources[1].onended();await second;
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_buffered_yes_cancellation_releases_serial_queue(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 const controller=new AbortController();
 const first=playSpokenResponse('yes',{signal:controller.signal});await settle();
 const next=playSpokenResponse('recording');await settle();
 assert(bufferSources.length===1,'next prompt waits for buffered acknowledgement');
 controller.abort();assert(!(await first).ok&&bufferSources[0].stopped&&bufferSources[0].disconnected,'cancellation stops and disconnects buffer');
 await settle();assert(bufferSources.length===2,'next buffered prompt starts after cancellation');
 bufferSources[1].onended();await next;
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_all_spoken_prompts_use_complete_cached_buffers(self):
        evaluate(MOCKS + SOURCE + HARNESS + r"""
globalThis.testResult='pending';
(async()=>{
 prepareSpokenResponses();await settle();
 const names=['pause','yes','recording','newRecording','stopped','confirmStop'];
 assert(decodeCount===names.length&&bufferSources.length===0,'all prompts decode without starting playback');
 for(const name of names){
  const playing=playSpokenResponse(name,{volume:.7});await settle();
  const source=bufferSources.at(-1);
  assert(source.buffer.fullOriginal&&source.startArgs.join(',')==='0,0','full original buffer starts at beginning: '+name);
  assert(gains.at(-1).gain.value===.7,'volume applies to '+name);
  let finished=false;playing.then(()=>finished=true);await settle();
  assert(!finished,'completion waits for actual playback end: '+name);
  source.onended();assert((await playing).ok&&source.disconnected,'source released after '+name);
 }
 assert(decodeCount===names.length&&players.length===0,'cache reused without media-element creation or reload');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")
