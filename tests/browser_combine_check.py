"""Real browser acceptance check: generated AAC only, isolated profile and database.
Run from the repository root with python3 tests/browser_combine_check.py.
Requires Chrome; CHROME_BIN can override the macOS default. No real microphone,
clipboard, production-site data or Downloads directory is used.
"""
import http.server,threading,subprocess,tempfile,time,json,urllib.request,socket,os,base64,struct
from pathlib import Path
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
profile=tempfile.mkdtemp(prefix='imuse-combine-check-',dir='/tmp');log=open('/tmp/imuse-browser.log','w')
chrome=subprocess.Popen([os.environ.get('CHROME_BIN','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),'--headless=new','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-allow-origins=*','--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=log,stderr=log)
os.chdir(Path(__file__).resolve().parents[1])
sock=None
try:
 file=Path(profile)/'DevToolsActivePort';deadline=time.time()+25
 while not file.exists():
  if time.time()>deadline:raise RuntimeError('Chrome not ready')
  time.sleep(.1)
 port=int(file.read_text().splitlines()[0]);target=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list'))[0]
 from urllib.parse import urlsplit
 url=urlsplit(target['webSocketDebuggerUrl']);sock=socket.create_connection((url.hostname,url.port));sock.settimeout(60)
 key=base64.b64encode(os.urandom(16)).decode();sock.sendall(f'GET {url.path} HTTP/1.1\r\nHost: {url.hostname}:{url.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode());header=b''
 while b'\r\n\r\n' not in header:header+=sock.recv(1)
 assert b'101' in header
 serial=0
 def read(n):
  data=b''
  while len(data)<n:data+=sock.recv(n-len(data))
  return data
 def call(method,params={}):
  global serial
  serial+=1;payload=json.dumps({'id':serial,'method':method,'params':params}).encode();n=len(payload);mask=os.urandom(4)
  header=bytes([129,128|n]) if n<126 else bytes([129,254])+struct.pack('!H',n) if n<65536 else bytes([129,255])+struct.pack('!Q',n)
  sock.sendall(header+mask+bytes(v^mask[i%4] for i,v in enumerate(payload)))
  while True:
   _,second=read(2);n=second&127
   if n==126:n=struct.unpack('!H',read(2))[0]
   elif n==127:n=struct.unpack('!Q',read(8))[0]
   message=json.loads(read(n))
   if message.get('id')==serial:
    if 'error' in message:raise RuntimeError(message)
    return message['result']
 def js(expression):
  result=call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True})
  if 'exceptionDetails' in result:raise RuntimeError(result['exceptionDetails'])
  return result.get('result',{}).get('value')
 def navigate():
  call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/index.html'})
  for _ in range(100):
   if js('document.readyState')=='complete':return
   time.sleep(.1)
 call('Browser.setDownloadBehavior',{'behavior':'deny'})
 call('Page.enable');call('Runtime.enable');navigate()
 print('M4A',js(r'''(async()=>{
 const {combineM4a}=await import('./js/recording-combine-mux.js');
 const {runRecordingCombine}=await import('./js/recording-combine.js');
 const {Input,MP4,BlobSource,EncodedPacketSink}=await import('./js/vendor/mediabunny-1.65.2.mjs');
 const context=new AudioContext({sampleRate:48000});await context.resume();
 const recordings=[];
 for(let i=0;i<3;i++){
 const destination=context.createMediaStreamDestination(),osc=context.createOscillator();osc.frequency.value=[440,660,880][i];osc.connect(destination);
 const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/mp4;codecs=mp4a.40.2'}),chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 const ended=new Promise(resolve=>recorder.onstop=resolve);osc.start();recorder.start(100);await new Promise(resolve=>setTimeout(resolve,650));recorder.stop();await ended;osc.stop();destination.stream.getTracks().forEach(t=>t.stop());
 recordings.push({session:{id:'source-'+i,startedAt:`2026-02-0${i+1}T12:00:00.000Z`,mimeType:recorder.mimeType},filename:'source-'+i+'.m4a',blob:new Blob(chunks,{type:recorder.mimeType})});
 }
 const ac=await runRecordingCombine([recordings[2],recordings[0]],{onProgress:console.log});
 const nested={session:{id:ac.metadata.id,startedAt:ac.metadata.createdAt,mimeType:'audio/mp4',combineMetadata:ac.metadata},filename:'AC.m4a',blob:ac.blob};
 const abc=await combineM4a([nested,recordings[1]],console.log);
 if(abc.metadata.segments.map(s=>s.sourceId).join(',')!=='source-0,source-1,source-2')throw Error('nested ordering');
 async function packets(blob){const input=new Input({source:new BlobSource(blob),formats:[MP4]});try{const sink=new EncodedPacketSink(await input.getPrimaryAudioTrack()),result=[];for await(const packet of sink.packets())result.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packet.data))).join(','));return result;}finally{input.dispose();}}
 const expected=(await Promise.all(recordings.map(r=>packets(r.blob)))).flat(),actual=await packets(abc.blob);
 if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Encoded AAC bytes changed or lost');
 const audio=await context.decodeAudioData(await abc.blob.arrayBuffer());
 const offsets=[];let frame=0;
 for(const segment of abc.metadata.segments){const start=frame+Math.round(.15*48000),end=frame+Math.round(.45*48000),samples=audio.getChannelData(0);let count=0;for(let j=start;j<end;j++)if(samples[j-1]<=0&&samples[j]>0)count++;offsets.push(count/.3);frame+=segment.sampleCount;}
 if(offsets.some((v,i)=>Math.abs(v-[440,660,880][i])>10))throw Error('decoded chronology '+offsets);
 const duplicate=await combineM4a([recordings[0],{session:{id:abc.metadata.id,startedAt:abc.metadata.createdAt,mimeType:'audio/mp4',combineMetadata:abc.metadata},blob:abc.blob,filename:'ABC.m4a'}]);
 if(duplicate.metadata.segments.length!==4)throw Error('repeated occurrence lost');
 window.combineFixtures=recordings;window.combinedExample=abc;
 await context.close();
 return {packets:actual.length,unchangedAAC:true,decodedSeconds:audio.duration,frequencies:offsets,nested:true,repeatedSources:true};
 })()'''),flush=True)
 print('LIBRARY',js(r'''(async()=>{
 const {createRecordingStore,RECORDING_DB_NAME}=await import('./js/recording-store.js');
 const {createRecordingStorageCoordinator}=await import('./js/recording-storage-coordinator.js');
 const store=createRecordingStore({coordinator:createRecordingStorageCoordinator(navigator.locks,RECORDING_DB_NAME+'/writer'),assertSessionIdle:()=>{}});await store.open();
 for(const input of combineFixtures){await store.putSession({...input.session,state:'completed',chunkCount:0,bytesStored:0});await store.persistChunk(input.session.id,0,input.blob);}
 const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async(test)=>{for(let i=0;i<500;i++){if(await test())return;await wait(20);}throw Error('Timeout '+document.getElementById('status').textContent);};
 const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const saved=()=>document.getElementById('recordings-saved');
 const row=id=>saved().querySelector(`[data-recording-id="${id}"]`);
 const rows=()=>[...saved().querySelectorAll('[data-recording-id]')];
 const toggle=button(document.querySelector('[aria-label="Saved Recordings"]'),'View');toggle.click();await until(()=>rows().length===3);
 button(saved(),'Combine').click();await until(()=>saved().querySelectorAll('input[type=checkbox]').length===3);
 if([...saved().querySelectorAll('input')].some(b=>b.checked)||!button(saved(),'Combine selected (0)').disabled)throw Error('Selection must start empty');
 for(const id of ['source-2','source-0']){const box=row(id).querySelector('input');box.checked=true;box.dispatchEvent(new Event('change'));}
 button(saved(),'Combine selected (2)').click();await until(async()=>{const all=await store.getAllSessions();return all.length===4;});await until(()=>rows().length===4);
 let all=await store.getAllSessions(),ac=all.find(s=>s.combineMetadata);
 if(rows()[0].getAttribute('data-recording-id')!==ac.id||!row(ac.id).querySelector('summary').textContent.includes('(2)'))throw Error('New item top/sources');
 if(!button(row(ac.id),'Download').classList.contains('recording-download-pending'))throw Error('Fresh download reminder');
 if(row(ac.id).querySelector('strong')?.textContent!=='Combined recording')throw Error('Combined designation not bold');
 if(getComputedStyle(row(ac.id)).borderTopStyle!=='solid')throw Error('Missing divider below Combine controls');
 for(const original of combineFixtures){const chunks=await store.getChunks(original.session.id);if(chunks.length!==1||chunks[0].blob.size!==original.blob.size)throw Error('Original changed');}
 button(saved(),'Combine').click();await until(()=>saved().querySelectorAll('input').length===4);
 for(const id of [ac.id,'source-1']){const box=row(id).querySelector('input');box.checked=true;box.dispatchEvent(new Event('change'));}
 button(saved(),'Combine selected (2)').click();await until(async()=>(await store.getAllSessions()).length===5);await until(()=>rows().length===5);
 all=await store.getAllSessions();const abc=all.filter(s=>s.combineMetadata).find(s=>s.id!==ac.id);
 if(abc.combineMetadata.segments.map(s=>s.sourceId).join(',')!=='source-0,source-1,source-2')throw Error('Library nested provenance');
 // Cancel an actual worker invocation; no partial saved item may appear.
 button(saved(),'Combine').click();await until(()=>saved().querySelectorAll('input').length===5);
 for(const id of [abc.id,ac.id]){const box=row(id).querySelector('input');box.checked=true;box.dispatchEvent(new Event('change'));}
 button(saved(),'Combine selected (2)').click();await until(()=>button(saved(),'Cancel'));
 button(saved(),'Cancel').click();await until(()=>document.getElementById('status').textContent.includes('cancelled'));
 if((await store.getAllSessions()).length!==5||document.getElementById('recordButton').disabled)throw Error('Cancel left a new item or locked Record');
 button(saved(),'Cancel').click();await until(()=>button(saved(),'Combine'));
 // Unsupported input must fail without publishing a misleading completed item.
 await store.putSession({id:'unsupported',state:'completed',startedAt:'2026-02-04T12:00:00Z',mimeType:'audio/wav',chunkCount:0,bytesStored:0});await store.persistChunk('unsupported',0,new Blob(['RIFF-not-m4a'],{type:'audio/wav'}));
 button(document.querySelector('[aria-label="Saved Recordings"]'),'Hide').click();button(document.querySelector('[aria-label="Saved Recordings"]'),'View').click();await until(()=>rows().length===6);
 button(saved(),'Combine').click();await until(()=>saved().querySelectorAll('input').length===6);
 for(const id of ['unsupported','source-0']){const box=row(id).querySelector('input');box.checked=true;box.dispatchEvent(new Event('change'));}
 button(saved(),'Combine selected (2)').click();await until(()=>document.getElementById('status').textContent.includes('Could not combine'));
 if((await store.getAllSessions()).length!==6||document.getElementById('recordButton').disabled)throw Error('Failed combine published output/locked Record');
 button(saved(),'Cancel').click();await until(()=>button(saved(),'Combine'));
 // A download request persists for the combined result as for ordinary recordings.
 button(row(abc.id),'Download').click();await until(()=>document.querySelector('dialog input'));
 button(document.querySelector('dialog'),'Download').click();await until(async()=>Boolean((await store.getSession(abc.id)).downloadRequestedAt));
 // Archive/unarchive retains the full combined history and original ID.
 button(row(abc.id),'Archive').click();await until(()=>!row(abc.id));
 const archived=document.getElementById('recordings-archived');button(document.querySelector('[aria-label="Archived Recordings"]'),'View').click();await until(()=>document.getElementById('recordings-archived').querySelector('[data-recording-id]'));
 const archivedRow=document.getElementById('recordings-archived').querySelector(`[data-recording-id="${abc.id}"]`);
 if(!archivedRow.textContent.includes('Download requested')||archivedRow.querySelector('strong')?.textContent!=='Combined recording')throw Error('Archived designation/download reminder');
 button(document.getElementById('recordings-archived').querySelector(`[data-recording-id="${abc.id}"]`),'Unarchive').click();await until(()=>row(abc.id));
 if((await store.getSession(abc.id)).combineMetadata.segments.length!==3)throw Error('History lost after archive');
 return {saved:rows().length,originalsPreserved:true,nestedSaved:true,cancelNoPartial:true,unsupportedNoPartial:true,downloadMarker:true,archiveHistory:true};
 })()'''),flush=True)
 call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
 print('MOBILE',js("({width:innerWidth,content:document.documentElement.scrollWidth})"),flush=True)
 shot=call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True});Path('/tmp/imuse-production-combine-mobile.png').write_bytes(base64.b64decode(shot['data']))
 Path('/tmp/imuse-production-combine-metadata.json').write_text(json.dumps(js('combinedExample.metadata'),indent=2)+'\n')
 print('PASS',flush=True)
finally:
 if sock:sock.close()
 chrome.terminate()
 try:chrome.wait(timeout=5)
 except subprocess.TimeoutExpired:chrome.kill()
 server.shutdown();log.close()
 import shutil
 shutil.rmtree(profile,ignore_errors=True)
