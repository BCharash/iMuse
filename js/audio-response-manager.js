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
let queue = Promise.resolve();

function getOutput() {
    if (!output) {
        output = new Audio();
        output.preload = "auto";
        output.setAttribute("playsinline", "");
    }
    return output;
}

async function applyPromptVolume(player, volume) {
    const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    // iPhone may ignore HTMLMediaElement.volume. A gain node supplies app volume
    // without requesting an output route or changing microphone ownership.
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!volumeGain && level < 1 && AudioContextClass) {
        volumeContext = new AudioContextClass();
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
            }).then(blob => URL.createObjectURL(blob)).catch(error => {
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
    const player = getOutput();
    const source = await Promise.race([
        cache.get(name),
        new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), 6000);
            cache.get(name).finally(() => clearTimeout(timer));
        })
    ]);
    if (!source || signal?.aborted) return {ok:false,error:"Prompt unavailable or cancelled"};
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
        player.src = source;
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
