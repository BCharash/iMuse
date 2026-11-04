import { playSpokenResponse, prepareSpokenResponses } from "./audio-response-manager.js";
import { acquireRecordingMicrophone, releaseRecordingMicrophone, setMicrophoneSelectionLocked, getRequestedMicrophoneConstraints } from "./microphone-manager.js";
import { loadVoicuteWakeWord } from "./voicute/voicute-adapter.js";
import { loadHeedWakeWord } from "./heed/heed-adapter.js";
import { getSettings, effectiveOverlap, setSilencePauseLocked } from "./settings.js";
import { createVoiceController } from "./voice-controller.js";
import { voiceDiagnostics, initializeVoiceDiagnostics } from "./voice-diagnostics.js";
import { createRecordingStorageCoordinator } from "./recording-storage-coordinator.js";
import { createRecordingRecovery } from "./recording-recovery.js";
import { createRecordingLibrary } from "./recording-library.js";
import { createRecordingStore, RECORDING_DB_NAME } from "./recording-store.js";

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
    if (event.detail.audioCommands && activeSession && !voiceController.active && wakeWord) {
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

const recordingStorage = createRecordingStorageCoordinator(navigator.locks, `${RECORDING_DB_NAME}/writer`);
// Includes finalization after activeSession is cleared.
const writingSessions = new Set();
const recordingStore = createRecordingStore({
    coordinator: recordingStorage,
    assertSessionIdle
});
// Maximum audio waiting for a committed IndexedDB write.
const MAX_PENDING_AUDIO_BYTES = 8 * 1024 * 1024;

let activeSession = null;
let recordingUrl = null;
let displayedSessionId = null;
let startRequest = 0;
let lastRecordingPeakBytes = 0;
const recordingRecovery = createRecordingRecovery({
    recordingStorage, status, getSession, getChunks, putSession, putSessionNow,
    assertSessionIdle, showPlayback, downloadAudioBlob, sessionFilename,
    renderRecoverableSessions, logRecordingEvent,
    moveSessionToRecentlyDeleted,
    onStopDelayed: handleDelayedStop,
    onEmergencyRetained: reportEmergencyTestResult,
    onEmergencyDiscarded: id => { if (displayedSessionId === id) clearPlayback(); }
});
// Only the recovery service adds/replaces copies; other components read this map.
const emergencyRecordings = recordingRecovery.emergencies;
const recordingLibrary = createRecordingLibrary({
    container: document.getElementById("savedRecordingsLocation"),
    status,
    getAllSessions: () => recordingStore.isOpen() ? boundedStorageRead(getAllSessions()) : Promise.resolve([]),
    getEmergencyRecordings: () => emergencyRecordings,
    isSessionWriting: id => writingSessions.has(id),
    recoverSession, exportSavedSession, moveSessionToRecentlyDeleted, getSession,
    deleteSessionData, restoreRecentlyDeletedSession, downloadRecordingEvents,
    discardEmergencyRecording: id => recordingRecovery.discardEmergencyRecording(id),
    pauseCurrentPlayback: () => audioPlayer.pause()
});
// Deliberately session-only: enabling a test must not affect a later page load.
let preservationTestEnabled = false;
let preservationTestButton = null;
let preservationTestResult = null;

function boundedStorageRead(promise) {
    return recordingRecovery.boundedRead(promise);
}

function armFinalizationWatchdog(current) {
    return recordingRecovery.armWatchdog(current);
}

function handleDelayedStop(current) {
    setRecordingControlState("finalizing");
    closeCommandWindow({ restorePauseReminder: false });
    cleanupAudioMonitor(current);
    stopStream(current.stream);
    releaseScreenWakeLock();
}

function reportEmergencyTestResult(current, blob, unsavedBytes) {
    if (current.simulatedStorageFailure && preservationTestResult) {
        preservationTestResult.textContent = `Simulated failure completed. Emergency audio contains ${blob.size} bytes, including ${unsavedBytes} bytes not saved to browser storage. Make a second recording, then load and download this emergency recording again. Keep this page open.`;
    }
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

function publishLiveMicrophoneLevel() {
    const current = activeSession;
    let detail = { state: "inactive", dbfs: null };
    if (current && ["recording", "paused"].includes(current.recorder.state)) {
        detail = { state: "unavailable", dbfs: null };
        const track = current.stream?.getAudioTracks?.()[0];
        if (document.visibilityState === "visible" && current.audioContext?.state === "running" &&
            current.analyser && track?.readyState === "live" && !track.muted) {
            try {
                const size = current.analyser.fftSize;
                if (!current.levelMeterSamples || current.levelMeterSamples.length !== size) {
                    current.levelMeterSamples = new Float32Array(size);
                }
                current.analyser.getFloatTimeDomainData(current.levelMeterSamples);
                let sum = 0;
                for (const sample of current.levelMeterSamples) sum += sample * sample;
                const rms = Math.sqrt(sum / size);
                if (Number.isFinite(rms)) detail = { state: "live", dbfs: rms > 0 ? 20 * Math.log10(rms) : -Infinity };
            } catch (_) { /* report unavailable without disturbing capture */ }
        }
    }
    window.dispatchEvent(new CustomEvent("imuse-microphone-level", { detail }));
}
window.addEventListener("imuse-request-microphone-level", publishLiveMicrophoneLevel);


function openDatabase() {
    return recordingStore.open();
}

// Independent IndexedDB event log: never modifies session/chunk records or their write queue.
// Diagnostic writes are best-effort and cannot delay or stop audio capture.
function logRecordingEvent(current, type, details = {}) {
    if (!recordingStore.isOpen() || !current) return;
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
    recordingStore.appendEvent(entry);
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

function getRecordingEvents(sessionId) {
    return recordingStore.getRecordingEvents(sessionId);
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

function getAllSessions() { return recordingStore.getAllSessions(); }
function getSession(id) { return recordingStore.getSession(id); }
function getChunks(id) { return recordingStore.getChunks(id); }
function putSession(record) { return recordingStore.putSession(record); }
// Called only within recordingStorage.run during recovery/initialization.
function putSessionNow(record) { return recordingStore.putSessionOwned(record); }
function deleteSessionData(id) { return recordingStore.deleteSessionData(id); }
function moveSessionToRecentlyDeleted(id, options) { return recordingStore.moveSessionToRecentlyDeleted(id, options); }
function restoreRecentlyDeletedSession(id) { return recordingStore.restoreRecentlyDeletedSession(id); }

async function persistChunk(record, sequence, blob) {
    if (preservationTestEnabled && record.simulateNextChunkFailure) {
        record.simulateNextChunkFailure = false;
        record.simulatedStorageFailure = true;
        logRecordingEvent(record, "simulated-storage-failure", { sequence, bytes: blob.size });
        // Fail before opening a transaction. The existing write-error and stop
        // handlers retain this chunk and the final recorder tail for export.
        throw new Error("Simulated storage failure (preservation test).");
    }
    const counters = await recordingStore.persistChunk(record.id, sequence, blob);
    // Update counters only; capture may have advanced its lifecycle while saving.
    Object.assign(record.metadata, counters);
}

function assertSessionIdle(id, { allowEmergencyDiscard = false } = {}) {
    if (writingSessions.has(id)) throw new Error("Stop and finish this recording before loading or deleting it.");
    if (emergencyRecordings.has(id) && !allowEmergencyDiscard) throw new Error("This recording contains unsaved audio. Download it before closing the page, or explicitly discard its recovery copy.");
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
    const safe = (fn) => { try { return fn() || null; } catch (_) { return null; } };
    window.imuseMicrophoneProcessing = {
        label: track.label || "Not reported",
        requested: getRequestedMicrophoneConstraints(stream),
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

// Recorder-owned capabilities: voice control cannot mutate the session's storage,
// replace its MediaRecorder, or release the original microphone track.
const voiceSessions = new WeakMap();
function getVoiceSession(current) {
    if (!current) return null;
    let session = voiceSessions.get(current);
    if (!session) {
        session = {
            get id() { return current.id; },
            get isCurrent() { return activeSession === current; },
            get state() { return current.recorder.state; },
            get discard() { return current.discard; },
            get finalizing() { return current.metadata.state === "finalizing"; },
            get wakeDetectorEnabled() { return current.wakeDetectorEnabled; },
            get stream() { return current.stream; },
            pauseForWake() {
                let resolveAnnouncement;
                current.pauseAnnouncement = new Promise(resolve => { resolveAnnouncement = resolve; });
                current.resolvePauseAnnouncement = resolveAnnouncement;
                try { current.recorder.pause(); }
                catch (error) {
                    current.resolvePauseAnnouncement?.();
                    current.resolvePauseAnnouncement = null;
                    throw error;
                }
                return current.pauseAnnouncement;
            },
            resume() { current.recorder.resume(); },
            finalize(source) { if (activeSession === current) finalizeRecording(source); },
            stopReminder() { stopPausedBeep(current); },
            startReminder() { startPausedBeep(current); },
            clearWake() { clearWakeDetectorTimers(current); },
            armWake(delayMs) { scheduleWakeDetectorArm(current, delayMs); }
        };
        voiceSessions.set(current, session);
    }
    return session;
}

// Spoken responses remain serialized by the dedicated audio manager.
async function sayResponse(name) {
    const context={prompt:name,sessionId:activeSession?.id};
    voiceDiagnostics.record('prompt-start',context);
    let result;
    try { result = await playSpokenResponse(name); }
    catch (error) { voiceDiagnostics.record('prompt-error',{...context,message:String(error)}); throw error; }
    voiceDiagnostics.record('prompt-end',{...context,ok:result.ok});
    if (!result.ok) {
        console.warn(`Voice response ${name} could not be heard:`, result.error);
        setWakeStatus(`Voice prompt unavailable. Voice commands may still work.`);
    }
    return result.ok;
}
const voiceController = createVoiceController({
    getSettings,
    getCurrentSession: () => getVoiceSession(activeSession),
    getWakePhrase: () => wakeWordPhrase,
    getOverlap: () => effectiveOverlap(deviceClass),
    sayResponse, setWakeStatus,
    setStatus: text => { status.textContent = text; }
});
function preloadCommandModel() { return voiceController.preload(); }
function closeCommandWindow(options) { return voiceController.close(options); }
function resumeAfterCommandShutdown(current) { return voiceController.resume(getVoiceSession(current)); }
function handleWakeDetected(current) { return voiceController.wake(getVoiceSession(current)); }

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
            !wakeWord || !getSettings().audioCommands || voiceController.active
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
    if (!context || context.state === "closed" || voiceController.active ||
        activeSession !== current || current.recorder.state !== "paused") return;

    // Keep wake-word detection active while the reminder tone plays.
    try {
        if (context.state === "suspended") await context.resume();
        if (context.state !== "running" || voiceController.active ||
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
    if (voiceController.active || activeSession !== current || current.discard ||
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
    current.levelMeterSamples = null;
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

function exportSavedSession(id, button) {
    return recordingRecovery.exportSavedSession(id, button);
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

function renderRecoverableSessions() {
    return recordingLibrary.render();
}

function recoverSession(id, button, present = showPlayback) {
    return recordingRecovery.recoverSession(id, button, present);
}

async function initialize() {
    try {
        if (!("indexedDB" in window)) throw new Error("IndexedDB is not available in this browser.");
        await openDatabase();
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

    if (!recordingStore.isOpen()) {
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
            if (!voiceController.active) scheduleWakeDetectorArm(current, 0);
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
            if (!voiceController.active) scheduleWakeDetectorArm(current, 0);
            current.silenceSince = null;
            current.pauseReason = null;
            current.autoPausing = false;
            if (!voiceController.active) setWakeStatus(`Listening for “${wakeWordPhrase}”.`);
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
                await recordingRecovery.finalize(current);
                setReadyUI();
                // Announce stop only after the session has left the active recording state.
                void sayResponse("stopped");
                await renderRecoverableSessions();
            } finally {
                recordingRecovery.finish(current);
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

initializeVoiceDiagnostics();
initializePreservationTest();
initialize();
initializeWakeWord();
// Give startup UI and microphone setup priority, then prepare the model in advance.
window.setTimeout(preloadCommandModel, 1000);
// Microphone is acquired only when recording begins; no startup readiness capture.
setLifecycleStatus("Screen lock prevention activates during recording when available.");

// Cache short response files without opening the microphone.
void prepareSpokenResponses();
