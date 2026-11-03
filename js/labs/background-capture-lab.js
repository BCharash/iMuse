// Standalone diagnostic replica. Never import production application modules.
const $ = id => document.getElementById(id);
const checks = ['agc', 'noise', 'echo', 'context', 'graph', 'ring', 'poll', 'storage', 'speech', 'preload', 'request', 'probes', 'wakeLock', 'bookkeeping', 'ordering', 'separateWarning'];
const values = ['preset', 'timeslice', 'micMode', 'device', 'silence', 'threshold', 'warning', 'recovery', 'environment', 'scenario'];
const DB_NAME = 'imuse-background-lab-v1';
const EVENT_LIMIT = 12000;
const PENDING_LIMIT = 8 * 1024 * 1024;
const sounds = {newRecording: 'audio/new-recording.wav', pause: 'audio/pause.wav', recording: 'audio/recording.wav', warning: 'audio/recording-interrupted.wav'};
const headsetPattern = /shokz|openrun|openmove|aeropex|headset|headphones|headphone|hands.free|airpods|earpods|earbuds|earphones|beats|jabra|plantronics|poly voyager|bose|sony wh-|sony wf-|sennheiser|bluetooth|wireless headset|usb headset|usb audio headset/i;
let run = null, busy = false, database;
const urls = [];
// Match production's sparse diagnostic writes, not every chunk or render.
const storedEvents = new Set(['session-created', 'recorder-start', 'recorder-pause', 'recorder-resume', 'recorder-error', 'recorder-stop', 'track-mute', 'track-unmute', 'track-ended', 'visibility-change', 'snapshot', 'first-chunk-after-foreground', 'warning-play-request', 'warning-play-accepted', 'warning-play-rejected']);
const safe = fn => { try { return fn(); } catch { return null; } };
function status(message) { $('status').textContent = message; }
function event(r, type, details = {}) {
  if (!r) return;
  r.events.push({at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - r.started), type,
    visibility: document.visibilityState, recorder: r.recorder?.state ?? null,
    track: r.track?.readyState ?? null, muted: r.track?.muted ?? null,
    context: r.ctx?.state ?? null, ...details});
  if (r.events.length > EVENT_LIMIT) { r.events.shift(); r.droppedEvents++; }
  if (r.settings.bookkeeping && r.db && storedEvents.has(type)) {
    try {
      const tx = r.db.transaction('events', 'readwrite');
      tx.objectStore('events').add({runId: r.id, ...r.events[r.events.length - 1], committed: r.committed, pendingBytes: r.pendingBytes});
      tx.onerror = tx.onabort = () => { r.diagnosticWriteError = String(tx.error); };
    } catch (error) { r.diagnosticWriteError = String(error); }
  }
}
function settings() {
  return Object.freeze({...Object.fromEntries(checks.map(id => [id, $(id).checked])),
    ...Object.fromEntries(values.map(id => [id, $(id).value]))});
}
function buttons() {
  const active = !!run && !run.finished;
  $('config').disabled = busy || active;
  $('start').disabled = busy || active;
  for (const id of ['stop', 'resume', 'contextResume', 'probe']) $(id).disabled = busy || !active;
  $('saved').disabled = busy || active;
}
function applyPreset() {
  for (const id of checks) $(id).checked = false;
  $('timeslice').value = '250'; $('micMode').value = 'direct'; $('silence').value = 'none';
  $('warning').value = 'none'; $('recovery').value = 'observe';
  const name = $('preset').value;
  const combined = ['combined', 'wake', 'bookkeeping', 'ordering', 'lifecycle', 'warningReplica'].includes(name);
  if (name !== 'minimal') {
    for (const id of ['agc', 'noise', 'echo', 'context', 'graph', 'poll', 'request', 'probes']) $(id).checked = true;
    $('silence').value = 'lab'; $('recovery').value = 'all';
  }
  if (name === 'storage' || combined) $('storage').checked = true;
  if (name === 'speech' || combined) $('speech').checked = true;
  if (combined) {
    $('agc').checked = false; $('ring').checked = true; $('preload').checked = true;
    $('request').checked = false; $('micMode').value = 'imuse';
    $('silence').value = 'imuse'; $('recovery').value = 'suspended';
  }
  const all = name === 'lifecycle' || name === 'warningReplica';
  $('wakeLock').checked = name === 'wake' || all;
  $('bookkeeping').checked = name === 'bookkeeping' || all;
  $('ordering').checked = name === 'ordering' || all;
  if (name === 'warningReplica') { $('separateWarning').checked = true; $('warning').value = 'hidden'; }
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || Error('Lab storage transaction failed'));
  });
}
function openDB() {
  if (!database) database = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('runs')) req.result.createObjectStore('runs', {keyPath: 'id'});
      if (!req.result.objectStoreNames.contains('chunks')) {
        const chunks = req.result.createObjectStore('chunks', {keyPath: ['id', 'sequence']});
        chunks.createIndex('runId', 'id');
      }
      if (!req.result.objectStoreNames.contains('events')) req.result.createObjectStore('events', {autoIncrement: true});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Error('Lab database blocked by another tab'));
  }).catch(error => { database = null; throw error; });
  return database;
}
function metadata(r) {
  return {labRevision: 2, id: r.id, createdAt: r.createdAt, settings: r.settings, environment: r.environment,
    received: r.received, committed: r.committed, bytes: r.bytes, state: r.finished ? r.stopReason : 'recording',
    storageError: r.storageError, mime: r.mime, trackSettings: r.trackSettings,
    outcome: r.outcome || 'unreviewed', indicator: r.indicator || 'unknown', beep: r.beep || 'unknown',
    diagnosticWriteError: r.diagnosticWriteError, notes: r.notes};
}
async function saveMetadata(r) {
  const db = await openDB(), tx = db.transaction('runs', 'readwrite'), completion = done(tx);
  tx.objectStore('runs').put(metadata(r)); await completion;
}
async function refreshInputs() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
    const previous = $('device').value;
    $('device').replaceChildren(new Option('Choose input', ''), ...devices.map(d => new Option(d.label || 'Unidentified input', d.deviceId)));
    $('device').value = previous;
  } catch (error) { status(`Input list: ${error.message}`); }
}
async function acquire(r) {
  const s = r.settings;
  const audio = {channelCount: {ideal: 1}, autoGainControl: {ideal: s.agc}, noiseSuppression: {ideal: s.noise}, echoCancellation: {ideal: s.echo}};
  let candidate;
  if (s.micMode === 'exact') {
    if (!s.device) throw Error('Choose an exact input first');
    audio.deviceId = {exact: s.device};
  } else if (s.micMode === 'imuse') {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const candidates = inputs.filter(d => d.deviceId && d.deviceId !== 'default' && headsetPattern.test(d.label || ''));
    const label = (inputs.find(d => d.deviceId === 'default')?.label || '').replace(/^default\s*[-–:]\s*/i, '').trim();
    candidate = candidates.find(d => label && d.label === label) || candidates[0];
    if (candidate) audio.deviceId = {exact: candidate.deviceId};
  }
  event(r, 'acquire-request', {constraints: audio});
  try { return await navigator.mediaDevices.getUserMedia({audio}); }
  catch (error) {
    if (!candidate) throw error;
    event(r, 'headset-fallback', {error: String(error)}); delete audio.deviceId;
    return navigator.mediaDevices.getUserMedia({audio});
  }
}
function sample(r) {
  if (r.ctx?.state !== 'running') return {rms: null, peak: null};
  r.analyser.getFloatTimeDomainData(r.samples);
  let sum = 0, peak = 0;
  for (const x of r.samples) { sum += x*x; peak = Math.max(peak, Math.abs(x)); }
  return {rms: Math.sqrt(sum / r.samples.length), peak};
}
function snapshot(r, phase) {
  event(r, 'snapshot', {phase, ...sample(r), received: r.received, committed: r.committed,
    pendingBytes: r.pendingBytes, lastChunkAgeMs: r.lastChunk == null ? null : performance.now() - r.lastChunk,
    processorCalls: r.processCalls, contextTime: r.ctx?.currentTime ?? null,
    enabled: r.track?.enabled, audioSession: safe(() => ({state: navigator.audioSession.state, type: navigator.audioSession.type}))});
}
async function graph(r) {
  const s = r.settings;
  if (!s.context) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  r.ctx = new Context();
  r.ctx.addEventListener('statechange', () => event(r, 'context-statechange'));
  r.source = r.ctx.createMediaStreamSource(r.stream);
  r.analyser = r.ctx.createAnalyser(); r.analyser.fftSize = 2048;
  r.samples = new Float32Array(2048); r.source.connect(r.analyser);
  if (s.graph) {
    r.processor = r.ctx.createScriptProcessor(2048, 1, 1);
    r.gain = r.ctx.createGain(); r.gain.gain.value = 0;
    r.source.connect(r.processor); r.processor.connect(r.gain); r.gain.connect(r.ctx.destination);
    if (s.ring) r.ring = new Float32Array(r.ctx.sampleRate * 3);
    r.processor.onaudioprocess = e => {
      r.processCalls++;
      if (r.ring) for (const x of e.inputBuffer.getChannelData(0)) { r.ring[r.ringPos] = x * 32767; r.ringPos = (r.ringPos + 1) % r.ring.length; }
    };
  }
  await r.ctx.resume();
}
function prepareOutput(r) {
  r.player = new Audio(); r.player.preload = 'auto'; r.player.setAttribute('playsinline', '');
  for (const type of ['playing', 'pause', 'waiting', 'ended', 'error']) r.player.addEventListener(type, () => event(r, `output-${type}`, {cue: r.cue}));
  r.soundCache = {};
  if (r.settings.separateWarning) {
    r.warningPlayer = new Audio(sounds.warning);
    r.warningPlayer.preload = 'auto'; r.warningPlayer.playsInline = true;
    for (const type of ['playing', 'pause', 'waiting', 'ended', 'error']) r.warningPlayer.addEventListener(type, () => event(r, `warning-${type}`));
  }
  if (r.settings.preload) for (const [name, path] of Object.entries(sounds)) {
    r.soundCache[name] = fetch(path).then(response => {
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return response.blob();
    }).then(blob => { const url = URL.createObjectURL(blob); urls.push(url); return url; })
      .catch(error => { event(r, 'preload-error', {name, error: String(error)}); return path; });
  }
}
function warn(r, trigger) {
  if (r.finished || r.finishing || r.warned) return;
  r.warned = true;
  if (!r.settings.separateWarning) { void play(r, 'warning'); return; }
  try {
    r.warningPlayer.currentTime = 0;
    const attempt = r.warningPlayer.play();
    event(r, 'warning-play-request', {trigger});
    Promise.resolve(attempt).then(() => event(r, 'warning-play-accepted', {trigger}))
      .catch(error => event(r, 'warning-play-rejected', {trigger, error:String(error)}));
  } catch (error) { event(r, 'warning-play-rejected', {trigger, error:String(error)}); }
}
async function requestWakeLock(r) {
  if (!r.settings.wakeLock || r.finished || r.finishing || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock) { event(r, 'wake-lock-unavailable'); return; }
  if (r.wakeRequest || (r.wakeSentinel && !r.wakeSentinel.released)) return;
  r.wakeRequest = true;
  event(r, 'wake-lock-request');
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (r.finished || r.finishing) { await sentinel.release(); return; }
    r.wakeSentinel = sentinel;
    event(r, 'wake-lock-acquired');
    sentinel.addEventListener('release', () => {
      if (r.wakeSentinel === sentinel) r.wakeSentinel = null;
      event(r, 'wake-lock-released');
      // Production only updates UI here; it does not stop audio or release the mic.
    }, {once:true});
  } catch (error) { event(r, 'wake-lock-error', {error:String(error)}); }
  finally { r.wakeRequest = false; }
}
function createRecorder(r) {
  const mime = ['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'].find(m => MediaRecorder.isTypeSupported(m));
  r.recorder = mime ? new MediaRecorder(r.stream, {mimeType:mime}) : new MediaRecorder(r.stream);
  r.mime = r.recorder.mimeType || mime || '';
  event(r, 'recorder-constructed');
}
async function play(r, name) {
  try {
    const path = await (r.soundCache[name] || sounds[name]);
    if (r.finished) return;
    r.player.pause(); r.cue = name; r.player.src = path;
    event(r, 'output-play-request', {cue: name});
    await r.player.play(); event(r, 'output-play-accepted', {cue: name});
  } catch (error) { event(r, 'output-play-rejected', {cue: name, error: String(error)}); }
}
function receive(r, e) {
  if (!e.data?.size) { event(r, 'empty-chunk'); return; }
  const sequence = r.received++;
  r.bytes += e.data.size; r.lastChunk = performance.now();
  r.pending.set(sequence, e.data); r.pendingBytes += e.data.size;
  event(r, 'chunk-received', {sequence, bytes: e.data.size, pendingBytes: r.pendingBytes});
  if (r.awaitingForegroundChunk) { r.awaitingForegroundChunk = false; event(r, 'first-chunk-after-foreground', {sequence, bytes:e.data.size}); }
  if (!r.settings.storage) { r.parts.push(e.data); r.pending.delete(sequence); r.pendingBytes -= e.data.size; return; }
  r.queue = r.queue.then(async () => {
    if (r.storageError) return; // Keep uncommitted audio for emergency export.
    const db = await openDB(), tx = db.transaction(['runs', 'chunks'], 'readwrite'), completion = done(tx);
    tx.objectStore('chunks').put({id: r.id, sequence, blob: e.data});
    const updated = r.settings.bookkeeping ? {...(r.persistedMetadata || metadata(r)), committed: sequence + 1,
      bytesStored: (r.persistedMetadata?.bytesStored || 0) + e.data.size, lastPersistedAt:new Date().toISOString()} : {...metadata(r), committed: r.committed + 1};
    tx.objectStore('runs').put(updated);
    await completion;
    r.persistedMetadata = updated;
    r.committed++; r.pending.delete(sequence); r.pendingBytes -= e.data.size;
    event(r, 'chunk-committed', {sequence, committed: r.committed});
  }).catch(error => {
    r.storageError = String(error); event(r, 'storage-error', {error: r.storageError});
    status('Lab storage failed. Stopping; retain this page for emergency export.');
    stopRecorder(r, 'storage-error');
  });
  if (r.pendingBytes > PENDING_LIMIT) { event(r, 'storage-backpressure'); stopRecorder(r, 'storage-backpressure'); }
}
function stopRecorder(r, reason) {
  r.stopReason ||= reason;
  if (r.recorder?.state !== 'inactive') r.recorder.stop();
}
function cleanup(r) {
  clearInterval(r.pollTimer);
  r.player?.pause();
  r.warningPlayer?.pause();
  if (r.wakeSentinel && !r.wakeSentinel.released) void r.wakeSentinel.release().catch(error => event(r, 'wake-lock-release-error', {error:String(error)}));
  for (const node of [r.processor, r.gain, r.source]) safe(() => node.disconnect());
  if (r.processor) r.processor.onaudioprocess = null;
  r.stream?.getTracks().forEach(t => t.stop());
  if (r.ctx && r.ctx.state !== 'closed') void r.ctx.close().catch(error => event(r, 'context-close-error', {error: String(error)}));
}
async function readChunks(id) {
  const db = await openDB(), tx = db.transaction('chunks', 'readonly'), completion = done(tx);
  const req = tx.objectStore('chunks').index('runId').getAll(IDBKeyRange.only(id));
  const chunks = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  await completion; return chunks.sort((a,b) => a.sequence - b.sequence);
}
function audioDownload(blob, id, target = $('downloads')) {
  const url = URL.createObjectURL(blob); urls.push(url);
  const wrapper = document.createElement('div'), title = document.createElement('p'), audio = document.createElement('audio'), link = document.createElement('a');
  title.textContent = `${id}: ${blob.size} bytes`; audio.controls = true; audio.src = url;
  link.href = url; link.download = `lab-${id}.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`; link.textContent = 'Download audio';
  wrapper.append(title, audio, link); target.append(wrapper);
}
async function finish(r) {
  if (r.finishing || r.finished) return;
  r.finishing = true; r.stopReason ||= 'unexpected-stop'; event(r, 'finalizing', {reason: r.stopReason});
  cleanup(r);
  await r.queue;
  try {
    let parts = r.parts;
    if (r.settings.storage) {
      const committed = await readChunks(r.id);
      const chunks = new Map(committed.map(c => [c.sequence, c.blob]));
      for (const [sequence, blob] of r.pending) chunks.set(sequence, blob);
      parts = [...chunks].sort((a,b) => a[0]-b[0]).map(([,blob]) => blob);
    }
    audioDownload(new Blob(parts, {type: r.mime}), r.id);
  } catch (error) {
    r.assemblyError = String(error);
    event(r, 'assembly-error', {error: String(error)});
    if (r.pending.size) audioDownload(new Blob([...r.pending].sort((a,b)=>a[0]-b[0]).map(([,b])=>b), {type:r.mime}), `${r.id}-uncommitted-tail`);
    status('Assembly failed. Committed audio remains in lab storage; export JSON.');
  }
  r.finished = true; r.finishing = false;
  if (r.settings.storage) await saveMetadata(r).catch(error => event(r, 'metadata-error', {error:String(error)}));
  event(r, 'run-finished', {reason:r.stopReason});
  status(r.assemblyError ? 'Audio assembly failed. Committed chunks remain in lab storage; export JSON and retry from saved lab runs.' : `Stopped: ${r.stopReason}. Listen to the recording and select a playback result.`); buttons(); render();
}
async function start() {
  busy = true; buttons();
  const s = settings();
  const r = {id: crypto.randomUUID?.() || String(Date.now()), settings:s, started:performance.now(), createdAt:new Date().toISOString(),
    environment:{userAgent:navigator.userAgent, standalone:matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, secureContext:isSecureContext},
    events:[], notes:[], droppedEvents:0, received:0, committed:0, bytes:0, pendingBytes:0, pending:new Map(), parts:[], queue:Promise.resolve(), processCalls:0, ringPos:0};
  run = r; $('outcome').value = 'unreviewed'; $('indicator').value = 'unknown'; $('beep').value = 'unknown'; event(r, 'run-created');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('Recording requires a supported browser and HTTPS or localhost');
    if ((s.graph || s.poll || s.silence !== 'none') && !s.context) throw Error('Enable AudioContext for graph or silence experiments');
    if (s.ring && !s.graph) throw Error('Enable ScriptProcessor for rolling buffer');
    if (s.bookkeeping && !s.storage) throw Error('Enable storage for production-style bookkeeping');
    if (s.bookkeeping) r.db = await openDB();
    if (s.storage && !s.ordering) await saveMetadata(r);
    prepareOutput(r);
    r.stream = await acquire(r); r.track = r.stream.getAudioTracks()[0];
    if (!r.track) throw Error('No audio track acquired');
    r.trackSettings = safe(() => r.track.getSettings());
    event(r, 'acquired', {label:r.track.label, settings:r.trackSettings, constraints:safe(()=>r.track.getConstraints())});
    for (const type of ['mute','unmute','ended']) r.track.addEventListener(type, () => {
      event(r, `track-${type}`);
      if (type === 'mute' && (s.warning === 'mute' || (s.separateWarning && s.warning === 'hidden'))) warn(r, 'microphone-muted');
      if (type === 'unmute') r.warned = false;
    });
    if (!s.ordering) await graph(r);
    createRecorder(r);
    if (s.storage && s.ordering) await saveMetadata(r);
    r.persistedMetadata = metadata(r);
    if (s.separateWarning) r.warningPlayer.load();
    event(r, 'session-created');
    for (const type of ['start','pause','resume','error']) r.recorder.addEventListener(type, async e => {
      event(r, `recorder-${type}`, {error:e.error ? String(e.error) : null});
      if (s.bookkeeping && (type === 'pause' || type === 'resume')) {
        r.persistedMetadata = {...r.persistedMetadata, state:type === 'pause' ? 'paused' : 'recording', lastUpdatedAt:new Date().toISOString()};
        try {
          const tx = r.db.transaction('runs','readwrite'), completion = done(tx);
          tx.objectStore('runs').put(r.persistedMetadata); await completion;
        } catch (error) { event(r, 'session-update-error', {error:String(error)}); }
      }
      if (r.finished || r.finishing) return;
      if (s.silence === 'imuse' && (type === 'pause' || type === 'resume')) void play(r, type === 'pause' ? 'pause' : 'recording');
    });
    r.recorder.addEventListener('dataavailable', e => receive(r, e));
    r.recorder.addEventListener('stop', () => { event(r,'recorder-stop'); void finish(r); });
    if (s.ordering) await graph(r);
    r.recorder.start(Number(s.timeslice));
    if (s.poll || s.silence !== 'none') r.pollTimer = setInterval(() => {
      const rms = sample(r).rms;
      if (rms == null || r.track.muted || r.track.readyState !== 'live') { r.quietSince = null; return; }
      if (rms >= Number(s.threshold)) {
        r.quietSince = null;
        if (s.silence === 'lab' && r.recorder.state === 'paused') r.recorder.resume();
      } else if (r.recorder.state === 'recording' && s.silence !== 'none') {
        r.quietSince ??= performance.now();
        if (performance.now() - r.quietSince >= 5000) { event(r,'silence-pause'); r.recorder.pause(); r.quietSince = null; }
      }
    }, 100);
    status('Recording. Say “before”, then perform your test action.');
    void requestWakeLock(r);
    if (s.speech) void play(r, 'newRecording');
  } catch (error) {
    event(r, 'start-error', {error:String(error)}); cleanup(r); r.finished = true; r.stopReason = 'start-error';
    if (s.storage) await saveMetadata(r).catch(saveError => event(r, 'metadata-error', {error:String(saveError)}));
    status(`Start failed: ${error.message}`);
  } finally { busy = false; buttons(); render(); }
}
async function resumeContext(r, trigger) {
  if (!r?.ctx || r.finished || r.ctx.state === 'closed') return;
  event(r, 'context-resume-request', {trigger});
  try { await r.ctx.resume(); event(r, 'context-resume-resolved', {trigger}); }
  catch (error) { event(r,'context-resume-error',{trigger,error:String(error)}); }
}
function visibility() {
  const r = run; if (!r || r.finished) return;
  event(r, 'visibility-change');
  if (document.visibilityState === 'hidden') {
    if (r.settings.warning === 'hidden') warn(r, 'visibility-hidden');
    return;
  }
  r.awaitingForegroundChunk = true;
  if (r.settings.request && r.recorder?.state === 'recording') {
    event(r,'request-data'); try { r.recorder.requestData(); } catch(error) { event(r,'request-data-error',{error:String(error)}); }
  }
  const state = r.ctx?.state, mode = r.settings.recovery;
  if ((mode === 'all' && ['suspended','interrupted'].includes(state)) || (mode === 'suspended' && state === 'suspended')) void resumeContext(r,'foreground');
  void requestWakeLock(r);
  if (r.settings.probes) for (const ms of [0,1000,3000,6000]) setTimeout(() => {
    if (run === r && !r.finished && document.visibilityState === 'visible') snapshot(r,`foreground-${ms}`);
  }, ms);
}
function render() {
  const r = run; if (!r || document.visibilityState !== 'visible') return;
  $('metrics').textContent = `Recorder ${r.recorder?.state || 'not started'} · Context ${r.ctx?.state || 'none'} · Received ${r.received} · Committed ${r.committed} · Pending ${r.pendingBytes} bytes · Last chunk ${r.lastChunk == null ? 'none' : ((performance.now()-r.lastChunk)/1000).toFixed(1)+'s ago'} · Processor ${r.processCalls}`;
  $('log').textContent = r.events.slice(-50).map(e=>JSON.stringify(e)).join('\n');
}
$('preset').onchange = applyPreset; $('refresh').onclick = refreshInputs; $('start').onclick = start;
$('stop').onclick = async () => {
  const r=run; if (!r || r.finished || busy) return;
  busy=true; buttons();
  try {
    if (r.recorder.state === 'inactive') await finish(r);
    else {
      const stopped = new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{ r.recorder.removeEventListener('stop',onStop); reject(Error('Stop timed out; original run retained. Retry or export JSON.')); },8000);
        function onStop(){clearTimeout(timeout);resolve();}
        r.recorder.addEventListener('stop',onStop,{once:true});
      });
      stopRecorder(r,'user-stop'); await stopped;
    }
  } catch(error){event(r,'stop-error',{error:String(error)});status(error.message);}
  finally {busy=false;buttons();}
};
$('resume').onclick=()=>{if(run?.recorder?.state==='paused'){event(run,'manual-recorder-resume');run.recorder.resume();}};
$('contextResume').onclick=()=>void resumeContext(run,'manual');
$('probe').onclick=()=>{if(run){snapshot(run,'manual');render();}};
$('addNote').onclick=()=>{if(run && $('note').value.trim()){const note={at:new Date().toISOString(),text:$('note').value.trim()};run.notes.push(note);event(run,'user-observation',note);$('note').value='';render();}};
$('outcome').onchange=()=>{if(run){run.outcome=$('outcome').value;event(run,'outcome',{value:run.outcome});if(run.settings.storage && run.finished)void saveMetadata(run).catch(error=>status(error.message));}};
for (const id of ['indicator', 'beep']) $(id).onchange = () => {
  if (!run) return;
  run[id] = $(id).value; event(run, 'user-observation', {field:id, value:run[id]});
  if (run.settings.storage && run.finished) void saveMetadata(run).catch(error => status(error.message));
};
$('export').onclick=()=>{
  if(!run){status('Start a run before exporting.');return;}
  const blob=new Blob([JSON.stringify({...metadata(run),events:run.events,droppedEvents:run.droppedEvents},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`lab-${run.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('saved').onclick=async()=>{
  try{
    const db=await openDB(),tx=db.transaction('runs','readonly'),completion=done(tx),req=tx.objectStore('runs').getAll();
    const items=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});await completion;
    $('savedRuns').replaceChildren();
    for(const item of items){const row=document.createElement('div'),button=document.createElement('button');button.textContent=`Load ${item.createdAt} (${item.state}, ${item.committed} chunks)`;
      button.onclick=async()=>{button.disabled=true;try{const chunks=await readChunks(item.id);audioDownload(new Blob(chunks.map(c=>c.blob),{type:item.mime || chunks[0]?.blob.type || ''}),item.id,$('savedRuns'));}catch(error){status(error.message);}finally{button.disabled=false;}};
      row.append(button);$('savedRuns').append(row);}
    if(!items.length)$('savedRuns').textContent='No persisted lab runs.';
  }catch(error){status(`Lab storage: ${error.message}`);}
};
document.addEventListener('visibilitychange',visibility);
for(const type of ['pagehide','pageshow'])window.addEventListener(type,()=>{if(run && !run.finished)event(run,type);});
navigator.mediaDevices?.addEventListener('devicechange',()=>{if(run && !run.finished)event(run,'devicechange');});
if(navigator.audioSession?.addEventListener)navigator.audioSession.addEventListener('statechange',()=>{if(run && !run.finished)event(run,'audio-session-statechange',{state:navigator.audioSession.state,type:navigator.audioSession.type});});
setInterval(render,1000);applyPreset();buttons();
