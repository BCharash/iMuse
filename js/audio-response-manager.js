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

// Temporary iPhone stopped-prompt experiment; never selects a physical output.
let stoppedPlaybackRelease = null;
export function releaseStoppedPlaybackSession() {
    stoppedPlaybackRelease?.();
}
function requestStoppedPlaybackSession(name, canUsePlaybackSession) {
    if (name !== 'stopped') return () => {};
    try {
        if (!/iPhone/.test(navigator.userAgent || '') || !canUsePlaybackSession()) return () => {};
        const session = navigator.audioSession;
        if (!session || session.type === 'playback') return () => {};
        const previous = session.type;
        const release = () => {
            if (stoppedPlaybackRelease !== release) return;
            stoppedPlaybackRelease = null;
            try { if (session.type === 'playback') session.type = previous; } catch (_) {}
        };
        stoppedPlaybackRelease = release;
        try { session.type = 'playback'; }
        catch (_) { release(); }
        return release;
    } catch (_) { return () => {}; }
}

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

async function playOne(name, canUsePlaybackSession) {
    if (!FILES[name]) return {ok:false,error:`Unknown spoken response: ${name}`};
    prepareSpokenResponses();
    const player = getOutput();
    const source = await cache.get(name);
    return new Promise(resolve => {
        let done = false;
        let releasePlayback = () => {};
        const finish = (ok, error) => {
            if (done) return;
            done = true;
            clearTimeout(watchdog);
            player.removeEventListener("ended", onEnded);
            player.removeEventListener("error", onError);
            releasePlayback();
            resolve({ok,error});
        };
        const onEnded = () => finish(true, null);
        const onError = () => finish(false, player.error?.message || `Playback error: ${name}`);
        player.pause();
        player.src = source;
        player.currentTime = 0;
        player.addEventListener("ended", onEnded);
        player.addEventListener("error", onError);
        // Prevent an unresolvable playback promise from blocking command entry.
        const watchdog = setTimeout(() => finish(false, `Playback timed out: ${name}`), 6000);
        try {
            releasePlayback = requestStoppedPlaybackSession(name, canUsePlaybackSession);
            Promise.resolve(player.play()).catch(error => finish(false, error?.message || String(error)));
        } catch (error) {
            finish(false, error?.message || String(error));
        }
    });
}

export function playSpokenResponse(name, { canUsePlaybackSession = () => false } = {}) {
    const next = queue.catch(() => {}).then(() => playOne(name, canUsePlaybackSession));
    queue = next;
    return next;
}
