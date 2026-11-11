// Isolated investigation. No production recorder/settings/store imports or durable audio.
import { playSpokenResponse, prepareSpokenResponses } from './audio-response-manager.js';
const $ = id => document.getElementById(id);
const events = [];
let stream = null, context = null, processor = null, recorder = null, phase = 'idle', generation = 0, lastMessage = null;
function audioSession() {
    try { return navigator.audioSession || null; } catch (_) { return null; }
}
function log(type, data = {}) {
    const session = audioSession();
    events.push({ at: new Date().toISOString(), type, ...data, sessionType: session?.type ?? 'unsupported', sessionState: session?.state ?? 'unsupported' });
    $('events').textContent = JSON.stringify(events, null, 2);
}
function controls() {
    const idle = phase === 'idle';
    for (const id of ['play', 'start', 'analysis', 'echo', 'noise', 'agc']) $(id).disabled = !idle;
    $('playback').disabled = !idle || !audioSession();
    $('stop').disabled = idle || phase === 'stopping';
}
async function release() {
    const closingContext = context;
    context = null;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (_) {} processor = null; }
    if (stream) { const tracks = stream.getTracks(); tracks.forEach(track => track.stop()); log('tracks-stopped', { states: tracks.map(track => track.readyState) }); stream = null; }
    if (closingContext && closingContext.state !== 'closed') {
        await closingContext.close(); log('context-closed');
    }
}
async function message(mode = 'ordinary') {
    if (phase !== 'idle') return;
    phase = 'playing'; controls();
    const session = audioSession(), previous = session?.type;
    const event = { mode, observation: 'unreviewed' };
    try {
        if (mode === 'playback') {
            if (!session) throw Error('Audio Session API is unavailable');
            session.type = 'playback'; log('temporary-playback-requested', { previous, acceptedType: session.type });
        }
        log('message-start', event);
        const result = await playSpokenResponse('stopped');
        log('message-end', { ...event, ok: result.ok, error: result.error });
        lastMessage = events[events.length - 1]; $('observation').value = 'unreviewed';
        $('status').textContent = result.ok ? 'Message finished. Select what you heard.' : 'Playback failed: ' + result.error;
    } catch (error) { log('message-error', { message: error.message }); $('status').textContent = error.message; }
    finally {
        if (mode === 'playback' && session) {
            try { session.type = previous; log('session-type-restored', { restored: session.type }); }
            catch (error) { log('session-restore-error', { message: error.message }); }
        }
        phase = 'idle'; controls();
    }
}
async function start() {
    if (phase !== 'idle') return;
    const run = ++generation;
    phase = 'opening'; controls(); $('status').textContent = 'Opening microphone…';
    try {
        const request = { channelCount: { ideal: 1 }, echoCancellation: { ideal: $('echo').checked }, noiseSuppression: { ideal: $('noise').checked }, autoGainControl: { ideal: $('agc').checked } };
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: request });
        if (run !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired; log('microphone-opened', { request, settings: stream.getAudioTracks()[0].getSettings(), analysis: $('analysis').checked });
        recorder = new MediaRecorder(stream);
        let bytes = 0, chunks = 0;
        recorder.ondataavailable = event => { bytes += event.data.size; chunks++; }; // Discard chunk content.
        recorder.addEventListener('stop', () => log('encoder-stopped', { bytes, chunks }), { once: true });
        if ($('analysis').checked) {
            context = new AudioContext();
            const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(), silent = context.createGain();
            analyser.fftSize = 2048; source.connect(analyser);
            processor = context.createScriptProcessor(2048, 1, 1); processor.onaudioprocess = () => {};
            silent.gain.value = 0; source.connect(processor); processor.connect(silent); silent.connect(context.destination);
            await context.resume();
            if (run !== generation) return;
            log('analysis-running', { sampleRate: context.sampleRate });
        }
        recorder.start(250); phase = 'capturing'; controls(); $('status').textContent = 'Capturing. Speak briefly, then Stop.';
    } catch (error) {
        if (run !== generation) return;
        try { await release(); } catch (_) {}
        phase = 'idle'; controls(); log('capture-error', { message: error.message }); $('status').textContent = error.message;
    }
}
async function stop() {
    if (!['opening', 'capturing'].includes(phase)) return;
    const run = ++generation;
    phase = 'stopping'; controls();
    try {
        if (recorder && recorder.state !== 'inactive') {
            const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
            recorder.stop(); await stopped;
        }
        recorder = null; await release();
        if (run !== generation) return;
        phase = 'idle'; controls(); log('capture-released');
        await message();
    } catch (error) { phase = 'idle'; controls(); $('status').textContent = 'Cleanup failed: ' + error.message; log('cleanup-error', { message: error.message }); }
}
$('start').onclick = start; $('stop').onclick = stop;
$('play').onclick = () => message(); $('playback').onclick = () => message('playback');
$('observation').onchange = () => { if (lastMessage) { lastMessage.observation = $('observation').value; $('events').textContent = JSON.stringify(events, null, 2); } };
$('export').onclick = () => {
    const blob = new Blob([JSON.stringify({ checkBuild: 'output-check-2026-11-11.1', userAgent: navigator.userAgent, notes: $('notes').value, events }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `iMuse-output-check-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
window.addEventListener('pagehide', () => {
    generation++; if (recorder?.state !== 'inactive') { try { recorder?.stop(); } catch (_) {} }
    void release().catch(() => {});
});
prepareSpokenResponses(); controls(); log('ready');
