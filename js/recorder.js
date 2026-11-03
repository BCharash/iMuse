import { playSpokenResponse, prepareSpokenResponses } from "./audio-response-manager.js";
import { acquireRecordingMicrophone, releaseRecordingMicrophone, setMicrophoneSelectionLocked } from "./microphone-manager.js";
import { loadVoicuteWakeWord } from "./voicute/voicute-adapter.js";
import { loadHeedWakeWord } from "./heed/heed-adapter.js";
import { getSettings, effectiveOverlap, setSilencePauseLocked } from "./settings.js";
import { loadCommands, startCommands, stopCommands } from "./tensorflow/commands-adapter.js";
import { createRecordingStorageCoordinator } from "./recording-storage-coordinator.js";
import { inspectRecordingChunks, recordingCompletion } from "./recording-integrity.js";

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
window.addEventListener("imuse-settings-changed", event => {
    const next = event.detail.wakeEngine;
    const threshold = next === "heed" ? event.detail.wakeThreshold : event.detail.voicuteThreshold;
    if (!event.detail.audioCommands) {
        closeCommandWindow();
        if (activeSession) clearWakeDetectorTimers(activeSession);
        setWakeStatus("Audio commands disabled.");
    }
    if (next !== selectedWakeEngine) {
        closeCommandWindow();
        selectedWakeEngine = next;
        WAKE_THRESHOLD = threshold;
        if (activeSession) clearWakeDetectorTimers(activeSession);
        wakeWord = null;
        void initializeWakeWord();
    } else if (threshold !== WAKE_THRESHOLD) {
        WAKE_THRESHOLD = threshold;
        wakeWord?.engine?.setThreshold?.(threshold);
    }
    if (event.detail.audioCommands) preloadCommandModel();
    if (event.detail.audioCommands && activeSession && !commandActive && wakeWord) {
        scheduleWakeDetectorArm(activeSession, 0);
    }
});
window.deviceClass = deviceClass;

let WAKE_THRESHOLD = getSettings().voicuteThreshold;
let selectedWakeEngine = getSettings().wakeEngine;
const WAKE_DETECT_COOLDOWN_MS = 1500;
let wakeWord = null;
let wakeWordPhrase = "Hey Friday";
let wakeWordLoadError = null;
let screenWakeLock = null;

const DB_NAME = "imuse-recording-breadboard";
const DB_VERSION = 2;
const SESSION_STORE = "sessions";
const CHUNK_STORE = "chunks";
const EVENT_STORE = "recordingEvents";
const recordingStorage = createRecordingStorageCoordinator(navigator.locks, `${DB_NAME}/writer`);
// Includes finalization after activeSession is cleared.
const writingSessions = new Set();
// Maximum audio waiting for a committed IndexedDB write.
const MAX_PENDING_AUDIO_BYTES = 8 * 1024 * 1024;

let db = null;
let activeSession = null;
let recordingUrl = null;
let displayedSessionId = null;
let savedPlayback = null;
let savedPlaybackRequest = 0;
let startRequest = 0;
let recoveryPanel = null;
let lastRecordingPeakBytes = 0;
// Emergency assemblies include audio that could not be committed to IndexedDB.
// Keep them independently of the player, including after another recording starts.
// These references survive playback changes, but cannot survive a page closure.
const emergencyRecordings = new Map();
// Deliberately session-only: enabling a test must not affect a later page load.
let preservationTestEnabled = false;
let preservationTestButton = null;
let preservationTestResult = null;
const FINALIZATION_NOTICE_MS = 10000;
const STORAGE_READ_TIMEOUT_MS = 2000;

function boundedStorageRead(promise) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Reading saved audio is taking too long.")), STORAGE_READ_TIMEOUT_MS);
    })]).finally(() => clearTimeout(timer));
}

function armFinalizationWatchdog(current) {
    if (current.finalizationTimer || current.finalizationFinished) return;
    current.finalizationTimer = setTimeout(() => {
        void offerDelayedFinalization(current).catch(error => console.error("Delayed finalization recovery:", error));
    }, FINALIZATION_NOTICE_MS);
}

async function offerDelayedFinalization(current) {
    if (current.finalizationFinished) return;
    current.finalizationDelayed = true;
    current.metadata.interruptedAt ||= new Date().toISOString();
    current.metadata.interruptionReasons = [...new Set([...(current.metadata.interruptionReasons || []), "Finalization was delayed"])];
    status.textContent = "Finishing is taking longer than expected. Preparing available audio for download. Keep this page open.";
    // A missing stop event must not leave the microphone running indefinitely.
    // Keep ownership until the real stop handler and pending writes settle.
    if (!current.stopHandled) {
        setRecordingControlState("finalizing");
        closeCommandWindow({ restorePauseReminder: false });
        cleanupAudioMonitor(current);
        stopStream(current.stream);
        releaseScreenWakeLock();
    }
    let saved = [];
    try { saved = await boundedStorageRead(getChunks(current.id)); } catch (_) { /* retain available memory fragments */ }
    if (current.finalizationFinished) return;
    const bySequence = new Map(saved.map(chunk => [chunk.sequence, chunk.blob]));
    for (const [sequence, blob] of current.pendingChunks) bySequence.set(sequence, blob);
    const parts = [...bySequence].sort((a, b) => a[0] - b[0]).map(([, blob]) => blob).filter(blob => blob?.size);
    const blob = new Blob(parts, { type: current.metadata.mimeType || parts[0]?.type || "application/octet-stream" });
    if (blob.size) retainEmergencyRecording(current, blob);
    status.textContent = blob.size
        ? "Finalization is delayed. Load or download available audio below; it may be incomplete. Keep this page open. New recording waits for pending storage to finish."
        : "Finalization is delayed and no audio could be read yet. Keep this page open; pending storage still owns this session.";
    void renderRecoverableSessions().catch(error => console.error(error));
}

function updatePreservationTestControls() {
    if (!preservationTestButton) return;
    const current = activeSession;
    preservationTestButton.disabled = !preservationTestEnabled ||
        !current || current.recorder.state !== "recording" ||
        !current.metadata.chunkCount || current.persistenceError ||
        current.simulateNextChunkFailure || current.simulatedStorageFailure || current.stopHandled;
}

function initializePreservationTest() {
    const panel = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = "Recording preservation test";
    const note = document.createElement("p");
    note.textContent = "Use a disposable recording. This test stops it by simulating a storage-write failure, retaining unsaved audio in this open page. Existing recordings are unchanged. Keep the page open until you download the emergency audio.";
    const label = document.createElement("label");
    const enable = document.createElement("input");
    enable.type = "checkbox";
    label.append(enable, document.createTextNode(" Enable failure testing for this page"));
    preservationTestButton = document.createElement("button");
    preservationTestButton.type = "button";
    preservationTestButton.textContent = "Simulate storage failure";
    preservationTestResult = document.createElement("p");
    preservationTestResult.setAttribute("role", "status");
    enable.addEventListener("change", () => {
        preservationTestEnabled = enable.checked;
        if (!enable.checked && activeSession) activeSession.simulateNextChunkFailure = false;
        preservationTestResult.textContent = enable.checked
            ? "Ready. Start a test recording and speak for several seconds. The test button becomes available after audio is saved."
            : "Failure testing disabled.";
        updatePreservationTestControls();
    });
    preservationTestButton.addEventListener("click", () => {
        updatePreservationTestControls();
        if (preservationTestButton.disabled) return;
        const current = activeSession;
        current.simulateNextChunkFailure = true;
        preservationTestResult.textContent = "Failure armed for this recording's next audio write. Keep speaking until recording stops.";
        updatePreservationTestControls();
        try {
            // Flush recent audio rather than wait indefinitely for a timeslice.
            current.recorder.requestData();
        } catch (error) {
            current.simulateNextChunkFailure = false;
            preservationTestResult.textContent = `Could not request test audio: ${error.message || error}. No failure was injected.`;
            updatePreservationTestControls();
        }
    });
    panel.append(heading, note, label, preservationTestButton, preservationTestResult);
    document.getElementById("settingsPanel").appendChild(panel);
    updatePreservationTestControls();
}

// Count actual active recording time, excluding periods when MediaRecorder is paused.
function recordedSeconds(current) {
    const activeMs = current.activeSinceMs === null ? 0 : Math.max(0, performance.now() - current.activeSinceMs);
    return Math.floor((current.recordedMs + activeMs) / 1000);
}
function formatRecordedDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    if (minutes) return `${minutes}:${String(seconds).padStart(2, "0")}`;
    return `${seconds}s`;
}

function savedChunkProgress(current) {
    const count = current.metadata.chunkCount;
    return `${count} chunk${count === 1 ? "" : "s"} saved, ${formatRecordedDuration(recordedSeconds(current))} recorded`;
}

// Small, allocation-free snapshot of the recorder's pending audio buffer.
// This is not a measurement of total browser/process memory.
function publishRecordingDiagnostics() {
    const current = activeSession;
    window.imuseRecordingDiagnostics = {
        pendingBytes: current?.pendingBytes || 0,
        peakPendingBytes: current?.peakPendingBytes ?? lastRecordingPeakBytes,
        pendingChunks: current?.pendingChunks?.size || 0,
        bufferLimitBytes: MAX_PENDING_AUDIO_BYTES,
        recordingState: current?.recorder?.state || "inactive"
    };
    window.dispatchEvent(new Event("imuse-recording-diagnostics"));
    updatePreservationTestControls();
}
publishRecordingDiagnostics();


