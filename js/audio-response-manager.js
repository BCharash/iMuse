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
let queue = Promise.resolve();

function getOutput() {
    if (!output) {
        output = new Audio();
        output.preload = "auto";
        output.setAttribute("playsinline", "");
    }
    return output;
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

async function playOne(name, observe) {
    if (!FILES[name]) return {ok:false,error:`Unknown spoken response: ${name}`};
    prepareSpokenResponses();
    const player = getOutput();
    const source = await cache.get(name);
    // Temporary observation only: no audio-session, output-device or volume writes.
    const seen = new Set();
    function trace(event, extra = {}) {
        try {
            if (seen.has(event) && event !== 'finish') return;
            seen.add(event);
            let sessionType = 'unsupported', sessionState = 'unsupported';
            try { sessionType = navigator.audioSession?.type ?? 'unsupported'; sessionState = navigator.audioSession?.state ?? 'unsupported'; } catch (_) {}
            observe({ event, source: FILES[name], currentSource: player.currentSrc || player.src,
                volume: player.volume, muted: player.muted, paused: player.paused,
                currentTime: player.currentTime, duration: Number.isFinite(player.duration) ? player.duration : null,
                readyState: player.readyState, networkState: player.networkState, playbackRate: player.playbackRate,
                errorCode: player.error?.code ?? null, sessionType, sessionState, ...extra });
        } catch (_) { /* Diagnostic observers cannot interrupt playback. */ }
    }
    return new Promise(resolve => {
        let done = false;
        const watched = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'waiting', 'stalled', 'volumechange', 'ratechange'];
        const listeners = watched.map(type => [type, () => trace(type)]);
        const finish = (ok, error, reason) => {
            if (done) return;
            done = true;
            clearTimeout(watchdog);
            player.removeEventListener("ended", onEnded);
            player.removeEventListener("error", onError);
            for (const [type, listener] of listeners) player.removeEventListener(type, listener);
            trace('finish', { ok, reason, error });
            resolve({ok,error});
        };
        const onEnded = () => finish(true, null, "ended");
        const onError = () => finish(false, player.error?.message || `Playback error: ${name}`, "media-error");
        player.pause();
        player.src = source;
        player.currentTime = 0;
        player.addEventListener("ended", onEnded);
        player.addEventListener("error", onError);
        for (const [type, listener] of listeners) player.addEventListener(type, listener);
        trace('play-request');
        // Prevent an unresolvable playback promise from blocking command entry.
        const watchdog = setTimeout(() => finish(false, `Playback timed out: ${name}`, "timeout"), 6000);
        try {
            Promise.resolve(player.play()).then(() => trace('play-resolved'), error => finish(false, error?.message || String(error), 'play-rejected'));
        } catch (error) {
            finish(false, error?.message || String(error), 'play-threw');
        }
    });
}

export function playSpokenResponse(name, observe = () => {}) {
    const next = queue.catch(() => {}).then(() => playOne(name, observe));
    queue = next;
    return next;
}
