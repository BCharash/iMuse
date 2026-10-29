import { loadVoicuteWakeWord } from "./wake-word.js";

const recordButton = document.getElementById("recordButton");
const pauseButton = document.getElementById("pauseButton");
const audioPlayer = document.getElementById("audioPlayer");
const recordingControls = document.getElementById("recordingControls");
const deleteButton = document.getElementById("deleteButton");
const status = document.getElementById("status");
const wakeStatus = document.getElementById("wakeStatus");
const lifecycleStatus = document.getElementById("lifecycleStatus");

// Assess the device class once during startup. Keep this vocabulary aligned with
// Memora: every device is classified as either "mobile" or "desktop".
function assessDeviceClass() {
    const mobileHint = navigator.userAgentData?.mobile;
    if (typeof mobileHint === "boolean") return mobileHint ? "mobile" : "desktop";

    const userAgent = navigator.userAgent || "";
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
    // iPadOS can request a desktop-style user agent, so also check touch support.
    const ipadOSDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
    return mobileUserAgent || ipadOSDesktopMode ? "mobile" : "desktop";
}

const deviceClass = assessDeviceClass();
window.deviceClass = deviceClass;

const WAKE_THRESHOLD = 0.9;
const WAKE_DETECT_COOLDOWN_MS = 1500;
let wakeWord = null;
let wakeWordPhrase = "Hey Friday";
let wakeWordLoadError = null;
let screenWakeLock = null;

const DB_NAME = "imuse-recording-breadboard";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const CHUNK_STORE = "chunks";