function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(SESSION_STORE)) {
                database.createObjectStore(SESSION_STORE, { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains(EVENT_STORE)) {
                const events = database.createObjectStore(EVENT_STORE, { keyPath: "key", autoIncrement: true });
                events.createIndex("sessionId", "sessionId", { unique: false });
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

// Independent IndexedDB event log: never modifies session/chunk records or their write queue.
// Diagnostic writes are best-effort and cannot delay or stop audio capture.
function logRecordingEvent(current, type, details = {}) {
    if (!db || !current) return;
    const entry = {
        sessionId: current.id,
        at: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - (current.diagnosticStartedAt || performance.now())),
        type,
        recorderState: current.recorder?.state || "unavailable",
        trackState: current.stream?.getAudioTracks()?.[0]?.readyState || "unavailable",
        trackMuted: !!current.stream?.getAudioTracks()?.[0]?.muted,
        visibility: document.visibilityState,
        chunkCount: current.metadata?.chunkCount || 0,
        pendingBytes: current.pendingBytes || 0,
        ...details
    };
    try {
        const transaction = db.transaction(EVENT_STORE, "readwrite");
        transaction.objectStore(EVENT_STORE).add(entry);
        transaction.onerror = () => console.warn("Could not save recording diagnostic event:", transaction.error);
    } catch (error) { console.warn("Could not log recording event:", error); }
}

// Passive foreground-return probe. Reads existing analyser data without changing
// the microphone, AudioContext, recorder, or chunk boundaries.
function logCaptureSnapshot(current, phase) {
    if (activeSession !== current || current.stopHandled || current.discard) return;
    const track = current.stream?.getAudioTracks?.()[0];
    const details = {
        phase,
        audioContextState: current.audioContext?.state || "unavailable",
        recorderMimeType: current.recorder?.mimeType || "",
        trackEnabled: track?.enabled ?? null,
        chunksReceived: current.sequence,
        lastChunkAgeMs: current.lastChunkAtMs == null ? null : Math.round(performance.now() - current.lastChunkAtMs),
        lastChunkBytes: current.lastChunkBytes ?? null,
        analyserRms: null,
        analyserPeak: null
    };
    if (current.audioContext?.state === "running" && current.analyser && current.audioSamples) {
        try {
            current.analyser.getFloatTimeDomainData(current.audioSamples);
            let sum = 0, peak = 0;
            for (const sample of current.audioSamples) {
                sum += sample * sample;
                peak = Math.max(peak, Math.abs(sample));
            }
            details.analyserRms = Math.round(Math.sqrt(sum / current.audioSamples.length) * 1000000) / 1000000;
            details.analyserPeak = Math.round(peak * 1000000) / 1000000;
        } catch (error) { details.analyserError = String(error); }
    }
    logRecordingEvent(current, "capture-snapshot", details);
}

function scheduleForegroundCaptureSnapshots(current) {
    if (!current || current.discard) return;
    // Do not create a persistent polling loop or touch the recorder.
    logCaptureSnapshot(current, "foreground-immediate");
    for (const delay of [1000, 3000, 6000]) {
        window.setTimeout(() => {
            if (activeSession === current && document.visibilityState === "visible") {
                logCaptureSnapshot(current, `foreground-${delay}ms`);
            }
        }, delay);
    }
}

async function getRecordingEvents(sessionId) {
    const transaction = db.transaction(EVENT_STORE, "readonly");
    const request = transaction.objectStore(EVENT_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId));
    const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return result;
}

async function downloadRecordingEvents(id) {
    const events = await getRecordingEvents(id);
    const item = await getSession(id);
    const report = { sessionId: id, session: item, events };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `iMuse-stop-diagnostics-${id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

async function putSessionNow(record) {
    const transaction = db.transaction(SESSION_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(SESSION_STORE);
    const request = store.get(record.id);
    request.onsuccess = () => {
        const stored = request.result;
        // Lifecycle snapshots must never roll back committed audio counters.
        const updated = stored ? { ...stored, ...record,
            chunkCount: stored.chunkCount, bytesStored: stored.bytesStored,
            lastPersistedAt: stored.lastPersistedAt } : { ...record };
        if (stored?.state === "deleted" && record.state !== "deleted") {
            delete updated.previousState;
            delete updated.deletedAt;
        }
        store.put(updated);
    };
    await done;
}

function putSession(record) {
    const snapshot = { ...record };
    return recordingStorage.run(() => putSessionNow(snapshot));
}

async function persistChunk(record, sequence, blob) {
    if (preservationTestEnabled && record.simulateNextChunkFailure) {
        record.simulateNextChunkFailure = false;
        record.simulatedStorageFailure = true;
        logRecordingEvent(record, "simulated-storage-failure", { sequence, bytes: blob.size });
        // Fail before opening a transaction. The existing write-error and stop
        // handlers retain this chunk and the final recorder tail for export.
        throw new Error("Simulated storage failure (preservation test).");
    }
    return recordingStorage.run(async () => {
        const transaction = db.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
        const done = transactionDone(transaction);
        const sessions = transaction.objectStore(SESSION_STORE);
        const chunks = transaction.objectStore(CHUNK_STORE);
        let updated;
        const request = sessions.get(record.id);
        request.onsuccess = () => {
            if (!request.result || request.result.state === "deleted") {
                transaction.abort();
                return;
            }
            const stored = request.result;
            const previous = chunks.get([record.id, sequence]);
            previous.onsuccess = () => {
                updated = { ...stored,
                    chunkCount: Math.max(stored.chunkCount || 0, sequence + 1),
                    bytesStored: (stored.bytesStored || 0) - (previous.result?.bytes || 0) + blob.size,
                    lastPersistedAt: new Date().toISOString() };
                chunks.put({ sessionId: record.id, sequence,
                    type: blob.type || stored.mimeType, blob, bytes: blob.size });
                sessions.put(updated);
            };
        };
        await done;
        // A pause/stop may have changed the in-memory state while this write ran.
        Object.assign(record.metadata, { chunkCount: updated.chunkCount,
            bytesStored: updated.bytesStored, lastPersistedAt: updated.lastPersistedAt });
    });
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
    return recordingStorage.run(async () => {
        assertSessionIdle(id);
        const chunks = await getChunks(id);
        const transaction = db.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
        transaction.objectStore(SESSION_STORE).delete(id);
        const chunkStore = transaction.objectStore(CHUNK_STORE);
        for (const chunk of chunks) chunkStore.delete([id, chunk.sequence]);
        await transactionDone(transaction);
        // Remove diagnostics only when the recording itself is permanently deleted.
        const events = await getRecordingEvents(id);
        const eventTransaction = db.transaction(EVENT_STORE, "readwrite");
        for (const event of events) eventTransaction.objectStore(EVENT_STORE).delete(event.key);
        await transactionDone(eventTransaction);
    });
}

function assertSessionIdle(id) {
    if (writingSessions.has(id)) throw new Error("Stop and finish this recording before loading or deleting it.");
    if (emergencyRecordings.has(id)) throw new Error("This recording contains unsaved audio. Download it before closing the page; it remains available in the recordings list.");
}

// Soft deletion retains the session and its IndexedDB audio chunks until
// the user explicitly chooses permanent deletion.
async function moveSessionToRecentlyDeleted(id) {
    return recordingStorage.run(async () => {
        assertSessionIdle(id);
        const item = await getSession(id);
        if (!item) throw new Error("This recording no longer exists.");
        if (item.state === "deleted") return;
        await putSessionNow({ ...item, previousState: item.state, state: "deleted",
            deletedAt: new Date().toISOString() });
    });
}

async function restoreRecentlyDeletedSession(id) {
    return recordingStorage.run(async () => {
        assertSessionIdle(id);
        const item = await getSession(id);
        if (!item || item.state !== "deleted") throw new Error("This deleted recording is no longer available.");
        const { previousState, deletedAt, ...rest } = item;
        const state = previousState === "completed" ? "completed" : "interrupted";
        await putSessionNow({ ...rest, state, lastUpdatedAt: new Date().toISOString() });
    });
}

function stopStream(stream) {
    if (stream?.getAudioTracks?.().length) publishMicrophoneProcessing(stream, false);
    releaseRecordingMicrophone(stream);
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

// UI state follows MediaRecorder events, including silence and voice-triggered transitions.
const recordingHeading = document.getElementById("recordingHeading");
function setRecordingControlState(state) {
    const labels = {
        idle: ["New Recording", "Start recording"],
        preparing: ["Preparing recording…", "Preparing recording"],
        recording: ["Recording in progress", "Pause recording"],
        paused: ["Paused", "Resume recording"],
        finalizing: ["Finalizing recording…", "Finalizing recording"]
    };
    const [heading, action] = labels[state] || labels.idle;
    recordingHeading.textContent = heading;
    recordButton.setAttribute("aria-label", action);
    recordButton.title = action;
    recordButton.classList.toggle("is-recording", state === "recording");
    recordButton.disabled = state === "preparing" || state === "finalizing";
    pauseButton.disabled = !["recording", "paused"].includes(state);
}

function finalizeRecording(source = "unspecified") {
    closeCommandWindow({ restorePauseReminder: false });
    const current = activeSession;
    if (!current || !["recording", "paused"].includes(current.recorder.state)) return;
    current.stopIntent = source;
    logRecordingEvent(current, "stop-request", { source });
    setRecordingControlState("finalizing");
    current.metadata.state = "finalizing";
    current.metadata.lastUpdatedAt = new Date().toISOString();
    putSession(current.metadata).catch(error => console.error("Could not mark session finalizing:", error));
    status.textContent = "Saving recording…";
    armFinalizationWatchdog(current);
    try {
        current.recorder.stop();
    } catch (error) {
        console.error("Recording stop failed:", error);
        setRecordingControlState(current.recorder.state);
        status.textContent = `Could not stop recording: ${error.message || error}`;
    }
}

// Silence duration is configurable in Settings; snapshot per recording.
// Defaults preserve the former 0.015 RMS silence threshold (~-36.48 dBFS).
function currentSilenceRmsThreshold() {
    return Math.pow(10, getSettings().silenceThresholdDb / 20);
}
function publishMicrophoneProcessing(stream, live = true) {
    const track = stream?.getAudioTracks?.()[0];
    if (!track) return;
    const safe = (fn) => { try { return fn() || {}; } catch (_) { return {}; } };
    window.imuseMicrophoneProcessing = {
        label: track.label || "Not reported",
        requested: safe(() => track.getConstraints?.()),
        active: safe(() => track.getSettings?.()),
        supported: safe(() => navigator.mediaDevices?.getSupportedConstraints?.()),
        live
    };
    window.dispatchEvent(new Event("imuse-microphone-processing"));
}
const PAUSED_BEEP_INTERVAL_MS = 4500;


function setWakeStatus(message) {
    if (wakeStatus) wakeStatus.textContent = message;
}

function setLifecycleStatus(message) {
    if (lifecycleStatus) lifecycleStatus.textContent = message;
}

async function initializeWakeWord() {
 const engineName=selectedWakeEngine;
 WAKE_THRESHOLD=engineName==="heed"?getSettings().wakeThreshold:getSettings().voicuteThreshold;
 wakeWordLoadError=null;
 setWakeStatus(`Preparing voice commands…`);
 try {
  const loaded=engineName==="heed"
   ?await loadHeedWakeWord({threshold:WAKE_THRESHOLD,onStatus:setWakeStatus})
   :await loadVoicuteWakeWord({threshold:WAKE_THRESHOLD,onStatus:setWakeStatus});
  if(selectedWakeEngine!==engineName)return;
  wakeWord=loaded;
  wakeWordPhrase=loaded.phrase;
  setWakeStatus(`Voice commands ready — “${wakeWordPhrase}”.`);
  if(activeSession && getSettings().audioCommands)scheduleWakeDetectorArm(activeSession,0);
 }catch(error){
  if(selectedWakeEngine!==engineName)return;
  wakeWordLoadError=error;
  setWakeStatus(`Voice commands unavailable. You can still use the recording buttons.`);
 }
}

// Voice command state is independent of MediaRecorder state.
const commandIndicator = document.getElementById("commandListening");
const commandCountdown = document.getElementById("commandCountdown");
const commandTimerProgress = document.getElementById("commandTimerProgress");
const commandTimerHand = document.getElementById("commandTimerHand");
function updateCommandTimer(remainingFraction) {
    if (!commandTimerProgress) return;
    const fraction = Math.max(0, Math.min(1, remainingFraction));
    const cx = 20, cy = 20, radius = 17;
    if (fraction >= 0.99999) {
        commandTimerProgress.setAttribute("d", `M ${cx} ${cy-radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy+radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy-radius} Z`);
        commandTimerHand.setAttribute("visibility", "hidden");
    } else if (fraction <= 0) {
        commandTimerProgress.setAttribute("d", "");
        commandTimerHand.setAttribute("visibility", "hidden");
    } else {
        // The blue sector shrinks from its clockwise edge; its boundary travels
        // counterclockwise toward 12 o'clock as the command window expires.
        const angle = -Math.PI / 2 + fraction * 2 * Math.PI;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        const largeArc = fraction > 0.5 ? 1 : 0;
        commandTimerProgress.setAttribute("d", `M ${cx} ${cy} L ${cx} ${cy-radius} A ${radius} ${radius} 0 ${largeArc} 1 ${x} ${y} Z`);
        commandTimerHand.setAttribute("x2", String(x));
        commandTimerHand.setAttribute("y2", String(y));
        commandTimerHand.setAttribute("visibility", "visible");
    }
}

let commandActive = false, commandGeneration = 0, commandInterval = null;
let commandModel = null, commandStream = null;
// Warm the command recognizer without acquiring a microphone or starting listening.
// The adapter shares one loading promise with subsequent Go/Stop and Yes/No use.
function preloadCommandModel() {
    if (!getSettings().audioCommands) return;
    void loadCommands().then(model => {
        commandModel = model;
    }).catch(error => {
        // A failed preload must never prevent recording or a later retry.
        console.warn("Command model preload unavailable; will retry when needed:", error);
    });
}

// Spoken responses are serialized by one dedicated audio manager.
async function sayResponse(name) {
    const result = await playSpokenResponse(name);
    if (!result.ok) {
        console.warn(`Voice response ${name} could not be heard:`, result.error);
        setWakeStatus(`Voice prompt unavailable. Voice commands may still work.`);
    }
    return result.ok;
}
function closeCommandWindow({ restorePauseReminder = true } = {}) {
    commandActive = false;
    ++commandGeneration;
    if (commandInterval !== null) clearInterval(commandInterval);
    commandInterval = null;
    commandIndicator.hidden = true;
    const pausedSession = activeSession;
    if (pausedSession) stopPausedBeep(pausedSession);
    // Do not play a pause reminder when transitioning to Resume or Stop.
    if (restorePauseReminder && pausedSession && !pausedSession.discard &&
        pausedSession.recorder.state === "paused" &&
        pausedSession.metadata.state !== "finalizing") {
        startPausedBeep(pausedSession);
    }
    const shutdown = stopCommands(commandModel);
    void shutdown.catch(error => console.warn("Cannot stop command listener:", error));
    return shutdown;
}

// Both voice Go and the manual button must await command shutdown before capture resumes.
async function resumeAfterCommandShutdown(current) {
    if (activeSession !== current || current.discard || current.recorder.state !== "paused") return;
    const shutdown = closeCommandWindow({ restorePauseReminder: false });
    try {
        await shutdown;
        if (activeSession !== current || current.discard || current.recorder.state !== "paused" ||
            current.metadata.state === "finalizing") return;
        current.recorder.resume();
        status.textContent = "Resuming recording...";
    } catch (error) {
        console.error("Command listener did not shut down; recording remains paused:", error);
        if (activeSession === current && current.recorder.state === "paused") {
            startPausedBeep(current);
            status.textContent = "Could not safely resume. Recording remains paused; check voice commands.";
        }
    }
}

// Voice Stop is provisional until an explicit Yes is recognized.
// The original recorder remains paused and all persisted chunks are untouched.
async function confirmVoiceStop(current) {
    if (activeSession !== current || current.discard || current.recorder.state !== "paused") return;
    commandActive = true;
    const generation = ++commandGeneration;
    if (commandInterval !== null) clearInterval(commandInterval);
    commandInterval = null;
    stopPausedBeep(current);
    clearWakeDetectorTimers(current);
    commandIndicator.hidden = true;
    setWakeStatus("Preparing stop confirmation…");
    try {
        // Do not overlap listeners: wait until Go/Stop has completely released TensorFlow.
        await stopCommands(commandModel);
        if (generation !== commandGeneration || activeSession !== current || !commandActive) return;
        // Preload/model preparation is allowed; speech recognition is NOT running during playback.
        commandModel = await loadCommands();
        if (generation !== commandGeneration || activeSession !== current || !commandActive) return;
        const heard = await sayResponse("confirmStop");
        if (generation !== commandGeneration || activeSession !== current || !commandActive) return;
        if (!heard) throw new Error("Stop confirmation prompt could not be played.");
        // Starting a fresh listener AFTER playback prevents its audio windows from
        // including the spoken Yes/No prompt. No artificial post-prompt delay.
        const seconds = getSettings().commandWindow;
        let expiresAt = Infinity;
        commandIndicator.firstChild.textContent = "Listening for Yes or No ";
        commandIndicator.hidden = false;
        updateCommandTimer(1);
        setWakeStatus("Say “Yes” to stop or “No” to stay paused.");
        await startCommands(commandModel, current.stream, effectiveOverlap(deviceClass), scores => {
            if (generation !== commandGeneration || !commandActive || performance.now() >= expiresAt) return;
            const settings = getSettings();
            if (scores.top === "yes" && scores.yes >= settings.yesThreshold) {
                closeCommandWindow({ restorePauseReminder: false });
                finalizeRecording("voice-stop-confirmed-yes");
            } else if (scores.top === "no" && scores.no >= settings.noThreshold) {
                closeCommandWindow();
                if (activeSession === current && current.recorder.state === "paused") {
                    void sayResponse("pause");
                    scheduleWakeDetectorArm(current, 0);
                    setWakeStatus("Stop cancelled. Recording paused.");
                }
            }
        });
        if (generation !== commandGeneration || !commandActive) return;
        expiresAt = performance.now() + seconds * 1000;
        commandInterval = window.setInterval(() => {
            if (generation !== commandGeneration || !commandActive) return;
            const remaining = Math.max(0, (expiresAt - performance.now()) / 1000);
            updateCommandTimer(remaining / seconds);
            if (remaining === 0) {
                closeCommandWindow();
                if (activeSession === current && current.recorder.state === "paused") {
                    void sayResponse("pause");
                    scheduleWakeDetectorArm(current, 0);
                    setWakeStatus("No response received. Recording paused.");
                }
            }
        }, 100);
    } catch (error) {
        console.warn("Stop confirmation unavailable:", error);
        if (generation !== commandGeneration) return;
        closeCommandWindow();
        if (activeSession === current && current.recorder.state === "paused") {
            void sayResponse("pause");
            scheduleWakeDetectorArm(current, 0);
            setWakeStatus("Stop not confirmed. Recording paused.");
        }
    }
}

async function handleWakeDetected(current) {
    if (!getSettings().audioCommands || commandActive || activeSession !== current || !current.wakeDetectorEnabled) return;
    commandActive = true;
    // Silence the periodic double beep throughout the wake acknowledgement,
    // model preparation, and Go/Stop listening window.
    stopPausedBeep(current);
    const generation = ++commandGeneration;
    clearWakeDetectorTimers(current);
    const wasRecording = current.recorder.state === "recording";
    if (wasRecording) {
        // The pause event owns the spoken acknowledgement for every pause cause.
        // Wait for it before opening TensorFlow's command window.
        let resolveAnnouncement;
        current.pauseAnnouncement = new Promise(resolve => { resolveAnnouncement = resolve; });
        current.resolvePauseAnnouncement = resolveAnnouncement;
        try { current.recorder.pause(); }
        catch (error) {
            current.resolvePauseAnnouncement?.();
            current.resolvePauseAnnouncement = null;
            console.warn("Wake pause failed", error);
            closeCommandWindow();
            return;
        }
    }
    setWakeStatus(`Wake word detected. Preparing voice commands…`);
    if (wasRecording) await current.pauseAnnouncement;
    else await sayResponse("yes");
    if (generation !== commandGeneration || !commandActive || activeSession !== current) return;
    try {
        commandModel = await loadCommands();
        if (generation !== commandGeneration || !commandActive) return;
        commandStream = current.stream;
        const seconds = getSettings().commandWindow;
        const expiresAt = performance.now() + seconds * 1000;
        commandIndicator.firstChild.textContent = "Listening for Go or Stop ";
        commandIndicator.hidden = false;
        updateCommandTimer(1);
        await startCommands(commandModel, commandStream, effectiveOverlap(deviceClass), scores => {
            if (generation !== commandGeneration || !commandActive || performance.now() >= expiresAt) return;
            const settings = getSettings();
            const command = scores.top === "go" && scores.go >= settings.goThreshold ? "go"
                : scores.top === "stop" && scores.stop >= settings.stopThreshold ? "stop" : null;
            if (!command) return;
            if (command === "go") {
                void resumeAfterCommandShutdown(current);
            } else {
                // Do NOT close the command window here: closeCommandWindow() starts
                // an unawaited recognizer shutdown and restarts pause beeps.
                // Confirmation owns the one awaited shutdown and keeps the
                // recording paused throughout the transition.
                void confirmVoiceStop(current);
            }
        });
        if (generation !== commandGeneration || !commandActive) return;
        commandInterval = setInterval(() => {
            if (generation !== commandGeneration || !commandActive) return;
            const remaining = Math.max(0, (expiresAt - performance.now()) / 1000);
            updateCommandTimer(remaining / seconds);
            if (remaining === 0) {
                closeCommandWindow();
                if (activeSession === current) scheduleWakeDetectorArm(current, 0);
                setWakeStatus(`No command heard. Listening for “${wakeWordPhrase}”.`);
            }
        }, 100);
    } catch (error) {
        console.warn("TensorFlow command recognition failed:", error);
        closeCommandWindow();
        if (activeSession === current) scheduleWakeDetectorArm(current, 0);
        setWakeStatus(`Voice commands unavailable. Use the recording buttons.`);
    }
}

function resetWakeAudioBuffer(current) {
    current.wakeRingPos = 0;
    current.wakeCollectedSamples = 0;
    if (current.wakeRing) current.wakeRing.fill(0);
    if (wakeWord?.engine?.reset) {
        try { wakeWord.engine.reset(); } catch (error) {
            console.warn("Could not reset wake inference state:", error);
        }
    }
}

function scheduleWakeDetectorArm(current, delayMs = 650) {
    current.wakeDetectorEnabled = false;
    if (current.wakeRearmTimer !== null) {
        window.clearTimeout(current.wakeRearmTimer);
        current.wakeRearmTimer = null;
    }
    if (!getSettings().audioCommands || !wakeWord || !current.wakeRing) {
        setWakeStatus(!getSettings().audioCommands ? "Audio commands disabled." : wakeWordLoadError
            ? "Voice commands unavailable. Use the Record button to resume."
            : "Preparing voice commands. You can resume manually.");
        return;
    }
    current.wakeRearmTimer = window.setTimeout(() => {
        current.wakeRearmTimer = null;
        if (
            activeSession !== current ||
            current.discard ||
            !["paused", "recording"].includes(current.recorder.state) ||
            !wakeWord || !getSettings().audioCommands || commandActive
        ) return;

        resetWakeAudioBuffer(current);
        current.wakeDetectorEnabled = true;
        setWakeStatus(
            `Listening for “${wakeWordPhrase}”.`
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
        !["paused", "recording"].includes(current.recorder.state) ||
        !current.wakeRing
    ) return;

    const engine = wakeWord.engine;
    current.wakeInferenceBusy = true;
    try {
        if(selectedWakeEngine==="heed"){
          const needed=2048;
          if(current.wakeCollectedSamples<needed)return;
          const raw=new Float32Array(needed);
          const start=(current.wakeRingPos-needed+current.wakeRing.length)%current.wakeRing.length;
          for(let i=0;i<needed;i++)raw[i]=current.wakeRing[(start+i)%current.wakeRing.length];
          const result=await engine.consume(raw,sampleRate);
          if(result?.triggered && current.wakeDetectorEnabled && activeSession === current) {
            void handleWakeDetected(current);
          }
          return;
        }
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
            !["paused", "recording"].includes(current.recorder.state)
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

        if (detected && activeSession === current && current.wakeDetectorEnabled) {
            void handleWakeDetected(current);
        }
    } catch (error) {
        current.wakeDetectorEnabled = false;
        console.warn("Wake-word inference failed:", error);
        setWakeStatus(`Voice detection stopped. Use the recording buttons.`);
    } finally {
        current.wakeInferenceBusy = false;
    }
}

async function requestScreenWakeLock() {
    if (!activeSession) return;
    if (!("wakeLock" in navigator)) {
        setLifecycleStatus(
            "Screen lock prevention unavailable. Keep iMuse visible while recording."
        );
        return;
    }
    if (document.visibilityState !== "visible") {
        setLifecycleStatus(
            "iMuse is in the background. Recording or voice detection may be interrupted."
        );
        return;
    }
    if (screenWakeLock && !screenWakeLock.released) {
        setLifecycleStatus("Screen will stay awake while iMuse is visible.");
        return;
    }
    try {
        const sentinel = await navigator.wakeLock.request("screen");
        screenWakeLock = sentinel;
        sentinel.addEventListener("release", () => {
            if (screenWakeLock === sentinel) screenWakeLock = null;
            if (activeSession) {
                setLifecycleStatus(
                    "Screen lock prevention ended. Keep iMuse visible while recording."
                );
            }
        }, { once: true });
        setLifecycleStatus(
            "Screen will stay awake while iMuse is visible."
        );
    } catch (error) {
        setLifecycleStatus(
            `Could not prevent screen locking. Keep iMuse visible while recording.`
        );
    }
}

async function releaseScreenWakeLock() {
    const sentinel = screenWakeLock;
    screenWakeLock = null;
    if (sentinel && !sentinel.released) {
        try { await sentinel.release(); } catch (_) {}
    }
    setLifecycleStatus("Screen lock prevention inactive.");
}

function handleVisibilityChange() {
    if (activeSession) logRecordingEvent(activeSession, "visibility-change", { visibility: document.visibilityState });

    if (!activeSession) {
        setLifecycleStatus("Screen lock prevention activates during recording when available.");
        return;
    }
    if (document.visibilityState === "visible") {
        setLifecycleStatus("iMuse is active. Checking microphone and screen settings…");
        activeSession.awaitingForegroundChunk = true;
        scheduleForegroundCaptureSnapshots(activeSession);
        if (activeSession.audioContext?.state === "suspended") {
            activeSession.audioContext.resume().then(() => {
                if (
                    activeSession &&
                    ["paused", "recording"].includes(activeSession.recorder.state) &&
                    wakeWord
                ) {
                    scheduleWakeDetectorArm(activeSession, 0);
                }
            }).catch(error => {
                console.warn("Could not resume Web Audio after visibility change:", error);
                setLifecycleStatus("Audio processing could not resume. Check microphone access.");
            });
        } else if (["paused", "recording"].includes(activeSession.recorder.state) && wakeWord) {
            scheduleWakeDetectorArm(activeSession, 0);
        }
        requestScreenWakeLock();
    } else {
        setLifecycleStatus(
            "iMuse is in the background. Audio capture or voice commands may be interrupted."
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
            if (current.wakeDetectorEnabled && ["paused", "recording"].includes(current.recorder.state)) {
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
                        "Microphone input interrupted. Unlock your device and check that recording resumes."
                    );
                }
                return;
            }
            if (current.micUnavailableNotice) {
                current.micUnavailableNotice = false;
                setLifecycleStatus("Microphone input restored.");
            }

            analyser.getFloatTimeDomainData(current.audioSamples);
            let sumSquares = 0;
            for (const sample of current.audioSamples) {
                sumSquares += sample * sample;
            }
            const rms = Math.sqrt(sumSquares / current.audioSamples.length);

            if (rms >= currentSilenceRmsThreshold()) {
                current.silenceSince = null;
                return;
            }

            if (current.silenceSince === null) {
                current.silenceSince = Date.now();
                return;
            }

            if (Date.now() - current.silenceSince >= current.silencePauseMs) {
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
        setWakeStatus("Voice detection unavailable. Manual recording is still available.");
    }
}

async function playPausedBeep(current) {
    const context = current.audioContext;
    if (!context || context.state === "closed" || commandActive ||
        activeSession !== current || current.recorder.state !== "paused") return;

    // Keep wake-word detection active while the reminder tone plays.
    try {
        if (context.state === "suspended") await context.resume();
        if (context.state !== "running" || commandActive ||
            activeSession !== current || current.recorder.state !== "paused") return;

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
    if (commandActive || activeSession !== current || current.discard ||
        current.recorder.state !== "paused") return;
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

function retainEmergencyRecording(current, blob) {
    if (!blob?.size) return;
    // A later storage read may fail or return only a prefix. Never replace a
    // fuller retained assembly with that smaller fallback.
    const previous = emergencyRecordings.get(current.id);
    if (previous && previous.blob.size > blob.size) return;
    emergencyRecordings.set(current.id, {
        blob,
        metadata: { ...current.metadata },
        unsavedBytes: [...current.pendingChunks.values()].reduce((sum, chunk) => sum + chunk.size, 0)
    });
    void renderRecoverableSessions().catch(error => console.error("Could not refresh recordings:", error));
    if (current.simulatedStorageFailure && preservationTestResult) {
        const unsavedBytes = [...current.pendingChunks.values()].reduce((sum, chunk) => sum + chunk.size, 0);
        preservationTestResult.textContent = `Simulated failure completed. Emergency audio contains ${blob.size} bytes, including ${unsavedBytes} bytes not saved to browser storage. Make a second recording, then load and download this emergency recording again. Keep this page open.`;
    }
}

function playEmergencyRecording(id, present = showPlayback) {
    const emergency = emergencyRecordings.get(id);
    if (!emergency) return false;
    present(emergency.blob, id);
    status.textContent = emergency.unsavedBytes
        ? "Available audio loaded, including unsaved audio. Download it before closing or reloading iMuse and check for missing sections."
        : "Recovery audio loaded. Finalization was delayed; check for missing sections and download before closing or reloading iMuse.";
    return true;
}

function setAudioCommandsToggleLocked(locked) {
    const toggle = document.getElementById("audioCommandsToggle");
    if (toggle) {
        toggle.disabled = locked;
        toggle.title = locked ? "Stop this recording before changing Audio commands." : "";
    }
}

function setReadyUI() {
    setAudioCommandsToggleLocked(false);
    setMicrophoneSelectionLocked(false); setSilencePauseLocked(false);
    setRecordingControlState("idle");
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

function closeSavedPlayback() {
    if (!savedPlayback) return;
    const previous = savedPlayback;
    savedPlayback = null;
    previous.player.pause();
    previous.player.removeAttribute("src");
    previous.player.load();
    URL.revokeObjectURL(previous.url);
    if (previous.dialog.open && typeof previous.dialog.close === "function") previous.dialog.close();
    previous.dialog.remove();
}

function showSavedPlayback(blob, id) {
    closeSavedPlayback();
    audioPlayer.pause();
    const dialog = document.createElement("dialog");
    dialog.className = "saved-audio-dialog";
    dialog.setAttribute("aria-label", "Saved recording player");
    const heading = document.createElement("h3");
    heading.textContent = "Saved recording";
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "metadata";
    const url = URL.createObjectURL(blob);
    player.src = url;
    player.type = blob.type || "audio/webm";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", closeSavedPlayback);
    dialog.addEventListener("close", () => {
        if (savedPlayback?.dialog === dialog) closeSavedPlayback();
    });
    dialog.append(heading, player, close);
    savedPlayback = { id, player, dialog, url };
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
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

function assembleSavedAudio(item, chunks, receivedCount) {
    const { parts, report } = inspectRecordingChunks(item, chunks, receivedCount);
    const blob = new Blob(parts, { type: item.mimeType || parts.find(part => part.type)?.type || "application/octet-stream" });
    if (!blob.size) {
        const error = new Error("No saved audio chunks are available.");
        error.integrityReport = report;
        throw error;
    }
    return { blob, report };
}

function integrityNotice(report) {
    return report.ok ? "" : ` Audio may be incomplete: ${report.issues.join("; ")}.`;
}

async function exportSavedSession(id, button) {
    if (button) button.disabled = true;
    try {
        const emergency = emergencyRecordings.get(id);
        if (emergency) {
            downloadAudioBlob(emergency.blob, sessionFilename(emergency.metadata));
            status.textContent = "Emergency download started. Check the exported audio before closing or reloading iMuse; the emergency copy remains available here.";
            return;
        }
        await recordingStorage.run(async () => {
            assertSessionIdle(id);
            const item = await boundedStorageRead(getSession(id));
            if (!item || item.state === "deleted") throw new Error("This session is unavailable. Restore a deleted recording before loading it.");
            const chunks = await boundedStorageRead(getChunks(id));
            const { blob, report } = assembleSavedAudio(item, chunks);
            downloadAudioBlob(blob, sessionFilename(item));
            status.textContent = `Download started.${integrityNotice(report)} Check the exported audio before deleting the original.`;
        });
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
            status.textContent = "Download started. Check the exported audio before deleting the original.";
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
    document.getElementById("savedRecordingsLocation").appendChild(recoveryPanel);
    return recoveryPanel;
}

function formatDate(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function formatRecordingSize(bytes) {
    return `${(Math.max(0, Number(bytes) || 0) / 1024).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
}

async function renderRecoverableSessions() {
    const panel = ensureRecoveryPanel();
    let allSessions = [], readError = null;
    try { if (db) allSessions = await boundedStorageRead(getAllSessions()); }
    catch (error) { readError = error; }
    const available = new Map(allSessions.filter(item =>
        ["completed", "recording", "paused", "interrupted", "finalizing", "storage-error"].includes(item.state)
    ).map(item => [item.id, item]));
    for (const [id, emergency] of emergencyRecordings) {
        available.set(id, { ...emergency.metadata, id, state: "storage-error" });
    }
    const sessions = [...available.values()].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    const deletedSessions = allSessions.filter(item => item.state === "deleted" && !emergencyRecordings.has(item.id))
        .sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
    panel.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Saved recordings";
    heading.style.fontSize = "1.1rem";
    panel.appendChild(heading);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Refresh recordings";
    refresh.addEventListener("click", () => {
        void renderRecoverableSessions().catch(error => console.error(error));
    });
    panel.appendChild(refresh);
    panel.hidden = !sessions.length && !deletedSessions.length && !readError;
    if (readError) {
        const notice = document.createElement("p");
        notice.textContent = "Saved recordings could not be read. Any available emergency audio is listed below. Browser data has not been cleared.";
        panel.appendChild(notice);
    }
    if (sessions.length) {
        const explanation = document.createElement("p");
        explanation.textContent = "Saved recordings remain available after reopening. Interrupted audio may be incomplete.";
        panel.appendChild(explanation);
    }
    for (const item of sessions) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.flexWrap = "wrap";
        row.style.alignItems = "center";
        row.style.gap = "0.5rem";
        row.style.marginTop = "0.5rem";
        const label = document.createElement("span");
        label.style.flex = "1 1 12rem";
        const emergency = emergencyRecordings.get(item.id);
        const busy = !emergency && (writingSessions.has(item.id) || ["recording", "paused", "finalizing"].includes(item.state));
        label.textContent = emergency
            ? `${formatDate(item.startedAt)} — ${formatRecordingSize(emergency.blob.size)}. ${emergency.unsavedBytes ? "Includes unsaved audio" : "Recovery copy; finalization was delayed"}; download before closing or reloading.`
            : `${formatDate(item.startedAt)} — ${formatRecordingSize(item.bytesStored)}${busy ? " — recording or finishing" : ""}`;
        if (item.integrityReport?.ok === false) label.textContent += " — audio may be incomplete";
        else if (item.state === "interrupted") label.textContent += " — interrupted recording";
        row.appendChild(label);
        const recoverButton = document.createElement("button");
        recoverButton.type = "button";
        recoverButton.textContent = "▶";
        recoverButton.className = "saved-audio-open";
        recoverButton.title = "Open audio player";
        recoverButton.setAttribute("aria-label", `Play recording from ${formatDate(item.startedAt)}`);
        recoverButton.setAttribute("aria-haspopup", "dialog");
        recoverButton.disabled = busy;
        recoverButton.addEventListener("click", () => {
            void loadRecording(item.id, recoverButton);
        });
        row.appendChild(recoverButton);
        const downloadButton = document.createElement("button");
        downloadButton.type = "button";
        downloadButton.textContent = "Download audio";
        downloadButton.disabled = busy;
        downloadButton.addEventListener("click", () => exportSavedSession(item.id, downloadButton));
        row.appendChild(downloadButton);
        const discardButton = document.createElement("button");
        discardButton.type = "button";
        discardButton.textContent = "Delete";
        discardButton.disabled = busy || !!emergency;
        discardButton.addEventListener("click", async () => {
            discardButton.disabled = true;
            try {
                await moveSessionToRecentlyDeleted(item.id);
                if (savedPlayback?.id === item.id) closeSavedPlayback();
                // Saved-list actions leave the current in-memory player intact.
                status.textContent = "Recording moved to Recently Deleted. It can be restored.";
                await renderRecoverableSessions();
            } catch (error) {
                console.error(error);
                status.textContent = "Could not move the recording to Recently Deleted.";
                discardButton.disabled = false;
            }
        });
        row.appendChild(discardButton);
        // Keep stop diagnostics available for every saved recording: an
        // unexpected stop may still leave a session marked completed.
        // Keep this secondary action last in the row.
        {
            const diagnosticButton = document.createElement("button");
            diagnosticButton.type = "button";
            diagnosticButton.textContent = "↓";
            diagnosticButton.className = "recording-diagnostic-download";
            diagnosticButton.title = "Download stop diagnostics";
            diagnosticButton.setAttribute("aria-label", "Download stop diagnostics");
            diagnosticButton.addEventListener("click", () => {
                downloadRecordingEvents(item.id).catch(error => {
                    console.error("Could not export diagnostics:", error);
                    status.textContent = "Could not export recording diagnostics.";
                });
            });
            const diagnostics = document.createElement("span");
            diagnostics.className = "recording-diagnostic-action";
            const description = document.createElement("span");
            description.textContent = "Stop diagnostics";
            diagnostics.append(diagnosticButton, description);
            row.appendChild(diagnostics);

        }
        panel.appendChild(row);
    }
    if (deletedSessions.length) {
        const section = document.createElement("section");
        section.setAttribute("aria-label", "Recently Deleted recordings");
        const heading = document.createElement("h3");
        heading.textContent = `Recently Deleted (${deletedSessions.length})`;
        section.appendChild(heading);
        const note = document.createElement("p");
        note.textContent = "Deleted recordings remain in browser storage until permanently deleted. Browser storage is not a guaranteed backup.";
        section.appendChild(note);
        const selectionBar = document.createElement("div");
        selectionBar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:.75rem 0";
        const selectAllLabel = document.createElement("label");
        selectAllLabel.style.cssText = "display:inline-flex;align-items:center;gap:.35rem";
        const selectAll = document.createElement("input");
        selectAll.type = "checkbox";
        selectAll.setAttribute("aria-label", "Select all recently deleted recordings");
        selectAllLabel.append(selectAll, document.createTextNode("Select all"));
        const selectionCount = document.createElement("span");
        const deleteSelectedButton = document.createElement("button");
        deleteSelectedButton.type = "button";
        deleteSelectedButton.textContent = "Delete selected permanently";
        const selectedIds = new Set();
        const selectionBoxes = [];
        function updateSelection() {
            selectionCount.textContent = `${selectedIds.size} selected`;
            deleteSelectedButton.disabled = selectedIds.size === 0;
            selectAll.checked = selectedIds.size === deletedSessions.length;
            selectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < deletedSessions.length;
        }
        selectAll.addEventListener("change", () => {
            selectedIds.clear();
            for (const checkbox of selectionBoxes) {
                checkbox.checked = selectAll.checked;
                if (checkbox.checked) selectedIds.add(checkbox.value);
            }
            updateSelection();
        });
        deleteSelectedButton.addEventListener("click", async () => {
            const ids = [...selectedIds];
            if (!ids.length) return;
            if (!window.confirm(`Permanently delete ${ids.length} selected recording${ids.length === 1 ? "" : "s"} and all their saved audio? This cannot be undone.`)) return;
            deleteSelectedButton.disabled = true;
            selectAll.disabled = true;
            for (const checkbox of selectionBoxes) checkbox.disabled = true;
            let deleted = 0;
            const failures = [];
            for (const id of ids) {
                try {
                    const current = await getSession(id);
                    if (!current || current.state !== "deleted") throw new Error("Recording is no longer in Recently Deleted.");
                    await deleteSessionData(id);
                    if (savedPlayback?.id === id) closeSavedPlayback();
                    deleted++;
                } catch (error) {
                    console.error("Could not permanently delete selected recording:", error);
                    failures.push(id);
                }
            }
            status.textContent = failures.length
                ? `${deleted} recording(s) permanently deleted; ${failures.length} could not be deleted and remain available.`
                : `${deleted} recording(s) permanently deleted.`;
            try {
                await renderRecoverableSessions();
            } catch (error) {
                console.error("Could not refresh recordings after deletion:", error);
                status.textContent += " Refresh the page to update the list.";
                selectAll.disabled = false;
                for (const checkbox of selectionBoxes) checkbox.disabled = false;
                updateSelection();
            }
        });
        selectionBar.append(selectAllLabel, selectionCount, deleteSelectedButton);
        section.appendChild(selectionBar);
        updateSelection();
        for (const item of deletedSessions) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.5rem";
            const selectionBox = document.createElement("input");
            selectionBox.type = "checkbox";
            selectionBox.value = item.id;
            selectionBox.setAttribute("aria-label", `Select recording from ${formatDate(item.startedAt)} for permanent deletion`);
            selectionBox.addEventListener("change", () => {
                if (selectionBox.checked) selectedIds.add(item.id);
                else selectedIds.delete(item.id);
                updateSelection();
            });
            selectionBoxes.push(selectionBox);
            row.appendChild(selectionBox);
            const label = document.createElement("span");
            label.style.flex = "1 1 12rem";
            label.textContent = `${formatDate(item.startedAt)} — ${formatRecordingSize(item.bytesStored)} — deleted ${formatDate(item.deletedAt)}`;
            row.appendChild(label);
            const restoreButton = document.createElement("button");
            restoreButton.type = "button";
            restoreButton.textContent = "Restore";
            restoreButton.addEventListener("click", async () => {
                restoreButton.disabled = true;
                try {
                    await restoreRecentlyDeletedSession(item.id);
                    status.textContent = "Recording restored to Saved recordings.";
                    await renderRecoverableSessions();
                } catch (error) {
                    status.textContent = `Could not restore recording: ${error.message || error}`;
                    restoreButton.disabled = false;
                }
            });
            row.appendChild(restoreButton);
            const permanentButton = document.createElement("button");
            permanentButton.type = "button";
            permanentButton.textContent = "Delete Permanently";
            permanentButton.addEventListener("click", async () => {
                if (!window.confirm("Permanently delete this recording and its saved audio? This cannot be undone.")) return;
                permanentButton.disabled = true;
                try {
                    const current = await getSession(item.id);
                    if (!current || current.state !== "deleted") throw new Error("Recording is no longer in Recently Deleted.");
                    await deleteSessionData(item.id);
                    if (savedPlayback?.id === item.id) closeSavedPlayback();
                    status.textContent = "Recording permanently deleted.";
                    await renderRecoverableSessions();
                } catch (error) {
                    status.textContent = `Could not permanently delete recording: ${error.message || error}`;
                    permanentButton.disabled = false;
                }
            });
            row.appendChild(permanentButton);
            section.appendChild(row);
        }
        panel.appendChild(section);
    }
}

