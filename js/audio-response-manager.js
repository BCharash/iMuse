// Dedicated, serialized spoken-response playback. No microphone access.
const FILES = Object.freeze({
    pause: "audio/pause.wav",
    yes: "audio/yes.wav",
    recording: "audio/recording.wav",
    newRecording: "audio/new-recording.wav",
    stopped: "audio/recording-stopped.wav"
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

async function playOne(name) {
    if (!FILES[name]) return {ok:false,error:`Unknown spoken response: ${name}`};
    prepareSpokenResponses();
    const player = getOutput();
    const source = await cache.get(name);
    return new Promise(resolve => {
        let done = false;
        const finish = (ok, error) => {
            if (done) return;
            done = true;
            clearTimeout(watchdog);
            player.removeEventListener("ended", onEnded);
            player.removeEventListener("error", onError);
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
            Promise.resolve(player.play()).catch(error => finish(false, error?.message || String(error)));
        } catch (error) {
            finish(false, error?.message || String(error));
        }
    });
}

export function playSpokenResponse(name) {
    const next = queue.catch(() => {}).then(() => playOne(name));
    queue = next;
    return next;
}
