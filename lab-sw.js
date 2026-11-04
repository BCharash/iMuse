// Registered only for lab.html and js/lab/ URL prefixes; production iMuse pages are outside both scopes.
const CACHE='imuse-simple-lab-v1';
const root=new URL('./',self.location.href);
const core=['lab.html','lab-sw.js','js/lab/app.js','js/lab/core.js','js/lab/store.js','js/lab/capture.js','js/lab/media.js','js/lab/detection-worker.js','js/lab/input-worklet.js','js/lab/whisper-worker.js','js/lab/style.css','js/lab/manifest.json','js/heed/wakeword.js','js/heed/preprocessing.js','js/heed/filter-coeffs.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(core.map(path=>new URL(path,root).href));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==root.origin)return;
 const relative=url.pathname.slice(root.pathname.length);if(!relative.startsWith('js/lab/')&&!relative.startsWith('js/heed/')&&relative!=='lab.html'&&relative!=='lab-sw.js')return;
 const immutable=relative.includes('/vendor/')||relative.includes('/models/')||relative.endsWith('.onnx');
 event.respondWith((async()=>{const cache=await caches.open(CACHE),stored=await cache.match(event.request,{ignoreSearch:true});
  if(immutable&&stored)return stored;
  try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}catch(error){if(stored)return stored;throw error;}
 })());
});