async function loadRecording(id, button) {
    const request = ++savedPlaybackRequest;
    return recoverSession(id, button, (blob, sessionId) => {
        if (request === savedPlaybackRequest) showSavedPlayback(blob, sessionId);
    });
}

async function playSavedSession(id, button) {
    return recoverSession(id, button);
}

async function recoverSession(id, button, present = showPlayback) {
    button.disabled = true;
    status.textContent = "Recovering saved audio...";
    try {
        // Do not replace an emergency assembly with only its committed prefix,
        // or promote the partial browser copy to a completed recording.
        if (playEmergencyRecording(id, present)) {
            button.disabled = false;
            return;
        }
        await recordingStorage.run(async () => {
            assertSessionIdle(id);
            const item = await boundedStorageRead(getSession(id));
            if (!item || item.state === "deleted") throw new Error("This session is unavailable. Restore a deleted recording before loading it.");
            const chunks = await boundedStorageRead(getChunks(id));
            const { blob, report } = assembleSavedAudio(item, chunks);
            // Recover availability, not a claim of uninterrupted capture.
            const state = item.state === "completed" && report.ok ? "completed" : "interrupted";
            await putSessionNow({
                ...item,
                state,
                recoveredFromState: item.recoveredFromState || item.state,
                integrityReport: report,
                recoveredAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString()
            });
            present(blob, id);
            status.textContent = state === "completed"
                ? "Recording loaded. Saved chunks passed structural checks; check playback."
                : `Available audio loaded from an interrupted recording.${integrityNotice(report)} Check playback for missing sections.`;
            await renderRecoverableSessions();
        });
    } catch (error) {
        console.error("Recovery failed:", error);
        status.textContent = `Could not recover audio: ${error.message || "unknown error"}`;
    } finally {
        button.disabled = false;
    }
}

