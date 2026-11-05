"""Download naming, cancellation and local timestamp regression checks."""
import unittest
from pathlib import Path
from recording_test_support import evaluate, RECOVERY_SOURCE, between

NAMING = (Path(__file__).resolve().parents[1] / 'js/recording-download.js').read_text().replace('export ', '')

class RecordingDownloadTests(unittest.TestCase):
    def test_local_time_and_portable_description(self):
        evaluate(NAMING + r'''
const assert = (v,m) => {if(!v) throw Error(m);};
const local = new Date(2026,10,5,14,32,8);
assert(localRecordingStamp(local)==='2026-11-05_14-32-08','uses local components');
assert(downloadDescription('  Meeting: Anna / João.  ')==='Meeting- Anna - João','portable Unicode description');
assert(downloadDescription(' ... ')==='iMuse','empty fallback');
assert(downloadDescription('a'.repeat(200)).length===100,'bounded description');
globalThis.testResult='PASS';
''')

    def test_dialog_submit_cancel_and_single_owner(self):
        evaluate(r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.events={};}
 append(...items){this.children.push(...items);}
 appendChild(item){this.append(item);}
 setAttribute(){} addEventListener(type,fn){this.events[type]=fn;}
 showModal(){this.open=true;} close(){this.open=false;this.events.close?.();}
 remove(){document.body.children=document.body.children.filter(x=>x!==this);}
 focus(){} select(){}
}
const document={createElement:tag=>new Element(tag),body:new Element('body')};
''' + NAMING + r'''
globalThis.testResult='pending';
(async()=>{
 const first=requestDownloadFilename('2026-11-05_14-32-08_iMuse','m4a');
 const dialog=document.body.children[0],form=dialog.children[1],input=form.children[0].children[0];
 assert(form.children[1].textContent==='2026-11-05_14-32-08_iMuse.m4a','default preview');
 assert(await requestDownloadFilename('other_iMuse','webm')===null,'second request cannot steal choice');
 input.value='Meeting / Anna';input.events.input();
 assert(form.children[1].textContent==='2026-11-05_14-32-08_Meeting - Anna.m4a','safe preview');
 form.events.submit({preventDefault(){}});
 assert(await first==='2026-11-05_14-32-08_Meeting - Anna','fixed prefix and edited description');
 assert(document.body.children.length===0,'dialog removed');
 const canceled=requestDownloadFilename('2026-11-05_14-32-08_iMuse','webm');
 document.body.children[0].events.cancel({preventDefault(){}});
 assert(await canceled===null&&document.body.children.length===0,'escape cancels without filename');
 const next=requestDownloadFilename('2026-11-05_14-32-08_iMuse','webm');
 document.body.children[0].children[1].children[2].children[0].events.click();
 assert(await next===null,'cancel button cancels');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e.stack));
