// Dedicated, serialized spoken-response playback. No microphone access.
const FILES = Object.freeze({
    pause: "audio/pause.wav",
    yes: "audio/yes.wav",
    recording: "audio/recording.wav",
    newRecording: "audio/new-recording.wav",
    stopped: "audio/recording-stopped.wav",
    confirmStop: "audio/confirm-stop-recording.wav"
});
const cache = new Map();
let output = null;
let volumeContext = null, volumeGain = null;
const decodedBuffers = new Map();
let queue = Promise.resolve();

function getOutput() {
    if (!output) {
        output = new Audio();
        output.preload = "auto";
        output.setAttribute("playsinline", "");
    }
    return output;
}

function getVolumeContext() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!volumeContext && AudioContextClass) volumeContext = new AudioContextClass({latencyHint:"interactive"});
    return volumeContext;
}

// Call within a user interaction, before asynchronous microphone/model work.
export function primeSpokenResponses() {
    try {
        prepareSpokenResponses();
        const context = getVolumeContext();
        if (context && context.state !== "running") {
            void context.resume().catch(error => console.warn("Prompt output not ready:", error));
        }
    } catch (error) {
        // Output preparation must never prevent the Record action itself.
        console.warn("Prompt output not ready:", error);
    }
}

async function playBufferedPrompt(name, buffer, {volume = 1, signal} = {}) {
    const context = getVolumeContext();
    let resumeTimer;
    try {
        if (context.state !== "running") await Promise.race([
            context.resume(),
            new Promise((_, reject) => { resumeTimer = setTimeout(() => reject(new Error("Prompt output resume timed out")), 2000); })
        ]);
    } catch (error) { return {ok:false,error:error?.message || String(error)}; }
    finally { clearTimeout(resumeTimer); }
    if (signal?.aborted) return {ok:false,error:"Prompt cancelled"};
    return new Promise(resolve => {
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
        source.connect(gain); gain.connect(context.destination);
        let done = false;
        const finish = (ok, error) => {
            if (done) return;
            done = true;
            clearTimeout(watchdog);
            signal?.removeEventListener("abort", onAbort);
            source.onended = null;
            if (!ok) { try { source.stop(); } catch (_) { /* already stopped */ } }
            source.disconnect(); gain.disconnect();
            resolve({ok,error});
        };
        const onAbort = () => finish(false, "Prompt cancelled");
        source.onended = () => finish(true, null);
        const watchdog = setTimeout(() => finish(false, `Playback timed out: ${name}`), 6000);
        signal?.addEventListener("abort", onAbort, {once:true});
        // Always start at the beginning; no media-element seek/reload or live
        // resampling startup is needed for the spoken prompt.
        try { source.start(0, 0); }
        catch (error) { finish(false, error?.message || String(error)); }
    });
}

async function applyPromptVolume(player, volume) {
    const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    // iPhone may ignore HTMLMediaElement.volume. A gain node supplies app volume
    // without requesting an output route or changing microphone ownership.
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!volumeGain && level < 1 && AudioContextClass) {
        volumeContext = getVolumeContext();
        const source = volumeContext.createMediaElementSource(player);
        volumeGain = volumeContext.createGain();
        source.connect(volumeGain);
        volumeGain.connect(volumeContext.destination);
    }
    if (volumeGain) {
        volumeGain.gain.value = level;
        player.volume = 1;
        if (volumeContext.state !== "running") await volumeContext.resume();
    } else player.volume = level;
}

export function prepareSpokenResponses() {
    for (const [name, url] of Object.entries(FILES)) {
        if (!cache.has(name)) {
            // Fetching does not claim a microphone or start playback.
            cache.set(name, fetch(url).then(response => {
                if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
                return response.blob();
            }).then(blob => {
                const context = getVolumeContext();
                if (context?.decodeAudioData && blob.arrayBuffer) {
                    decodedBuffers.set(name, blob.arrayBuffer().then(bytes => context.decodeAudioData(bytes))
                        .catch(error => { console.warn(`Could not decode ${name} prompt:`, error); return null; }));
                }
                return URL.createObjectURL(blob);
            }).catch(error => {
                console.warn(`Could not preload ${name}:`, error);
                return url; // The browser can still try the original URL.
            }));
        }
    }
}

async function playOne(name, {volume = 1, signal} = {}) {
    if (signal?.aborted) return {ok:false,error:"Prompt cancelled"};
    if (!FILES[name]) return {ok:false,error:`Unknown spoken response: ${name}`};
    prepareSpokenResponses();
    const source = await Promise.race([
        cache.get(name),
        new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), 6000);
            cache.get(name).finally(() => clearTimeout(timer));
        })
    ]);
    if (!source || signal?.aborted) return {ok:false,error:"Prompt unavailable or cancelled"};
    if (decodedBuffers.has(name)) {
        let decodeTimer;
        let buffer;
        try {
            buffer = await Promise.race([
                decodedBuffers.get(name),
                new Promise(resolve => { decodeTimer = setTimeout(() => resolve(null), 2000); })
            ]);
        } finally { clearTimeout(decodeTimer); }
        if (signal?.aborted) return {ok:false,error:"Prompt cancelled"};
        if (buffer) return playBufferedPrompt(name, buffer, {volume, signal});
    }
    const player = getOutput();
    let volumeTimer;
    try {
        await Promise.race([
            applyPromptVolume(player, volume),
            new Promise((_, reject) => { volumeTimer = setTimeout(() => reject(new Error("Prompt volume setup timed out")), 2000); })
        ]);
    } catch (error) { return {ok:false,error:error?.message || String(error)}; }
    finally { clearTimeout(volumeTimer); }
    if (signal?.aborted) return {ok:false,error:"Prompt cancelled"};
    return new Promise(resolve => {
        let done = false;
        const finish = (ok, error) => {
            if (done) return;
            done = true;
            clearTimeout(watchdog);
            player.removeEventListener("ended", onEnded);
            player.removeEventListener("error", onError);
            signal?.removeEventListener("abort", onAbort);
            if (!ok) player.pause();
            resolve({ok,error});
        };
        const onAbort = () => finish(false, "Prompt cancelled");
        const onEnded = () => finish(true, null);
        const onError = () => finish(false, player.error?.message || `Playback error: ${name}`);
        player.pause();
        if (player.src !== source) player.src = source;
        player.currentTime = 0;
        player.addEventListener("ended", onEnded);
        player.addEventListener("error", onError);
        // Prevent an unresolvable playback promise from blocking command entry.
        const watchdog = setTimeout(() => finish(false, `Playback timed out: ${name}`), 6000);
        signal?.addEventListener("abort", onAbort, {once:true});
        try {
            Promise.resolve(player.play()).catch(error => finish(false, error?.message || String(error)));
        } catch (error) {
            finish(false, error?.message || String(error));
        }
    });
}

export function playSpokenResponse(name, options) {
    const next = queue.catch(() => {}).then(() => playOne(name, options));
    queue = next;
    return next;
}