async function initialize() {
    try {
        if (!("indexedDB" in window)) throw new Error("IndexedDB is not available in this browser.");
        db = await openDatabase();
        try {
            await recordingStorage.run(async () => {
                const sessions = await getAllSessions();
                for (const item of sessions) {
                    if (["recording", "paused", "finalizing"].includes(item.state)) {
                        item.state = "interrupted";
                        item.interruptedAt = new Date().toISOString();
                        await putSessionNow(item);
                    }
                }
            });
        } catch (error) {
            status.textContent = `Saved audio remains available. ${error.message || error}`;
        }
        await renderRecoverableSessions();
    } catch (error) {
        console.error("Recording recovery initialization failed:", error);
        status.textContent = "Recording storage unavailable. Recording cannot start safely.";
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

async function startRecording() {
    if (writingSessions.size) {
        status.textContent = "The previous recording is still finishing. Use its available audio below and keep this page open.";
        return;
    }
    setMicrophoneSelectionLocked(true);
    setSilencePauseLocked(true);
    setRecordingControlState("preparing");

    // Hide the previous player. Committed audio remains in IndexedDB;
    // emergency audio remains independently accessible in emergencyRecordings.
    clearPlayback();

    if (!db) {
        setMicrophoneSelectionLocked(false); setSilencePauseLocked(false);
        status.textContent = "IndexedDB is unavailable, so durable recording cannot start safely.";
        return;
    }
    const requestId = ++startRequest;
    setRecordingControlState("preparing");
    status.textContent = "Preparing microphone...";
    let stream;
    let recordingLease = null, recorderStarted = false, newSessionId = null;
    try {
        recordingLease = await recordingStorage.hold();
        stream = await acquireRecordingMicrophone();
        publishMicrophoneProcessing(stream);
        if (requestId !== startRequest) {
            stopStream(stream);
            setMicrophoneSelectionLocked(false); setSilencePauseLocked(false);
            return;
        }
        const recorderChoice = createCompatibleRecorder(stream);
        const recorder = recorderChoice.recorder;
        const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        newSessionId = id;
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
            setMicrophoneSelectionLocked(false); setSilencePauseLocked(false);
            return;
        }
        const current = {
            id, recorder, stream, metadata, recordingLease,
            formatLabel,
            sequence: 0,
            writeQueue: Promise.resolve(),
            persistenceError: null,
            pendingChunks: new Map(),
            pendingBytes: 0,
            peakPendingBytes: 0,
            recordedMs: 0,
            activeSinceMs: null,
            storageStopRequested: false,
            discard: false,
            stopHandled: false,
            stopIntent: null,
            diagnosticStartedAt: performance.now(),
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
            silencePauseMs: getSettings().silencePauseSeconds * 1000,
            autoPausing: false,
            pauseReason: null,
            pausedBeepTimer: null,
            micUnavailableNotice: false,
            lastChunkAtMs: null,
            lastChunkBytes: null
        };
        activeSession = current;
        writingSessions.add(id);
        logRecordingEvent(current, "session-created", { mimeType: actualMimeType });
        lastRecordingPeakBytes = 0;
        publishRecordingDiagnostics();
        // Freeze voice-command preference throughout this recording session.
        setAudioCommandsToggleLocked(true);

        const microphoneTrack = stream.getAudioTracks()[0];
        if (microphoneTrack) {
            microphoneTrack.addEventListener("mute", () => {
                logRecordingEvent(current, "microphone-muted");
                if (activeSession !== current || current.discard) return;
                current.micUnavailableNotice = true;
                current.silenceSince = null;
                setLifecycleStatus("Microphone input interrupted. Unlock your device and check that recording resumes.");
            });
            microphoneTrack.addEventListener("unmute", () => {
                logRecordingEvent(current, "microphone-unmuted");
                logCaptureSnapshot(current, "microphone-unmuted");
                if (activeSession !== current || current.discard) return;
                current.micUnavailableNotice = false;
                current.silenceSince = null;
                setLifecycleStatus("Microphone input restored.");
            });
            microphoneTrack.addEventListener("ended", () => {
                logRecordingEvent(current, "microphone-ended");
                if (activeSession !== current || current.discard) return;
                current.micUnavailableNotice = true;
                current.silenceSince = null;
                setLifecycleStatus("Microphone disconnected. Stop and start a new recording if input does not return.");
            });
        }
        recorder.addEventListener("start", () => {
            logRecordingEvent(current, "recorder-start");
            current.activeSinceMs = performance.now();
        });
        // Keep only audio awaiting a completed IndexedDB transaction in RAM.
        // If storage stalls or fails, stop capture rather than buffering indefinitely.
        recorder.addEventListener("dataavailable", event => {
            if (current.discard || !event.data || !event.data.size) return;
            const sequence = current.sequence++;
            const chunk = event.data;
            current.lastChunkAtMs = performance.now();
            current.lastChunkBytes = chunk.size;
            // Log only the first chunk after foreground return, not every chunk.
            if (current.awaitingForegroundChunk) {
                current.awaitingForegroundChunk = false;
                logRecordingEvent(current, "first-chunk-after-foreground", { bytes: chunk.size, sequence });
            }
            current.pendingChunks.set(sequence, chunk);
            current.pendingBytes += chunk.size;
            current.peakPendingBytes = Math.max(current.peakPendingBytes, current.pendingBytes);
            publishRecordingDiagnostics();

            if (current.pendingBytes > MAX_PENDING_AUDIO_BYTES && !current.storageStopRequested) {
                current.storageStopRequested = true;
                current.stopIntent = "storage-backpressure";
                logRecordingEvent(current, "stop-request", { source: current.stopIntent });
                current.persistenceError ||= new Error("Audio storage is not keeping up with recording.");
                status.textContent = "Audio storage is too slow. Stopping to protect the recording.";
                // Stop emits a final dataavailable event, which is also queued for storage.
                if (recorder.state !== "inactive") {
                    armFinalizationWatchdog(current);
                    try { recorder.stop(); } catch (error) { console.error("Automatic storage stop failed:", error); }
                }
            }

            current.writeQueue = current.writeQueue.then(async () => {
                if (current.discard || current.persistenceError && !current.storageStopRequested) return;
                // A backpressure stop is not itself a failed write: attempt to
                // commit every pending chunk, including the recorder's final chunk.
                if (current.persistenceError && current.storageStopRequested &&
                    current.persistenceError.message !== "Audio storage is not keeping up with recording.") return;
                await persistChunk(current, sequence, chunk);
                current.pendingChunks.delete(sequence);
                current.pendingBytes -= chunk.size;
                publishRecordingDiagnostics();
                if (!current.persistenceError && !current.stopHandled && !current.finalizationDelayed) {
                    const progress = `${savedChunkProgress(current)} to this browser`;
                    if (recorder.state === "recording") {
                        status.textContent = `Recording in ${current.formatLabel} — ${progress}.`;
                    } else if (recorder.state === "paused") {
                        status.textContent = `Paused — ${progress}. Press Record to resume.`;
                    }
                }
            }).catch(error => {
                if (!current.persistenceError || current.storageStopRequested) current.persistenceError = error;
                console.error("Audio chunk could not be persisted:", error);
                status.textContent = "Audio storage failed. Recording is stopping; do not close iMuse.";
                current.metadata.state = "storage-error";
                current.metadata.lastUpdatedAt = new Date().toISOString();
                putSession(current.metadata).catch(saveError => console.error("Could not update session state:", saveError));
                if (!current.storageStopRequested) {
                    current.storageStopRequested = true;
                    current.stopIntent = "storage-write-error";
                    logRecordingEvent(current, "stop-request", { source: current.stopIntent, error: String(error) });
                    if (recorder.state !== "inactive") {
                        armFinalizationWatchdog(current);
                        try { recorder.stop(); } catch (stopError) { console.error("Storage-failure stop failed:", stopError); }
                    }
                }
            });
        });
        recorder.addEventListener("error", event => {
            logRecordingEvent(current, "recorder-error", { error: String(event.error?.message || event.error || "unknown") });
            console.error("MediaRecorder error:", event.error || event);
            current.recorderError = String(event.error?.message || event.error || "unknown");
            current.metadata.recorderError = current.recorderError;
            current.metadata.interruptedAt ||= new Date().toISOString();
            current.metadata.interruptionReasons = [...new Set([...(current.metadata.interruptionReasons || []), "Recorder reported an error"])];
            current.metadata.state = "interrupted";
            putSession(current.metadata).catch(error => console.error(error));
            status.textContent = "Recording error. Preserving available audio; the recording may be incomplete.";
            setRecordingControlState("finalizing");
            armFinalizationWatchdog(current);
        });
        recorder.addEventListener("pause", async () => {
            logRecordingEvent(current, "recorder-pause", { reason: current.pauseReason || "unspecified" });
            if (activeSession !== current || current.discard) return;
            if (current.activeSinceMs !== null) {
                current.recordedMs += Math.max(0, performance.now() - current.activeSinceMs);
                current.activeSinceMs = null;
            }
            current.metadata.state = "paused";
            current.metadata.lastUpdatedAt = new Date().toISOString();
            try { await putSession(current.metadata); } catch (error) { console.error(error); }
            if (activeSession !== current || current.stopHandled) return;
            setRecordingControlState("paused");
            current.autoPausing = false;
            current.silenceSince = null;
            if (!commandActive) scheduleWakeDetectorArm(current, 0);
            startPausedBeep(current);
            // Announce each successful transition once. The periodic double beep remains.
            const pauseSpeech = sayResponse("pause");
            if (current.resolvePauseAnnouncement) {
                const resolve = current.resolvePauseAnnouncement;
                current.resolvePauseAnnouncement = null;
                void pauseSpeech.then(resolve, resolve);
            }
            status.textContent = current.pauseReason === "silence"
                ? `Paused automatically after silence — ${savedChunkProgress(current)}. Press Record to resume.`
                : `Paused — ${savedChunkProgress(current)}. Press Record to resume.`;
        });
        recorder.addEventListener("resume", async () => {
            logRecordingEvent(current, "recorder-resume");
            if (activeSession !== current || current.discard) return;
            current.activeSinceMs = performance.now();
            current.metadata.state = "recording";
            current.metadata.lastUpdatedAt = new Date().toISOString();
            try { await putSession(current.metadata); } catch (error) { console.error(error); }
            if (activeSession !== current || current.stopHandled) return;
            setRecordingControlState("recording");
            stopPausedBeep(current);
            if (!commandActive) scheduleWakeDetectorArm(current, 0);
            current.silenceSince = null;
            current.pauseReason = null;
            current.autoPausing = false;
            if (!commandActive) setWakeStatus(`Listening for “${wakeWordPhrase}”.`);
            status.textContent = `Recording resumed in ${current.formatLabel} — ${savedChunkProgress(current)} to this browser.`;
            void sayResponse("recording");
        });
        recorder.addEventListener("stop", async () => {
            logRecordingEvent(current, "recorder-stop", { classification: current.stopIntent || "UNEXPECTED-NO-STOP-REQUEST", stopIntent: current.stopIntent });
            if (current.stopHandled) return;
            current.stopHandled = true;
            current.metadata.receivedChunkCount = current.sequence;
            armFinalizationWatchdog(current);
            try {
                if (current.activeSinceMs !== null) {
                    current.recordedMs += Math.max(0, performance.now() - current.activeSinceMs);
                    current.activeSinceMs = null;
                }
                lastRecordingPeakBytes = current.peakPendingBytes;
                current.resolvePauseAnnouncement?.();
                current.resolvePauseAnnouncement = null;
                closeCommandWindow({ restorePauseReminder: false });
                cleanupAudioMonitor(current);
                stopStream(stream);
                if (activeSession === current) activeSession = null;
                publishRecordingDiagnostics();
                setAudioCommandsToggleLocked(false);
                setMicrophoneSelectionLocked(false); setSilencePauseLocked(false);
                releaseScreenWakeLock();
                setWakeStatus("Wake-word detector idle");
                if (current.discard) {
                    try { await current.writeQueue; } catch (_) { /* best effort; session is being deleted */ }
                    writingSessions.delete(id);
                    try { await deleteSessionData(id); } catch (error) { console.error("Could not delete discarded session:", error); }
                    return;
                }
                if (current.deleteRequested) {
                    try {
                        await current.writeQueue;
                        writingSessions.delete(id);
                        await moveSessionToRecentlyDeleted(id);
                        status.textContent = "Recording moved to Recently Deleted. It can be restored.";
                        await renderRecoverableSessions();
                    } catch (error) {
                        console.error("Could not preserve deleted recording:", error);
                        status.textContent = "Could not move recording to Recently Deleted. Check saved recordings before leaving this page.";
                    }
                    setReadyUI();
                    return;
                }
                setRecordingControlState("finalizing");
                status.textContent = "Finishing audio storage…";
                await current.writeQueue;
                let finalBlob;
                try {
                    if (current.persistenceError && !(current.storageStopRequested &&
                        current.persistenceError.message === "Audio storage is not keeping up with recording.")) {
                        throw current.persistenceError;
                    }
                    const savedChunks = await boundedStorageRead(getChunks(id));
                    const assembly = assembleSavedAudio(current.metadata, savedChunks, current.sequence);
                    finalBlob = assembly.blob;
                    Object.assign(current.metadata, recordingCompletion(current, assembly.report));
                    current.metadata.integrityReport = assembly.report;
                    current.metadata.lastUpdatedAt = new Date().toISOString();
                    if (current.metadata.state === "completed") current.metadata.completedAt = current.metadata.lastUpdatedAt;
                    else current.metadata.interruptedAt ||= current.metadata.lastUpdatedAt;
                    await putSession(current.metadata);
                    // The watchdog may have fired while the transaction ran.
                    if (current.finalizationDelayed && current.metadata.state === "completed") {
                        Object.assign(current.metadata, recordingCompletion(current, assembly.report));
                        current.metadata.interruptedAt ||= new Date().toISOString();
                        await putSession(current.metadata);
                    }
                    logRecordingEvent(current, "finalization-completed", { bytes: finalBlob.size, stopIntent: current.stopIntent, state: current.metadata.state, integrity: assembly.report });
                    if (current.pendingChunks.size) {
                        const combined = new Map(savedChunks.map(chunk => [chunk.sequence, chunk.blob]));
                        for (const [sequence, blob] of current.pendingChunks) combined.set(sequence, blob);
                        finalBlob = new Blob([...combined].sort((a, b) => a[0] - b[0]).map(([, blob]) => blob).filter(blob => blob?.size), { type: current.metadata.mimeType });
                        retainEmergencyRecording(current, finalBlob);
                    } else if (emergencyRecordings.has(id)) retainEmergencyRecording(current, finalBlob);
                    finalBlob = emergencyRecordings.get(id)?.blob || finalBlob;
                    showPlayback(finalBlob, id);
                    status.textContent = emergencyRecordings.get(id)?.unsavedBytes
                        ? `Recording was interrupted. Available audio includes unsaved data; download before closing or reloading.${integrityNotice(assembly.report)}`
                        : current.metadata.state === "completed"
                        ? "Received audio saved. Saved chunks passed structural checks; check playback."
                        : `Recording was interrupted. Available audio is saved.${integrityNotice(assembly.report)} Check playback for missing sections.`;
                } catch (error) {
                    logRecordingEvent(current, "finalization-error", { error: String(error) });
                    console.error("Could not finalize persisted recording:", error);
                    // Rebuild from committed chunks plus only the uncommitted tail.
                    // The latter is retained in RAM solely for emergency export.
                    let fallbackParts = [];
                    try {
                        const committed = await boundedStorageRead(getChunks(id));
                        const bySequence = new Map(committed.map(chunk => [chunk.sequence, chunk.blob]));
                        for (const [sequence, blob] of current.pendingChunks) bySequence.set(sequence, blob);
                        fallbackParts = [...bySequence.entries()].sort((a, b) => a[0] - b[0])
                            .map(([, blob]) => blob).filter(blob => blob && blob.size);
                    } catch (readError) {
                        console.error("Could not read committed audio for emergency playback:", readError);
                        fallbackParts = [...current.pendingChunks.entries()].sort((a, b) => a[0] - b[0])
                            .map(([, blob]) => blob);
                    }
                    finalBlob = new Blob(fallbackParts, { type: current.metadata.mimeType || fallbackParts.find(part => part.type)?.type || "application/octet-stream" });
                    if (finalBlob.size) {
                        retainEmergencyRecording(current, finalBlob);
                        showPlayback(emergencyRecordings.get(id).blob, id);
                    }
                    current.metadata.state = error.integrityReport ? "interrupted" : "storage-error";
                    current.metadata.finalizationError = String(error.message || error);
                    current.metadata.interruptedAt ||= new Date().toISOString();
                    current.metadata.interruptionReasons = [...new Set([...(current.metadata.interruptionReasons || []), "Finalization could not be verified"])];
                    if (error.integrityReport) current.metadata.integrityReport = error.integrityReport;
                    current.metadata.lastUpdatedAt = new Date().toISOString();
                    try { await putSession(current.metadata); } catch (saveError) { console.error(saveError); }
                    status.textContent = finalBlob.size
                        ? "Storage failed. Emergency audio is available; download it before closing iMuse and check for missing sections."
                        : "Recording could not be finalized. No playable audio was available.";
                }
                setReadyUI();
                // Announce stop only after the session has left the active recording state.
                void sayResponse("stopped");
                await renderRecoverableSessions();
            } finally {
                current.finalizationFinished = true;
                clearTimeout(current.finalizationTimer);
                await recordingLease?.release();
                writingSessions.delete(id);
                // The preceding render may still have shown a finishing session.
                void renderRecoverableSessions().catch(error => console.error(error));
            }
        });
        await setupSilenceMonitor(current);
        recorder.start(250);
        recorderStarted = true;

        setRecordingControlState("recording");
        status.textContent = `Recording… Audio is being saved on this device.`;

        if (getSettings().audioCommands) scheduleWakeDetectorArm(current, 0);
        else setWakeStatus("Audio commands disabled.");
        requestScreenWakeLock();
        // The new-recording announcement replaces the old single start beep.
        void sayResponse("newRecording");
    } catch (error) {

        console.error(error);
        stopStream(stream);
        setRecordingControlState("idle");
        if (!activeSession) { setAudioCommandsToggleLocked(false); setMicrophoneSelectionLocked(false); setSilencePauseLocked(false); }
        status.textContent = `Could not start durable recording: ${error.message || "microphone unavailable"}`;
    } finally {
        if (!recorderStarted) {
            if (activeSession?.id === newSessionId) {
                cleanupAudioMonitor(activeSession);
                activeSession = null;
            }
            writingSessions.delete(newSessionId);
            await recordingLease?.release();
        }
    }
}

recordButton.addEventListener("click", () => {
    const current = activeSession;
    if (!current) {
        startRecording();
        return;
    }
    if (current.recorder.state === "paused") {
        void resumeAfterCommandShutdown(current);
        return;
    }
    closeCommandWindow({ restorePauseReminder: false });
    try {
        if (current.recorder.state === "recording") {
            current.recorder.pause();
            status.textContent = "Pausing recording...";
        }
    } catch (error) {
        console.error(error);
        status.textContent = "Could not change recording state. Please stop and check the audio.";
    }
});

// Manual Stop is deliberate and does not require spoken confirmation.
pauseButton.addEventListener("click", () => {
    if (activeSession) finalizeRecording("stop-button");
});

deleteButton.addEventListener("click", async () => {
    startRequest++;
    closeCommandWindow({ restorePauseReminder: false });
    const current = activeSession;
    const savedSessionId = current ? current.id : displayedSessionId;
    if (current) {
        // Preserve any final MediaRecorder dataavailable event before soft deleting.
        current.stopIntent = "delete-button";
        logRecordingEvent(current, "stop-request", { source: current.stopIntent });
        current.deleteRequested = true;
        armFinalizationWatchdog(current);
        activeSession = null;
        setAudioCommandsToggleLocked(false);
        setMicrophoneSelectionLocked(false); setSilencePauseLocked(false);
        cleanupAudioMonitor(current);
        releaseScreenWakeLock();
        setWakeStatus("Voice detection stopped.");
        try {
            if (current.recorder.state !== "inactive") current.recorder.stop();
            else {
                stopStream(current.stream);
                await current.writeQueue;
                writingSessions.delete(current.id);
                await moveSessionToRecentlyDeleted(current.id);
                await current.recordingLease?.release();
                await renderRecoverableSessions();
            }
        } catch (error) {
            console.error("Could not stop recording for Recently Deleted:", error);
            stopStream(current.stream);
            status.textContent = "Could not finish deleting recording safely. Check saved recordings.";
        }
    } else if (savedSessionId) {
        try {
            await moveSessionToRecentlyDeleted(savedSessionId);
        } catch (error) {
            console.error("Could not move recording to Recently Deleted:", error);
            status.textContent = "Could not delete recording. Check saved recordings.";
            return;
        }
    }
    clearPlayback();
    setReadyUI();
    if (!current) status.textContent = "Recording moved to Recently Deleted. It can be restored.";
    try { await renderRecoverableSessions(); } catch (error) { console.error(error); }
});

document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("pageshow", () => {
    if (activeSession && document.visibilityState === "visible") handleVisibilityChange();
});
window.addEventListener("pagehide", () => {
    if (activeSession) {
        setLifecycleStatus(
            "iMuse is in the background. Audio capture or voice commands may be interrupted."
        );
    }
});

initializePreservationTest();
initialize();
initializeWakeWord();
// Give startup UI and microphone setup priority, then prepare the model in advance.
window.setTimeout(preloadCommandModel, 1000);
// Microphone is acquired only when recording begins; no startup readiness capture.
setLifecycleStatus("Screen lock prevention activates during recording when available.");

// Cache short response files without opening the microphone.
void prepareSpokenResponses();