''')

    def test_current_playback_creates_download_and_uses_original_start(self):
        evaluate(r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
const controls={hidden:true,children:[],insertBefore(button,before){assert(before===deleteButton,'download next to delete');this.children.unshift(button);}};
const deleteButton={parentElement:controls};controls.children.push(deleteButton);
const document={getElementById:id=>controls.children.find(child=>child.id===id),createElement:()=>({events:{},addEventListener(type,fn){this.events[type]=fn;}})};
const window={lastRecording:null},status={},recordingControls=controls;
const audioPlayer={hidden:true,load(){}},URL={createObjectURL:()=> 'blob:current',revokeObjectURL(){}};
let recordingUrl=null,displayedSessionId=null;
const metadata={startedAt:'2026-11-05T14:32:08Z',downloadStamp:'2026-11-05_14-32-08'};
const emergencyRecordings=new Map();
const getSession=async id=>{assert(id==='current','reads current session');return metadata;};
const boundedStorageRead=promise=>promise;
let requested,downloaded=true;
const downloadAudioBlob=async(blob,name)=>{requested={blob,name};return downloaded;};
''' + NAMING + between('function showPlayback(', 'function audioFileExtension(')
                 + between('function sessionFilename(', 'function renderRecoverableSessions(') + r'''
globalThis.testResult='pending';
(async()=>{
 const blob={size:12,type:'audio/mp4'};
 showPlayback(blob,'current');
 const button=document.getElementById('downloadRecordingButton');
 assert(button&&controls.hidden===false&&audioPlayer.hidden===false,'current playback exposes download control');
 await button.events.click();
 assert(requested.blob===blob&&requested.name==='2026-11-05_14-32-08_iMuse','current audio uses original start time');
 assert(!button.disabled&&status.textContent.includes('Download started'),'success restores button');
 showPlayback(blob,'current');
 assert(controls.children.length===2,'repeated playback does not duplicate control');
 downloaded=false;await button.events.click();
 assert(status.textContent.includes('canceled')&&window.lastRecording===blob&&!button.disabled,'cancel retains current audio');
 emergencyRecordings.set('emergency',{metadata});
 showPlayback(blob,'emergency');await button.events.click();
 assert(requested.name==='2026-11-05_14-32-08_iMuse','emergency current download also works without database read');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e.stack));
''')

    def test_actual_download_waits_for_choice_and_keeps_format(self):
        evaluate(r'''
const assert=(v,m)=>{if(!v)throw Error(m);};
let choice,created=0,clicked=0,link;
const requestDownloadFilename=async(name,ext)=>{assert(name==='prefix_iMuse'&&ext==='m4a','correct naming request');return choice;};
const URL={createObjectURL(){created++;return 'blob:audio';},revokeObjectURL(){}};
const document={body:{appendChild(){}},createElement(){link={style:{},click(){clicked++;},remove(){}};return link;}};
const window={setTimeout(){}};
''' + between('function audioFileExtension(', 'function sessionFilename(') + r'''
globalThis.testResult='pending';
(async()=>{
 const blob={size:12,type:'audio/mp4'};
 choice=null;assert(await downloadAudioBlob(blob,'prefix_iMuse')===false&&created===0&&clicked===0,'cancel creates no download or URL');
 choice='prefix_Meeting';assert(await downloadAudioBlob(blob,'prefix_iMuse')===true,'confirmation succeeds');
 assert(link.download==='prefix_Meeting.m4a'&&created===1&&clicked===1,'selected name and actual format used');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e.stack));
''')

    def test_cancel_preserves_emergency_and_releases_storage_before_choice(self):
        evaluate(RECOVERY_SOURCE + r'''
class Blob {constructor(parts){this.size=parts.reduce((n,p)=>n+p.size,0);}}
const setTimeout=()=>1,clearTimeout=()=>{};
const inspectRecordingChunks=()=>({parts:[{size:12}],report:{ok:true}});
const assert=(v,m)=>{if(!v)throw Error(m);};
globalThis.testResult='pending';
(async()=>{
 let locked=false,downloads=0;
 const status={textContent:''};
 const recovery=createRecordingRecovery({
  recordingStorage:{async run(fn){locked=true;try{return await fn();}finally{locked=false;}}},
  status,getSession:async()=>({id:'saved',state:'completed'}),getChunks:async()=>[],
  assertSessionIdle(){},sessionFilename:()=> 'prefix_iMuse',
  downloadAudioBlob:async()=>{assert(!locked,'no storage lock while choosing name');downloads++;return false;}
 });
 const emergency={blob:{size:12},metadata:{id:'emergency'}};
 recovery.emergencies.set('emergency',emergency);
 const button={disabled:false};
 await recovery.exportSavedSession('emergency',button);
 assert(downloads===1&&!button.disabled&&status.textContent.includes('canceled'),'cancel reported and control restored');
 assert(recovery.emergencies.get('emergency')===emergency,'full emergency retained');
 await recovery.exportSavedSession('saved',button);
 assert(downloads===2&&!locked&&!button.disabled&&status.textContent.includes('canceled'),'saved download choice runs outside writer lock');
 globalThis.testResult='PASS';
})().catch(e=>globalThis.testResult=String(e.stack));
''')

if __name__ == '__main__':
    unittest.main()