let db = null;
let activeSession = null;
let recordingUrl = null;
let displayedSessionId = null;
let startRequest = 0;
let recoveryPanel = null;
let microphoneInitializationInProgress = false;
let microphoneInitializationComplete = false;

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(SESSION_STORE)) {
                database.createObjectStore(SESSION_STORE, { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains(CHUNK_STORE)) {
                const chunks = database.createObjectStore(CHUNK_STORE, {
                    keyPath: ["sessionId", "sequence"]
                });
                chunks.createIndex("sessionId", "sessionId", { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
        request.onblocked = () => reject(new Error("The recording database is blocked by another open page."));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    });
}

async function getAllSessions() {
    const transaction = db.transaction(SESSION_STORE, "readonly");
    const result = await new Promise((resolve, reject) => {
        const request = transaction.objectStore(SESSION_STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return result;
}

async function getSession(id) {
    const transaction = db.transaction(SESSION_STORE, "readonly");
    const result = await new Promise((resolve, reject) => {
        const request = transaction.objectStore(SESSION_STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return result;
}

async function putSession(record) {
    const transaction = db.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).put(record);
    await transactionDone(transaction);
}

async function persistChunk(record, sequence, blob) {
    const updated = {
        ...record.metadata,
        chunkCount: sequence + 1,
        bytesStored: (record.metadata.bytesStored || 0) + blob.size,
        lastPersistedAt: new Date().toISOString()
    };
    const transaction = db.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
    transaction.objectStore(CHUNK_STORE).put({
        sessionId: record.metadata.id,
        sequence,
        type: blob.type || record.metadata.mimeType,
        blob,
        bytes: blob.size
    });
    transaction.objectStore(SESSION_STORE).put(updated);
    await transactionDone(transaction);
    record.metadata = updated;
}

async function getChunks(id) {
    const transaction = db.transaction(CHUNK_STORE, "readonly");
    const result = await new Promise((resolve, reject) => {
        const request = transaction.objectStore(CHUNK_STORE).index("sessionId").getAll(IDBKeyRange.only(id));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return result.sort((a, b) => a.sequence - b.sequence);
}

async function deleteSessionData(id) {
    const chunks = await getChunks(id);
    const transaction = db.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
    transaction.objectStore(SESSION_STORE).delete(id);
    const chunkStore = transaction.objectStore(CHUNK_STORE);
    for (const chunk of chunks) chunkStore.delete([id, chunk.sequence]);
    await transactionDone(transaction);
}

function stopStream(stream) {
    if (stream) stream.getTracks().forEach(track => track.stop());
}

// Prefer a format this browser can both record and play, with M4A/AAC first.
function createCompatibleRecorder(stream) {
    const candidates = [
        { mimeType: "audio/mp4;codecs=mp4a.40.2", label: "M4A/AAC" },
        { mimeType: "audio/mp4", label: "M4A/AAC" },
        { mimeType: "audio/webm;codecs=opus", label: "WebM/Opus" },
        { mimeType: "audio/webm", label: "WebM" },
        { mimeType: "audio/ogg;codecs=opus", label: "Ogg/Opus" },
        { mimeType: "audio/ogg", label: "Ogg" }
    ];
    const canCheckRecording = typeof MediaRecorder.isTypeSupported === "function";
    const audioProbe = document.createElement("audio");
    const errors = [];

    for (const candidate of candidates) {
        if (canCheckRecording && !MediaRecorder.isTypeSupported(candidate.mimeType)) continue;
        if (typeof audioProbe.canPlayType === "function" && !audioProbe.canPlayType(candidate.mimeType)) continue;
        try {
            return {
                recorder: new MediaRecorder(stream, { mimeType: candidate.mimeType }),
                requestedMimeType: candidate.mimeType,
                formatLabel: candidate.label
            };
        } catch (error) {
            errors.push(`${candidate.mimeType}: ${error.message || error}`);
        }
    }

    // Last resort: let the browser choose its default if no known shared format matched.
    try {
        const recorder = new MediaRecorder(stream);
        const actualMimeType = (recorder.mimeType || "").toLowerCase();
        const formatLabel = actualMimeType.includes("mp4") || actualMimeType.includes("aac")
            ? "M4A/AAC"
            : actualMimeType.includes("webm") ? "WebM"
            : actualMimeType.includes("ogg") ? "Ogg"
            : actualMimeType || "browser default format";
        return { recorder, requestedMimeType: "", formatLabel };
    } catch (error) {
        const details = errors.length ? ` Format checks: ${errors.join("; ")}.` : "";
        throw new Error(`No compatible audio recording format could be opened.${details} ${error.message || error}`);
    }
}

function describeAudioFormat(mimeType) {
    const mime = (mimeType || "").toLowerCase();
    if (mime.includes("mp4") || mime.includes("aac")) return "M4A/AAC";
    if (mime.includes("webm")) return "WebM";
    if (mime.includes("ogg")) return "Ogg";
    return mimeType || "browser default format";
}

// Play cues through the session's existing AudioContext. Reusing it avoids
// creating a new audio context for every cue, which is more reliable on iPhone.
async function playToneCue(current, tones) {
    const context = current?.audioContext;
    if (!context || context.state === "closed") return false;

    try {
        if (context.state === "suspended") await context.resume();
        if (context.state !== "running" || current.discard) return false;

        const now = context.currentTime;
        for (const tone of tones) {
            const start = now + (tone.delay || 0);
            const duration = tone.duration;
            const oscillator = context.createOscillator();
            const gain = context.createGain();

            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(tone.frequency, start);
            if (tone.harmonic) {
                // A very quiet octave adds definition without making the cue harsh.
                const harmonic = context.createOscillator();
                const harmonicGain = context.createGain();
                harmonic.type = "sine";
                harmonic.frequency.setValueAtTime(tone.frequency * 2, start);
                harmonicGain.gain.setValueAtTime(0.0001, start);
                harmonicGain.gain.linearRampToValueAtTime(tone.volume * 0.12, start + 0.018);
                harmonicGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
                harmonic.connect(harmonicGain);
                harmonicGain.connect(context.destination);
                harmonic.start(start);
                harmonic.stop(start + duration);
                harmonic.addEventListener("ended", () => {
                    harmonic.disconnect();
                    harmonicGain.disconnect();
                }, { once: true });
            }

            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.linearRampToValueAtTime(tone.volume, start + 0.018);
            gain.gain.setValueAtTime(tone.volume, start + duration * 0.62);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(start);
            oscillator.stop(start + duration);
            oscillator.addEventListener("ended", () => {
                oscillator.disconnect();
                gain.disconnect();
            }, { once: true });
        }
        // Tell the caller the tones were successfully scheduled so the startup
        // routine waits for the two-note cue before closing this AudioContext.
        return true;
    } catch (error) {
        console.warn("Could not play an iMuse audio cue:", error);
        return false;
    }
}

// A clear, rising perfect fifth distinguishes microphone readiness from the
// two close, high reminder beeps used while paused. Match their gain level.
async function playMicReadyChime(current) {
    const played = await playToneCue(current, [
        { frequency: 523.25, delay: 0, duration: 0.22, volume: 0.10 },
        { frequency: 783.99, delay: 0.17, duration: 0.27, volume: 0.10 }
    ]);
    // Allow the short, rising pair to finish before startup continues.
    if (played) await new Promise(resolve => window.setTimeout(resolve, 460));
    return played;
}

// A rounded D5 confirms that recording is active. Match the paused reminder's
// gain while keeping this cue lower and more sustained; also used on resume.
function playRecordingStartCue(current) {
    return playToneCue(current, [
        { frequency: 587.33, delay: 0, duration: 0.22, volume: 0.10, harmonic: true }
    ]);
}


// Keep a real (silent) HTML media session active while recording so supported
// headset media buttons can be routed to this page. This is started only from
// the user's Start Recording action, never on page load.
let headsetMediaElement = null;
let headsetMediaUrl = null;

// Temporary, visible diagnostics for the iPhone headset-control investigation.
// These report browser behavior without changing recording or audio-session policy.
let headsetDiagnosticPanel = null;
let headsetDiagnosticDetails = null;
let headsetSilentPlayingLogged = false;
const headsetDiagnosticEvents = [];
const HEADSET_DIAGNOSTIC_MAX_EVENTS = 250;

function getHeadsetDiagnosticSnapshot() {
    const recorderState = activeSession?.recorder?.state || "no active session";
    return [
        "=== iMuse headset diagnostic snapshot ===",
        `Captured: ${new Date().toLocaleString()}`,
        `User agent: ${navigator.userAgent}`,
        `deviceClass: ${deviceClass}`,
        `Environment: ${getHeadsetEnvironmentSummary()}`,
        `Recorder state: ${recorderState}`,
        `Session metadata state: ${activeSession?.metadata?.state || "none"}`,
        `Record button: text=${JSON.stringify(recordButton?.textContent || "")}, disabled=${Boolean(recordButton?.disabled)}`,
        `Pause button: text=${JSON.stringify(pauseButton?.textContent || "")}, disabled=${Boolean(pauseButton?.disabled)}`,
        `Status text: ${status?.textContent || ""}`,
        `MediaSession playbackState: ${navigator.mediaSession?.playbackState || "unavailable"}`,
        `Silent audio: exists=${Boolean(headsetMediaElement)}, paused=${headsetMediaElement?.paused ?? "n/a"}, readyState=${headsetMediaElement?.readyState ?? "n/a"}, error=${headsetMediaElement?.error?.code ?? "none"}`,
        "",
        "=== Event history (oldest first) ===",
        ...headsetDiagnosticEvents
    ].join("\n");
}

function recordHeadsetDiagnostic(message) {
    createHeadsetDiagnosticPanel();
    // The looping keep-alive audio can emit PLAYING repeatedly. Keep only its first
    // event so it cannot push the actual headset/recorder events out of view.
    if (message === "Keep-alive media element emitted PLAYING.") {
        if (headsetSilentPlayingLogged) return;
        headsetSilentPlayingLogged = true;
    }

    headsetDiagnosticEvents.push(`${new Date().toLocaleTimeString()} — ${message}`);
    if (headsetDiagnosticEvents.length > HEADSET_DIAGNOSTIC_MAX_EVENTS) {
        headsetDiagnosticEvents.splice(0, headsetDiagnosticEvents.length - HEADSET_DIAGNOSTIC_MAX_EVENTS);
    }
    if (headsetDiagnosticDetails) {
        headsetDiagnosticDetails.textContent = headsetDiagnosticEvents.join("\n");
    }
}

function createHeadsetDiagnosticPanel() {
    if (headsetDiagnosticPanel) return;
    headsetDiagnosticPanel = document.createElement("section");
    headsetDiagnosticPanel.id = "headsetDiagnostics";
    Object.assign(headsetDiagnosticPanel.style, {
        marginTop: "0.75rem", padding: "0.75rem", border: "1px solid #888",
        borderRadius: "0.5rem", fontSize: "0.9rem", overflowWrap: "anywhere"
    });

    const heading = document.createElement("strong");
    heading.textContent = "Headset diagnostics (temporary)";

    const controls = document.createElement("div");
    Object.assign(controls.style, { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" });

    const activateButton = document.createElement("button");
    activateButton.type = "button";
    activateButton.textContent = "Activate headset controls";
    activateButton.addEventListener("click", () => {
        recordHeadsetDiagnostic("User clicked Activate headset controls.");
        startHeadsetMediaSession();
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy diagnostics";
    copyButton.addEventListener("click", async () => {
        const report = getHeadsetDiagnosticSnapshot();
        try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
            await navigator.clipboard.writeText(report);
            copyButton.textContent = "Copied diagnostics";
        } catch (error) {
            const field = document.createElement("textarea");
            field.value = report;
            field.readOnly = true;
            Object.assign(field.style, {
                display: "block", width: "100%", height: "12rem", marginTop: "0.5rem",
                fontFamily: "monospace", fontSize: "0.8rem", boxSizing: "border-box"
            });
            const previous = headsetDiagnosticPanel.querySelector("#headsetDiagnosticsCopyFallback");
            if (previous) previous.remove();
            field.id = "headsetDiagnosticsCopyFallback";
            copyButton.insertAdjacentElement("afterend", field);
            field.focus();
            field.select();
            copyButton.textContent = "Report selected — copy it";
            recordHeadsetDiagnostic(`Clipboard API unavailable (${error?.name || "error"}); displayed a selectable report instead.`);
        }
    });

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Clear history";
    clearButton.addEventListener("click", () => {
        headsetDiagnosticEvents.length = 0;
        headsetSilentPlayingLogged = false;
        recordHeadsetDiagnostic("Diagnostic history cleared by user.");
    });

    controls.append(activateButton, copyButton, clearButton);
    headsetDiagnosticDetails = document.createElement("pre");
    headsetDiagnosticDetails.id = "headsetDiagnosticsDetails";
    Object.assign(headsetDiagnosticDetails.style, {
        marginTop: "0.5rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
        maxHeight: "18rem", overflowY: "auto", fontFamily: "monospace", fontSize: "0.8rem"
    });
    headsetDiagnosticPanel.append(heading, controls, headsetDiagnosticDetails);
    const anchor = lifecycleStatus || status;
    anchor.insertAdjacentElement("afterend", headsetDiagnosticPanel);
    headsetDiagnosticDetails.textContent = headsetDiagnosticEvents.join("\n");
}

function getHeadsetEnvironmentSummary() {
    const mediaSessionSupported = "mediaSession" in navigator;
    const audioSession = navigator.audioSession;
    const audioSessionSummary = audioSession
        ? `audioSession API available (type: ${audioSession.type || "not exposed"})`
        : "audioSession API unavailable";
    return `MediaSession: ${mediaSessionSupported ? "available" : "unavailable"}; ` +
        `${audioSessionSummary}; page ${document.visibilityState}.`;
}

// Match the successful standalone test on every device: a two-second, 8 kHz,
// mono 16-bit WAV containing a 220 Hz tone at 0.01% full-scale amplitude.
// The HTMLAudioElement is separately set to 1% volume and is never muted.
function createHeadsetKeepAliveBlob() {
    const sampleRate = 8000;
    const seconds = 2;
    const sampleCount = sampleRate * seconds;
    const bytes = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(bytes);
    const writeText = (offset, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // 16-bit PCM
    writeText(36, "data");
    view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i++) {
        const fade = Math.min(1, i / 100, (sampleCount - 1 - i) / 100);
        const sample = Math.round(32767 * 0.0001 * fade * Math.sin(2 * Math.PI * 220 * i / sampleRate));
        view.setInt16(44 + i * 2, sample, true);
    }
    return new Blob([bytes], { type: "audio/wav" });
}

function updateHeadsetPlaybackState(state) {
    if (!("mediaSession" in navigator)) return;
    try {
        navigator.mediaSession.playbackState = state;
        recordHeadsetDiagnostic(`playbackState set to "${state}".`);
    } catch (error) {
        recordHeadsetDiagnostic(`playbackState "${state}" failed: ${error.name || "Error"}: ${error.message || error}`);
        console.debug("Could not update headset media-session state:", error);
    }
}

function startHeadsetMediaSession() {
    recordHeadsetDiagnostic(`Start requested. ${getHeadsetEnvironmentSummary()}`);
    if (!("mediaSession" in navigator)) {
        recordHeadsetDiagnostic("Cannot start media session: navigator.mediaSession is absent.");
        return;
    }
    try {
        if (!headsetMediaElement) {
            headsetMediaElement = document.createElement("audio");
            headsetMediaElement.loop = true;
            headsetMediaElement.preload = "auto";
            headsetMediaElement.setAttribute("playsinline", "");
            headsetMediaElement.setAttribute("aria-hidden", "true");
            headsetMediaElement.style.position = "fixed";
            headsetMediaElement.style.width = "1px";
            headsetMediaElement.style.height = "1px";
            headsetMediaElement.style.opacity = "0";
            headsetMediaElement.style.pointerEvents = "none";
            headsetMediaElement.style.left = "-10px";
            headsetMediaElement.style.bottom = "0";
            const keepAliveBlob = createHeadsetKeepAliveBlob();
            headsetMediaUrl = URL.createObjectURL(keepAliveBlob);
            headsetMediaElement.volume = 0.01;
            headsetMediaElement.muted = false;
            headsetMediaElement.src = headsetMediaUrl;
            recordHeadsetDiagnostic(
                `Prepared shared near-silent 220 Hz WAV (deviceClass=${deviceClass}, 2 seconds, 8 kHz mono 16-bit PCM, waveform amplitude=0.01% full scale, element volume=${headsetMediaElement.volume}, muted=${headsetMediaElement.muted}).`
            );
            document.body.appendChild(headsetMediaElement);
            headsetMediaElement.addEventListener("playing", () => {
                recordHeadsetDiagnostic("Keep-alive media element emitted PLAYING.");
            });
            headsetMediaElement.addEventListener("pause", () => {
                recordHeadsetDiagnostic("Keep-alive media element emitted PAUSE.");
            });
            headsetMediaElement.addEventListener("ended", () => {
                recordHeadsetDiagnostic("Keep-alive media element emitted ENDED.");
            });
            headsetMediaElement.addEventListener("error", () => {
                recordHeadsetDiagnostic(`Keep-alive media element ERROR (code ${headsetMediaElement?.error?.code || "unknown"}).`);
            });
            headsetMediaElement.addEventListener("loadedmetadata", () => {
                recordHeadsetDiagnostic(`Keep-alive WAV metadata loaded (duration ${headsetMediaElement?.duration || "unknown"}s).`);
            });
        }
        navigator.mediaSession.metadata = typeof MediaMetadata === "function"
            ? new MediaMetadata({
                title: "iMuse recording",
                artist: "iMuse",
                album: "Recording controls"
            })
            : null;
        recordHeadsetDiagnostic(`Keep-alive media element prepared (paused=${headsetMediaElement.paused}, readyState=${headsetMediaElement.readyState}).`);
        const playPromise = headsetMediaElement.play();
        if (playPromise && typeof playPromise.then === "function") {
            playPromise.then(() => {
                recordHeadsetDiagnostic(`Keep-alive media play() RESOLVED (paused=${headsetMediaElement?.paused}, readyState=${headsetMediaElement?.readyState}).`);
            }).catch(error => {
                recordHeadsetDiagnostic(`Keep-alive media play() REJECTED: ${error.name || "Error"}: ${error.message || error}`);
                console.warn("iMuse headset media session could not start audio playback:", error);
                setLifecycleStatus(
                    "Headset media controls may be unavailable because the browser did not start its media session. Recording can still be used normally."
                );
            });
        } else {
            recordHeadsetDiagnostic("Keep-alive media play() returned no promise.");
        }
        updateHeadsetPlaybackState("playing");
    } catch (error) {
        recordHeadsetDiagnostic(`Media-session startup threw: ${error.name || "Error"}: ${error.message || error}`);
        console.warn("Could not start iMuse headset media session:", error);
    }
}

function keepHeadsetMediaAudioPlaying() {
    if (!headsetMediaElement) return;
    try {
        const playPromise = headsetMediaElement.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(error => {
                console.debug("Could not resume iMuse headset media audio:", error);
            });
        }
    } catch (error) {
        console.debug("Could not resume iMuse headset media audio:", error);
    }
}

function pauseHeadsetMediaAudio() {
    if (!headsetMediaElement) return;
    try {
        headsetMediaElement.pause();
    } catch (error) {
        console.debug("Could not pause iMuse headset media audio:", error);
    }
}

function stopHeadsetMediaSession() {
    if (headsetMediaElement) {
        try {
            headsetMediaElement.pause();
            headsetMediaElement.removeAttribute("src");
            headsetMediaElement.load();
            headsetMediaElement.remove();
        } catch (error) {
            console.debug("Could not stop headset media session audio:", error);
        }
        headsetMediaElement = null;
    }
    if (headsetMediaUrl) {
        URL.revokeObjectURL(headsetMediaUrl);
        headsetMediaUrl = null;
    }
    updateHeadsetPlaybackState("none");
}

function resumeOrStartFromHeadset() {
    if (!activeSession) {
        startRecording();
        return;
    }
    if (activeSession.recorder.state === "paused") {
        try {
            keepHeadsetMediaAudioPlaying();
            updateHeadsetPlaybackState("playing");
            activeSession.recorder.resume();
        } catch (error) {
            console.warn("Headset resume failed:", error);
            status.textContent = `Could not resume recording from the headset: ${error.message || error}`;
        }
    }
}

function pauseFromHeadset() {
    const current = activeSession;
    if (!current) {
        recordHeadsetDiagnostic("Pause action received with no active recording; starting recording from headset.");
        startRecording();
        return;
    }
    if (current.recorder.state !== "recording") return;
    try {
        current.recorder.pause();
        // Keep the same near-silent media session playing on every device,
        // including while the recorder itself is paused. This matches the
        // successful standalone test and keeps repeated headset commands routable.
        keepHeadsetMediaAudioPlaying();
        updateHeadsetPlaybackState("playing");
    } catch (error) {
        console.warn("Headset pause failed:", error);
        status.textContent = `Could not pause recording from the headset: ${error.message || error}`;
    }
}

function finalizeFromHeadset() {
    const current = activeSession;
    if (!current || !["recording", "paused"].includes(current.recorder.state)) return;
    recordButton.disabled = true;
    pauseButton.disabled = true;
    current.metadata.state = "finalizing";
    current.metadata.lastUpdatedAt = new Date().toISOString();
    putSession(current.metadata).catch(error => console.error("Could not mark session finalizing:", error));
    status.textContent = "Finalizing recording from headset command...";
    try {
        current.recorder.stop();
    } catch (error) {
        console.error("Headset stop failed:", error);
        recordButton.disabled = false;
        pauseButton.disabled = current.recorder.state !== "recording" && current.recorder.state !== "paused";
        status.textContent = `Could not stop recording from the headset: ${error.message || error}`;
    }
}

function initializeHeadsetMediaActions() {
    recordHeadsetDiagnostic(`Registering headset actions. ${getHeadsetEnvironmentSummary()}`);
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setActionHandler !== "function") {
        recordHeadsetDiagnostic("Media Session action handlers are NOT supported here.");
        setLifecycleStatus("This browser does not support Media Session headset controls. On-screen recording controls remain available.");
        return;
    }
    const handlers = {
        play: resumeOrStartFromHeadset,
        pause: pauseFromHeadset,
        stop: finalizeFromHeadset,
        nexttrack: finalizeFromHeadset,
        previoustrack: resumeOrStartFromHeadset,
        seekbackward: () => recordHeadsetDiagnostic("Headset seek-backward action received; no recording action assigned."),
        seekforward: () => recordHeadsetDiagnostic("Headset seek-forward action received; no recording action assigned.")
    };
    for (const [action, handler] of Object.entries(handlers)) {
        try {
            navigator.mediaSession.setActionHandler(action, () => {
                recordHeadsetDiagnostic(`HEADSET ACTION FIRED: "${action}" (recorder state: ${activeSession?.recorder?.state || "no active session"}).`);
                handler();
            });
            recordHeadsetDiagnostic(`Handler "${action}" registered.`);
        } catch (error) {
            recordHeadsetDiagnostic(`Handler "${action}" registration FAILED: ${error.name || "Error"}: ${error.message || error}`);
            // Individual actions vary by browser; keep every supported action.
            console.debug(`Media Session action "${action}" is not supported:`, error);
        }
    }
}

const SILENCE_PAUSE_MS = 5000;
const SILENCE_RMS_THRESHOLD = 0.015;
const PAUSED_BEEP_INTERVAL_MS = 4500;


function setWakeStatus(message) {
    if (wakeStatus) wakeStatus.textContent = message;
}

function setLifecycleStatus(message) {
    if (lifecycleStatus) lifecycleStatus.textContent = message;
}

async function initializeWakeWord() {
    setWakeStatus("Wake-word detector: loading the free Voicute demo model…");
    try {
        wakeWord = await loadVoicuteWakeWord({
            threshold: WAKE_THRESHOLD,
            onStatus: setWakeStatus
        });
        wakeWordPhrase = wakeWord.phrase || "the loaded wake phrase";
        setWakeStatus(
            `Wake-word detector ready: say “${wakeWordPhrase}” after iMuse pauses. Threshold ${WAKE_THRESHOLD.toFixed(2)}.`
        );
        if (activeSession && activeSession.recorder.state === "paused") {
            scheduleWakeDetectorArm(activeSession, 0);
        }
    } catch (error) {
        wakeWordLoadError = error;
        console.warn("Voicute wake-word model could not be loaded:", error);
        setWakeStatus(
            `Wake-word detector unavailable (${error.message || "model load failed"}). Recording and manual controls remain available.`
        );
    }
}

function resetWakeAudioBuffer(current) {
    current.wakeRingPos = 0;
    current.wakeCollectedSamples = 0;
    if (current.wakeRing) current.wakeRing.fill(0);
    if (wakeWord?.engine?.reset) {
        try { wakeWord.engine.reset(); } catch (error) {
            console.warn("Could not reset Voicute inference state:", error);
        }
    }
}

function scheduleWakeDetectorArm(current, delayMs = 650) {
    current.wakeDetectorEnabled = false;
    if (current.wakeRearmTimer !== null) {
        window.clearTimeout(current.wakeRearmTimer);
        current.wakeRearmTimer = null;
    }
    if (!wakeWord || !current.wakeRing) {
        setWakeStatus(wakeWordLoadError
            ? "Wake-word detector unavailable; use Resume manually."
            : "Wake-word detector is loading; use Resume manually if needed.");
        return;
    }
    current.wakeRearmTimer = window.setTimeout(() => {
        current.wakeRearmTimer = null;
        if (
            activeSession !== current ||
            current.discard ||
            current.recorder.state !== "paused" ||
            !wakeWord
        ) return;

        resetWakeAudioBuffer(current);
        current.wakeDetectorEnabled = true;
        setWakeStatus(
            `Listening for “${wakeWordPhrase}” while paused (threshold ${WAKE_THRESHOLD.toFixed(2)}).`
        );
    }, delayMs);
}

async function runWakeWordInference(current, sampleRate) {
    if (
        !wakeWord ||
        !current.wakeDetectorEnabled ||
        current.wakeInferenceBusy ||
        activeSession !== current ||
        current.discard ||
        current.recorder.state !== "paused" ||
        !current.wakeRing
    ) return;

    const engine = wakeWord.engine;
    current.wakeInferenceBusy = true;
    try {
        const samplesNeededAt16k = engine.audioSamplesNeeded();
        const needed = Math.ceil(samplesNeededAt16k * sampleRate / 16000);
        if (current.wakeCollectedSamples < needed || needed <= 0 || needed > current.wakeRing.length) return;

        const raw = new Float32Array(needed);
        const start = (current.wakeRingPos - needed + current.wakeRing.length) % current.wakeRing.length;
        for (let i = 0; i < needed; i++) {
            raw[i] = current.wakeRing[(start + i) % current.wakeRing.length];
        }

        let modelChunk;
        if (sampleRate === 16000) {
            modelChunk = raw;
        } else {
            const outputLength = Math.floor(raw.length * 16000 / sampleRate);
            modelChunk = new Float32Array(outputLength);
            const ratio = sampleRate / 16000;
            for (let i = 0; i < outputLength; i++) {
                const position = i * ratio;
                const low = Math.floor(position);
                const high = Math.min(low + 1, raw.length - 1);
                const fraction = position - low;
                modelChunk[i] = raw[low] * (1 - fraction) + raw[high] * fraction;
            }
        }

        const result = await engine.predict(modelChunk);
        if (
            !result ||
            !current.wakeDetectorEnabled ||
            activeSession !== current ||
            current.recorder.state !== "paused"
        ) return;

        const probability = Number(result.prob) || 0;
        const detected = engine.detect(
            result.word,
            result.prob,
            result.consFrames,
            WAKE_THRESHOLD,
            WAKE_DETECT_COOLDOWN_MS,
            Date.now(),
            result.sigmoid
        );

        if (detected && activeSession === current && current.recorder.state === "paused") {
            current.wakeDetectorEnabled = false;
            if (current.wakeRearmTimer !== null) {
                window.clearTimeout(current.wakeRearmTimer);
                current.wakeRearmTimer = null;
            }
            stopPausedBeep(current);
            setWakeStatus(
                `Detected “${detected}” (${Math.round(probability * 100)}%); resuming recording.`
            );
            status.textContent = `Wake phrase detected — resuming recording.`;
            if (navigator.vibrate) navigator.vibrate(60);
            try {
                current.recorder.resume();
            } catch (error) {
                console.warn("Wake-word resume failed:", error);
                setWakeStatus(`Wake phrase detected, but resume failed: ${error.message || error}`);
            }
        }
    } catch (error) {
        current.wakeDetectorEnabled = false;
        console.warn("Voicute inference failed:", error);
        setWakeStatus(`Wake-word inference stopped after an error: ${error.message || error}. Use Resume manually.`);
    } finally {
        current.wakeInferenceBusy = false;
    }
}

async function requestScreenWakeLock() {
    if (!activeSession) return;
    if (!("wakeLock" in navigator)) {
        setLifecycleStatus(
            "Screen wake lock is not supported in this browser. Background listening is not guaranteed."
        );
        return;
    }
    if (document.visibilityState !== "visible") {
        setLifecycleStatus(
            "iMuse is in the background. The browser may suspend microphone processing or wake-word detection."
        );
        return;
    }
    if (screenWakeLock && !screenWakeLock.released) {
        setLifecycleStatus("Screen wake lock active while recording; this does not guarantee background execution.");
        return;
    }
    try {
        const sentinel = await navigator.wakeLock.request("screen");
        screenWakeLock = sentinel;
        sentinel.addEventListener("release", () => {
            if (screenWakeLock === sentinel) screenWakeLock = null;
            if (activeSession) {
                setLifecycleStatus(
                    "Screen wake lock released. The browser may dim the screen or suspend background work."
                );
            }
        }, { once: true });
        setLifecycleStatus(
            "Screen wake lock active while recording; this helps keep the screen awake but cannot guarantee background execution."
        );
    } catch (error) {
        setLifecycleStatus(
            `Could not keep the screen awake (${error.message || "not permitted"}). Background listening is not guaranteed.`
        );
    }
}

async function releaseScreenWakeLock() {
    const sentinel = screenWakeLock;
    screenWakeLock = null;
    if (sentinel && !sentinel.released) {
        try { await sentinel.release(); } catch (_) {}
    }
    setLifecycleStatus("Screen wake lock released. Start a recording to test listening lifecycle.");
}

function handleVisibilityChange() {
    recordHeadsetDiagnostic(`Visibility changed: ${document.visibilityState}; recorder state: ${activeSession?.recorder?.state || "no active session"}.`);
    if (!activeSession) {
        setLifecycleStatus("Screen wake lock will be requested while recording, if supported.");
        return;
    }
    if (document.visibilityState === "visible") {
        setLifecycleStatus("iMuse is visible again; checking audio and screen wake lock.");
        if (activeSession.audioContext?.state === "suspended") {
            activeSession.audioContext.resume().then(() => {
                if (
                    activeSession &&
                    activeSession.recorder.state === "paused" &&
                    wakeWord
                ) {
                    scheduleWakeDetectorArm(activeSession, 0);
                }
            }).catch(error => {
                console.warn("Could not resume Web Audio after visibility change:", error);
                setLifecycleStatus("Audio processing did not resume automatically. Keep iMuse visible and check microphone access.");
            });
        } else if (activeSession.recorder.state === "paused" && wakeWord) {
            scheduleWakeDetectorArm(activeSession, 0);
        }
        requestScreenWakeLock();
    } else {
        setLifecycleStatus(
            "iMuse is hidden. The browser may suspend the page, microphone processing, or detector; this status cannot guarantee continued listening."
        );
    }
}

function clearWakeDetectorTimers(current) {
    current.wakeDetectorEnabled = false;
    if (current.wakeRearmTimer !== null && current.wakeRearmTimer !== undefined) {
        window.clearTimeout(current.wakeRearmTimer);
        current.wakeRearmTimer = null;
    }
}

async function setupSilenceMonitor(current) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        console.warn("Web Audio is unavailable; automatic silence pause is disabled.");
        return;
    }

    try {
        const context = new AudioContextClass();
        const source = context.createMediaStreamSource(current.stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        // Keep one shared microphone stream. This silent Web Audio branch feeds
        // a rolling buffer for Voicute only; inference runs only while paused.
        const wakeProcessor = context.createScriptProcessor(2048, 1, 1);
        const wakeSilentGain = context.createGain();
        wakeSilentGain.gain.value = 0;
        source.connect(wakeProcessor);
        wakeProcessor.connect(wakeSilentGain);
        wakeSilentGain.connect(context.destination);

        current.audioContext = context;
        current.audioSource = source;
        current.analyser = analyser;
        current.audioSamples = new Float32Array(analyser.fftSize);
        current.wakeProcessor = wakeProcessor;
        current.wakeSilentGain = wakeSilentGain;
        current.wakeSampleRate = context.sampleRate;
        current.wakeRing = new Float32Array(context.sampleRate * 3);
        current.wakeRingPos = 0;
        current.wakeCollectedSamples = 0;
        wakeProcessor.onaudioprocess = event => {
            if (activeSession !== current || current.discard || !current.wakeRing) return;
            const input = event.inputBuffer.getChannelData(0);
            for (let i = 0; i < input.length; i++) {
                current.wakeRing[current.wakeRingPos] = input[i] * 32767;
                current.wakeRingPos = (current.wakeRingPos + 1) % current.wakeRing.length;
            }
            current.wakeCollectedSamples += input.length;
            if (current.wakeDetectorEnabled && current.recorder.state === "paused") {
                runWakeWordInference(current, context.sampleRate);
            }
        };
        await context.resume();

        current.silenceCheckTimer = window.setInterval(() => {
            if (
                activeSession !== current ||
                current.discard ||
                current.recorder.state !== "recording" ||
                current.autoPausing
            ) {
                current.silenceSince = null;
                return;
            }

            // iOS may suspend Web Audio or temporarily mute microphone tracks
            // when the phone locks. Do not interpret missing input as silence.
            const microphoneTrack = current.stream.getAudioTracks()[0];
            if (
                context.state !== "running" ||
                !microphoneTrack ||
                microphoneTrack.readyState !== "live" ||
                microphoneTrack.muted
            ) {
                current.silenceSince = null;
                if (!current.micUnavailableNotice) {
                    current.micUnavailableNotice = true;
                    setLifecycleStatus(
                        "Microphone/audio processing is temporarily unavailable. iPhone locking can interrupt web-app capture; unlock the phone and check that the microphone resumes."
                    );
                }
                return;
            }
            if (current.micUnavailableNotice) {
                current.micUnavailableNotice = false;
                setLifecycleStatus("Microphone input has resumed. Keep iMuse visible for the most reliable wake-word listening.");
            }

            analyser.getFloatTimeDomainData(current.audioSamples);
            let sumSquares = 0;
            for (const sample of current.audioSamples) {
                sumSquares += sample * sample;
            }
            const rms = Math.sqrt(sumSquares / current.audioSamples.length);

            if (rms >= SILENCE_RMS_THRESHOLD) {
                current.silenceSince = null;
                return;
            }

            if (current.silenceSince === null) {
                current.silenceSince = Date.now();
                return;
            }

            if (Date.now() - current.silenceSince >= SILENCE_PAUSE_MS) {
                current.autoPausing = true;
                current.pauseReason = "silence";
                current.silenceSince = null;
                status.textContent = "Silence detected — pausing recording...";
                try {
                    current.recorder.pause();
                } catch (error) {
                    current.autoPausing = false;
                    current.pauseReason = null;
                    console.warn("Automatic silence pause failed:", error);
                }
            }
        }, 100);
    } catch (error) {
        console.warn("Could not start silence detection; manual recording remains available:", error);
        if (current.audioContext && current.audioContext.state !== "closed") {
            try { await current.audioContext.close(); } catch (_) {}
        }
        current.audioContext = null;
        current.audioSource = null;
        current.analyser = null;
        current.audioSamples = null;
        current.wakeProcessor = null;
        current.wakeSilentGain = null;
        current.wakeRing = null;
        current.wakeRingPos = 0;
        current.wakeCollectedSamples = 0;
        setWakeStatus("Wake-word listening unavailable because Web Audio could not start.");
    }
}

async function playPausedBeep(current) {
    const context = current.audioContext;
    if (!context || context.state === "closed") return;

    // Keep wake-word detection active while the reminder tone plays.
    try {
        if (context.state === "suspended") await context.resume();
        if (context.state !== "running") return;

        // Two distinct tones make the paused-state reminder easier to notice.
        const now = context.currentTime;
        const beepDuration = 0.13;
        const gap = 0.09;
        const frequencies = [740, 880];

        for (let i = 0; i < frequencies.length; i++) {
            const start = now + i * (beepDuration + gap);
            const oscillator = context.createOscillator();
            const gain = context.createGain();

            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequencies[i], start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.linearRampToValueAtTime(0.10, start + 0.012);
            gain.gain.setValueAtTime(0.10, start + beepDuration - 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + beepDuration);

            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start(start);
            oscillator.stop(start + beepDuration);
            oscillator.addEventListener("ended", () => {
                oscillator.disconnect();
                gain.disconnect();
            }, { once: true });
        }
    } catch (error) {
        console.warn("Could not play the paused-state beep:", error);
    }
}
function startPausedBeep(current) {
    stopPausedBeep(current);
    playPausedBeep(current);
    current.pausedBeepTimer = window.setInterval(
        () => playPausedBeep(current),
        PAUSED_BEEP_INTERVAL_MS
    );
}

function stopPausedBeep(current) {
    if (current.pausedBeepTimer !== null && current.pausedBeepTimer !== undefined) {
        window.clearInterval(current.pausedBeepTimer);
        current.pausedBeepTimer = null;
    }
}

function cleanupAudioMonitor(current) {
    if (current.silenceCheckTimer !== null && current.silenceCheckTimer !== undefined) {
        window.clearInterval(current.silenceCheckTimer);
        current.silenceCheckTimer = null;
    }
    stopPausedBeep(current);
    clearWakeDetectorTimers(current);
    if (current.wakeProcessor) {
        current.wakeProcessor.onaudioprocess = null;
        try { current.wakeProcessor.disconnect(); } catch (_) {}
        current.wakeProcessor = null;
    }
    if (current.wakeSilentGain) {
        try { current.wakeSilentGain.disconnect(); } catch (_) {}
        current.wakeSilentGain = null;
    }
    if (current.audioSource) {
        try { current.audioSource.disconnect(); } catch (_) {}
        current.audioSource = null;
    }
    if (current.audioContext && current.audioContext.state !== "closed") {
        current.audioContext.close().catch(() => {});
    }
    current.audioContext = null;
    current.analyser = null;
    current.audioSamples = null;
    current.wakeRing = null;
    current.wakeRingPos = 0;
    current.wakeCollectedSamples = 0;
}

function clearPlayback() {
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer.hidden = true;
    recordingControls.hidden = true;
    window.lastRecording = null;
    displayedSessionId = null;
    if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
        recordingUrl = null;
    }
}

function setReadyUI() {
    recordButton.textContent = "Start Recording";
    recordButton.disabled = false;
    pauseButton.textContent = "Pause";
    pauseButton.disabled = true;
}

function showPlayback(blob, sessionId = null) {
    window.lastRecording = blob;
    displayedSessionId = sessionId;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = URL.createObjectURL(blob);
    audioPlayer.src = recordingUrl;
    audioPlayer.type = blob.type || "audio/webm";
    audioPlayer.load();
    audioPlayer.hidden = false;
    recordingControls.hidden = false;
}

function audioFileExtension(blob) {
    const mime = (blob.type || "").toLowerCase();
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("wav") || mime.includes("wave")) return "wav";
    return "audio";
}

function downloadAudioBlob(blob, filenameBase) {
    if (!blob || !blob.size) throw new Error("There is no audio data to download.");
    const extension = audioFileExtension(blob);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filenameBase}.${extension}`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sessionFilename(item) {
    const date = item && item.startedAt ? new Date(item.startedAt) : new Date();
    const stamp = Number.isNaN(date.getTime())
        ? new Date().toISOString().replace(/[:.]/g, "-")
        : date.toISOString().replace(/[:.]/g, "-");
    return `iMuse-recording-${stamp}`;
}

async function exportSavedSession(id, button) {
    if (button) button.disabled = true;
    try {
        const item = await getSession(id);
        if (!item) throw new Error("The saved session no longer exists.");
        const chunks = await getChunks(id);
        const parts = chunks.map(chunk => chunk.blob).filter(blob => blob && blob.size > 0);
        if (!parts.length) throw new Error("No saved audio chunks were found for this recording.");
        const blob = new Blob(parts, {
            type: item.mimeType || parts.find(part => part.type)?.type || "audio/webm"
        });
        downloadAudioBlob(blob, sessionFilename(item));
        status.textContent = "Audio download started. Open the downloaded file in an external audio player to verify it.";
    } catch (error) {
        console.error("Could not export saved recording:", error);
        status.textContent = `Could not export audio: ${error.message || "unknown error"}`;
    } finally {
        if (button) button.disabled = false;
    }
}

function ensureCurrentDownloadButton() {
    let button = document.getElementById("downloadRecordingButton");
    if (button) return button;
    button = document.createElement("button");
    button.id = "downloadRecordingButton";
    button.type = "button";
    button.textContent = "Download audio file";
    button.addEventListener("click", () => {
        try {
            if (!window.lastRecording) throw new Error("No recording is currently loaded.");
            const item = displayedSessionId ? null : null;
            downloadAudioBlob(window.lastRecording, sessionFilename({ startedAt: new Date().toISOString() }));
            status.textContent = "Audio download started. Open the downloaded file in an external audio player to verify it.";
        } catch (error) {
            status.textContent = `Could not download audio: ${error.message || "unknown error"}`;
        }
    });
    deleteButton.parentElement.insertBefore(button, deleteButton);
    return button;
}

function ensureRecoveryPanel() {
    if (recoveryPanel) return recoveryPanel;
    recoveryPanel = document.createElement("section");
    recoveryPanel.id = "recoveryPanel";
    recoveryPanel.hidden = true;
    recoveryPanel.setAttribute("aria-live", "polite");
    recoveryPanel.style.marginTop = "1rem";
    recoveryPanel.style.padding = "0.75rem";
    recoveryPanel.style.border = "1px solid #b8b8b8";
    recoveryPanel.style.borderRadius = "0.5rem";
    const heading = document.createElement("h2");
    heading.textContent = "Saved recordings";
    heading.style.fontSize = "1.1rem";
    recoveryPanel.appendChild(heading);
    status.insertAdjacentElement("afterend", recoveryPanel);
    return recoveryPanel;
}

function formatDate(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

async function renderRecoverableSessions() {
    if (!db) return;
    const panel = ensureRecoveryPanel();
    const sessions = (await getAllSessions()).filter(item =>
        ["completed", "recording", "paused", "interrupted", "finalizing", "storage-error"].includes(item.state)
    ).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    panel.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Saved recordings";
    heading.style.fontSize = "1.1rem";
    panel.appendChild(heading);
    if (!sessions.length) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    const explanation = document.createElement("p");
    explanation.textContent = "Completed recordings remain available here after a page reload. Interrupted sessions can be recovered from the chunks saved before the interruption.";
    panel.appendChild(explanation);
    for (const item of sessions) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.flexWrap = "wrap";
        row.style.alignItems = "center";
        row.style.gap = "0.5rem";
        row.style.marginTop = "0.5rem";
        const label = document.createElement("span");
        label.style.flex = "1 1 12rem";
        label.textContent = `${formatDate(item.startedAt)} — ${item.chunkCount || 0} saved chunks, ${item.bytesStored || 0} bytes`;
        row.appendChild(label);
        const recoverButton = document.createElement("button");
        recoverButton.type = "button";
        recoverButton.textContent = item.state === "completed" ? "Play saved recording" : "Recover audio";
        recoverButton.addEventListener("click", () => {
            if (item.state === "completed") playSavedSession(item.id, recoverButton);
            else recoverSession(item.id, recoverButton);
        });
        row.appendChild(recoverButton);
        const downloadButton = document.createElement("button");
        downloadButton.type = "button";
        downloadButton.textContent = "Download audio file";
        downloadButton.addEventListener("click", () => exportSavedSession(item.id, downloadButton));
        row.appendChild(downloadButton);
        const discardButton = document.createElement("button");
        discardButton.type = "button";
        discardButton.textContent = "Delete saved session";
        discardButton.addEventListener("click", async () => {
            discardButton.disabled = true;
            try {
                await deleteSessionData(item.id);
                status.textContent = "Saved session deleted.";
                await renderRecoverableSessions();
            } catch (error) {
                console.error(error);
                status.textContent = "Could not delete the saved session.";
                discardButton.disabled = false;
            }
        });
        row.appendChild(discardButton);
        panel.appendChild(row);
    }
}


async function playSavedSession(id, button) {
    button.disabled = true;
    status.textContent = "Loading saved recording...";
    try {
        const item = await getSession(id);
        if (!item || item.state !== "completed") throw new Error("This completed recording is no longer available.");
        const chunks = await getChunks(id);
        const parts = chunks.map(chunk => chunk.blob).filter(blob => blob && blob.size > 0);
        if (!parts.length) throw new Error("No saved audio chunks were found for this recording.");
        const blob = new Blob(parts, { type: item.mimeType || parts.find(part => part.type)?.type || "audio/webm" });
        if (!blob.size) throw new Error("The saved recording is empty.");
        showPlayback(blob, id);
        status.textContent = `Loaded completed recording from ${formatDate(item.startedAt)}. Play it to verify the saved audio.`;
    } catch (error) {
        console.error("Could not load saved recording:", error);
        status.textContent = `Could not load saved recording: ${error.message || "unknown error"}`;
    } finally {
        button.disabled = false;
    }
}

async function recoverSession(id, button) {
    button.disabled = true;
    status.textContent = "Recovering saved audio...";
    try {
        const item = await getSession(id);
        if (!item) throw new Error("The saved session no longer exists.");
        const chunks = await getChunks(id);
        const parts = chunks.map(chunk => chunk.blob).filter(blob => blob && blob.size > 0);
        if (!parts.length) throw new Error("No audio chunks were successfully saved for this session.");
        const blob = new Blob(parts, { type: item.mimeType || parts.find(part => part.type)?.type || "audio/webm" });
        if (!blob.size) throw new Error("The recovered audio is empty.");
        showPlayback(blob, id);
        status.textContent = `Recovered ${parts.length} saved audio chunks. Listen through the recording to verify it before relying on it.`;
        await renderRecoverableSessions();
    } catch (error) {
        console.error("Recovery failed:", error);
        status.textContent = `Could not recover audio: ${error.message || "unknown error"}`;
        button.disabled = false;
    }
}

async function initialize() {
    try {
        if (!("indexedDB" in window)) throw new Error("IndexedDB is not available in this browser.");
        db = await openDatabase();
        const sessions = await getAllSessions();
        for (const item of sessions) {
            if (["recording", "paused", "finalizing"].includes(item.state)) {
                item.state = "interrupted";
                item.interruptedAt = new Date().toISOString();
                await putSession(item);
            }
        }
        await renderRecoverableSessions();
    } catch (error) {
        console.error("Recording recovery initialization failed:", error);
        status.textContent = "IndexedDB could not be initialized. Recording can be tested, but durable recovery is unavailable.";
    }
}

// Run a short, disposable MediaRecorder probe during app startup. This tests
// more than constructing a recorder: start() must succeed and the browser must
// deliver non-empty audio data. The probe is never saved or exposed as a recording.
function verifyRecorderCanCapture(recorder) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let settled = false;
        let stopTimer = null;
        let timeoutTimer = null;

        const cleanup = () => {
            if (stopTimer !== null) window.clearTimeout(stopTimer);
            if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
            recorder.removeEventListener("dataavailable", onData);
            recorder.removeEventListener("error", onError);
            recorder.removeEventListener("stop", onStop);
        };
        const finish = (error = null) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else {
                const bytes = chunks.reduce((total, chunk) => total + chunk.size, 0);
                if (bytes > 0) resolve();
                else reject(new Error("The browser started the recorder but produced no test audio data."));
            }
        };
        const onData = event => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        const onError = event => finish(event.error || new Error("The recorder probe failed."));
        const onStop = () => finish();

        recorder.addEventListener("dataavailable", onData);
        recorder.addEventListener("error", onError);
        recorder.addEventListener("stop", onStop);
        timeoutTimer = window.setTimeout(() => {
            try {
                if (recorder.state !== "inactive") recorder.stop();
            } catch (_) {}
            finish(new Error("The recorder did not complete its readiness test in time."));
        }, 5000);

        try {
            recorder.start(250);
            stopTimer = window.setTimeout(() => {
                if (recorder.state !== "inactive") {
                    try { recorder.stop(); }
                    catch (error) { finish(error); }
                }
            }, 650);
        } catch (error) {
            finish(new Error(`The browser could not start audio capture: ${error.message || error}`));
        }
    });
}

function closeAudioContext(context) {
    if (context && context.state !== "closed") {
        context.close().catch(() => {});
    }
}

async function initializeMicrophoneReadiness() {
    if (microphoneInitializationInProgress || microphoneInitializationComplete) return;
    microphoneInitializationInProgress = true;
    recordButton.disabled = true;
    status.textContent = "Checking microphone access and testing audio recording…";
    let stream = null;
    let audioContext = null;
    let audioSource = null;
    try {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("This browser does not provide microphone access to this page.");
        }
        if (typeof MediaRecorder === "undefined") {
            throw new Error("This browser does not support MediaRecorder.");
        }

        // Request permission during app initialization, not at the moment the
        // user wants to speak. The stream is released after this test.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState !== "live" || track.muted) {
            throw new Error("The microphone permission was granted, but no live audio track is available.");
        }

        const recorderChoice = createCompatibleRecorder(stream);
        await verifyRecorderCanCapture(recorderChoice.recorder);
        if (track.readyState !== "live" || track.muted) {
            throw new Error("The microphone became unavailable during the readiness test.");
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
        audioContext = new AudioContextClass();
        audioSource = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        audioSource.connect(analyser);
        await audioContext.resume().catch(() => {});

        // Play the ready cue only after the microphone and a real recorder
        // capture have both passed. Safari may defer sound until a user gesture.
        const cueSession = { audioContext, discard: false };
        const cuePlayed = await playMicReadyChime(cueSession);
        microphoneInitializationComplete = true;

        if (audioSource) {
            try { audioSource.disconnect(); } catch (_) {}
            audioSource = null;
        }
        closeAudioContext(audioContext);
        audioContext = null;
        status.textContent = cuePlayed
            ? "Ready to record. Microphone and recorder passed the startup check."
            : "Microphone and recorder passed the startup check, but the browser blocked the startup chime. Press Start Recording when ready.";
    } catch (error) {
        console.warn("iMuse microphone readiness check failed:", error);
        microphoneInitializationComplete = false;
        status.textContent = `Microphone not ready: ${error.message || "access or recording test failed"}. Press Start Recording to retry.`;
    } finally {
        if (audioSource) {
            try { audioSource.disconnect(); } catch (_) {}
        }
        closeAudioContext(audioContext);
        stopStream(stream);
        microphoneInitializationInProgress = false;
        recordButton.disabled = false;
    }
}

async function startRecording() {
    startHeadsetMediaSession();
    recordButton.disabled = true;
    pauseButton.disabled = true;

    // A new session should not leave the previous session's player visible.
    // The previous recording remains saved in IndexedDB.
    clearPlayback();

    if (!db) {
        status.textContent = "IndexedDB is unavailable, so durable recording cannot start safely.";
        return;
    }
    const requestId = ++startRequest;
    recordButton.disabled = true;
    pauseButton.disabled = true;
    status.textContent = "Preparing microphone...";
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (requestId !== startRequest) {
            stopStream(stream);
            return;
        }
        const recorderChoice = createCompatibleRecorder(stream);
        const recorder = recorderChoice.recorder;
        const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const actualMimeType = recorder.mimeType || recorderChoice.requestedMimeType || "";
        const formatLabel = describeAudioFormat(actualMimeType) || recorderChoice.formatLabel;
        const metadata = {
            id,
            state: "recording",
            startedAt: new Date().toISOString(),
            mimeType: actualMimeType,
            chunkCount: 0,
            bytesStored: 0,
            lastPersistedAt: null,
            lastUpdatedAt: new Date().toISOString()
        };
        await putSession(metadata);
        if (requestId !== startRequest) {
            stopStream(stream);
            await deleteSessionData(id);
            return;
        }
        const current = {
            id, recorder, stream, metadata,
            formatLabel,
            sequence: 0,
            writeQueue: Promise.resolve(),
            persistenceError: null,
            memoryChunks: [],
            discard: false,
            stopHandled: false,
            audioContext: null,
            audioSource: null,
            analyser: null,
            audioSamples: null,
            wakeProcessor: null,
            wakeSilentGain: null,
            wakeSampleRate: 0,
            wakeRing: null,
            wakeRingPos: 0,
            wakeCollectedSamples: 0,
            wakeDetectorEnabled: false,
            wakeInferenceBusy: false,
            wakeRearmTimer: null,
            silenceCheckTimer: null,
            silenceSince: null,
            autoPausing: false,
            pauseReason: null,
            pausedBeepTimer: null,
            micUnavailableNotice: false
        };
        activeSession = current;
        recordHeadsetDiagnostic(`Microphone stream acquired (track state: ${stream.getAudioTracks()[0]?.readyState || "unknown"}); recorder state: ${recorder.state}.`);
        const microphoneTrack = stream.getAudioTracks()[0];
        if (microphoneTrack) {
            microphoneTrack.addEventListener("mute", () => {
                if (activeSession !== current || current.discard) return;
                current.micUnavailableNotice = true;
                current.silenceSince = null;
                setLifecycleStatus("The microphone track was muted. iPhone locking can interrupt web-app audio; unlock the phone and check whether input resumes.");
            });
            microphoneTrack.addEventListener("unmute", () => {
                if (activeSession !== current || current.discard) return;
                current.micUnavailableNotice = false;
                current.silenceSince = null;
                setLifecycleStatus("Microphone track is active again. Keep iMuse visible for the most reliable wake-word listening.");
            });
            microphoneTrack.addEventListener("ended", () => {
                if (activeSession !== current || current.discard) return;
                current.micUnavailableNotice = true;
                current.silenceSince = null;
                setLifecycleStatus("Microphone access ended. iMuse cannot reliably reacquire it without restarting the recording; stop and start a new recording if input does not return.");
            });
        }
        recorder.addEventListener("start", () => {
            recordHeadsetDiagnostic(`MediaRecorder emitted START event (state: ${recorder.state}).`);
        });
        recorder.addEventListener("dataavailable", event => {
            if (current.discard || !event.data || !event.data.size) return;
            const sequence = current.sequence++;
            if (sequence === 0) {
                recordHeadsetDiagnostic(`First non-empty audio chunk received (${event.data.size} bytes, type: ${event.data.type || "unknown"}).`);
            }
            current.memoryChunks.push(event.data);
            current.writeQueue = current.writeQueue.then(async () => {
                if (current.discard) return;
                await persistChunk(current, sequence, event.data);
                status.textContent = `Recording in ${current.formatLabel} — ${current.metadata.chunkCount} chunks saved to this browser.`;
            }).catch(error => {
                current.persistenceError = error;
                console.error("Audio chunk could not be persisted:", error);
                status.textContent = "Warning: an audio chunk could not be saved. Keep this page open and stop the recording to retain any audio still in memory.";
                current.metadata.state = "storage-error";
                current.metadata.lastUpdatedAt = new Date().toISOString();
                putSession(current.metadata).catch(saveError => console.error("Could not update session state:", saveError));
            });
        });
        recorder.addEventListener("error", event => {
            console.error("MediaRecorder error:", event.error || event);
            status.textContent = "Recording error. Some audio may not have been saved.";
            recordButton.disabled = false;
            pauseButton.disabled = true;
        });
        recorder.addEventListener("pause", async () => {
            if (activeSession !== current || current.discard) return;
            current.metadata.state = "paused";
            current.metadata.lastUpdatedAt = new Date().toISOString();
            try { await putSession(current.metadata); } catch (error) { console.error(error); }
            pauseButton.textContent = "Resume";
            pauseButton.disabled = false;
            // Recorder pause and media-session playback are separate on every
            // device: leave the near-silent keep-alive audio running.
            keepHeadsetMediaAudioPlaying();
            updateHeadsetPlaybackState("playing");
            current.autoPausing = false;
            current.silenceSince = null;
            current.wakeDetectorEnabled = false;
            scheduleWakeDetectorArm(current, 0);
            startPausedBeep(current);
            status.textContent = current.pauseReason === "silence"
                ? `Paused automatically after ${SILENCE_PAUSE_MS / 1000} seconds of silence. Say “${wakeWordPhrase}” to resume, or press Resume.`
                : `Paused — ${current.metadata.chunkCount} chunks saved so far. Say “${wakeWordPhrase}” to resume, or press Resume.`;
        });
        recorder.addEventListener("resume", async () => {
            if (activeSession !== current || current.discard) return;
            current.metadata.state = "recording";
            current.metadata.lastUpdatedAt = new Date().toISOString();
            try { await putSession(current.metadata); } catch (error) { console.error(error); }
            pauseButton.textContent = "Pause";
            keepHeadsetMediaAudioPlaying();
            updateHeadsetPlaybackState("playing");
            stopPausedBeep(current);
            clearWakeDetectorTimers(current);
            current.silenceSince = null;
            current.pauseReason = null;
            current.autoPausing = false;
            setWakeStatus(`Wake-word inference is off while recording. It will listen for “${wakeWordPhrase}” after a pause.`);
            status.textContent = "Recording resumed.";
            playRecordingStartCue(current);
        });
        recorder.addEventListener("stop", async () => {
            if (current.stopHandled) return;
            current.stopHandled = true;
            cleanupAudioMonitor(current);
            stopStream(stream);
            stopHeadsetMediaSession();
            if (activeSession === current) activeSession = null;
            releaseScreenWakeLock();
            setWakeStatus("Wake-word detector idle. Start a recording to test it.");
            if (current.discard) {
                try { await current.writeQueue; } catch (_) { /* best effort; session is being deleted */ }
                try { await deleteSessionData(id); } catch (error) { console.error("Could not delete discarded session:", error); }
                return;
            }
            recordButton.disabled = true;
            pauseButton.disabled = true;
            status.textContent = "Waiting for saved audio writes to finish...";
            await current.writeQueue;
            let finalBlob;
            try {
                if (current.persistenceError) throw current.persistenceError;
                const savedChunks = await getChunks(id);
                const parts = savedChunks.map(chunk => chunk.blob).filter(blob => blob && blob.size > 0);
                finalBlob = new Blob(parts, { type: current.metadata.mimeType || parts.find(part => part.type)?.type || "application/octet-stream" });
                if (!finalBlob.size) throw new Error("No saved audio chunks were found.");
                current.metadata.state = "completed";
                current.metadata.completedAt = new Date().toISOString();
                current.metadata.lastUpdatedAt = current.metadata.completedAt;
                await putSession(current.metadata);
                showPlayback(finalBlob, id);
                status.textContent = `Recording complete. ${savedChunks.length} chunks were saved to this browser.`;
            } catch (error) {
                console.error("Could not finalize persisted recording:", error);
                finalBlob = new Blob(current.memoryChunks, { type: current.metadata.mimeType || current.memoryChunks.find(part => part.type)?.type || "application/octet-stream" });
                if (finalBlob.size) showPlayback(finalBlob, id);
                current.metadata.state = "storage-error";
                current.metadata.lastUpdatedAt = new Date().toISOString();
                try { await putSession(current.metadata); } catch (saveError) { console.error(saveError); }
                status.textContent = finalBlob.size
                    ? "Playback is available from memory, but durable saving failed. Do not reload this page until you have saved the audio elsewhere."
                    : "Recording could not be finalized. No playable audio was available.";
            }
            setReadyUI();
            await renderRecoverableSessions();
        });
        await setupSilenceMonitor(current);
        recorder.start(250);
        recordHeadsetDiagnostic(`MediaRecorder STARTED (state: ${recorder.state}); silent element paused=${headsetMediaElement?.paused ?? "absent"}; playbackState=${navigator.mediaSession?.playbackState || "unavailable"}.`);
        recordButton.textContent = "Stop Recording";
        recordButton.disabled = false;
        pauseButton.textContent = "Pause";
        pauseButton.disabled = false;
        status.textContent = `Recording in ${formatLabel} — saving audio chunks as they arrive.`;
        recordHeadsetDiagnostic(`Recording UI updated (record button: ${recordButton.textContent}, disabled=${recordButton.disabled}; pause button: ${pauseButton.textContent}, disabled=${pauseButton.disabled}).`);
        setWakeStatus(wakeWord
            ? `Wake-word inference is off while recording. It will listen for “${wakeWordPhrase}” after a pause.`
            : "Wake-word model is unavailable or still loading; manual recording controls remain available.");
        requestScreenWakeLock();
        playRecordingStartCue(current);
    } catch (error) {
        recordHeadsetDiagnostic(`Recording startup FAILED: ${error.name || "Error"}: ${error.message || error}`);
        console.error(error);
        stopStream(stream);
        recordButton.disabled = false;
        recordButton.textContent = "Start Recording";
        pauseButton.disabled = true;
        status.textContent = `Could not start durable recording: ${error.message || "microphone unavailable"}`;
    }
}

recordButton.addEventListener("click", () => {
    if (!activeSession) {
        startRecording();
        return;
    }
    finalizeFromHeadset();
});

pauseButton.addEventListener("click", () => {
    const current = activeSession;
    if (!current) return;
    try {
        if (current.recorder.state === "recording") {
            current.recorder.pause();
            pauseButton.textContent = "Resume";
            status.textContent = "Pausing recording...";
        } else if (current.recorder.state === "paused") {
            current.recorder.resume();
            pauseButton.textContent = "Pause";
            status.textContent = "Resuming recording...";
        }
    } catch (error) {
        console.error(error);
        status.textContent = "Could not change recording state. Please stop and check the audio.";
    }
});

deleteButton.addEventListener("click", async () => {
    startRequest++;
    const current = activeSession;
    const savedSessionId = current ? current.id : displayedSessionId;
    if (current) {
        current.discard = true;
        activeSession = null;
        cleanupAudioMonitor(current);
        stopHeadsetMediaSession();
        releaseScreenWakeLock();
        setWakeStatus("Wake-word detector stopped because the recording was deleted.");
        try {
            if (current.recorder.state !== "inactive") current.recorder.stop();
            else stopStream(current.stream);
        } catch (error) {
            console.warn("Could not stop recorder during delete:", error);
            stopStream(current.stream);
        }
        try { await current.writeQueue; } catch (_) { /* deletion is best effort */ }
        try { await deleteSessionData(current.id); } catch (error) { console.error("Could not delete session:", error); }
    } else if (savedSessionId) {
        try { await deleteSessionData(savedSessionId); } catch (error) { console.error("Could not delete saved recording:", error); }
    }
    clearPlayback();
    setReadyUI();
    status.textContent = "Recording deleted.";
    try { await renderRecoverableSessions(); } catch (error) { console.error(error); }
});

document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("pageshow", () => {
    if (activeSession && document.visibilityState === "visible") handleVisibilityChange();
});
window.addEventListener("pagehide", () => {
    if (activeSession) {
        setLifecycleStatus(
            "The page is leaving the foreground. The browser may suspend audio processing; continued wake-word listening is not guaranteed."
        );
    }
});

recordHeadsetDiagnostic(`Diagnostic build loaded. deviceClass=${deviceClass}; user agent: ${navigator.userAgent}`);
initialize();
initializeWakeWord();
initializeMicrophoneReadiness();
setLifecycleStatus("Screen wake lock will be requested while recording, if supported.");
initializeHeadsetMediaActions();
