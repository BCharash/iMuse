"""Shared JavaScript runner and recorder fixtures; no application/runtime dependency."""
import ctypes
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


SOURCE = (Path(__file__).resolve().parents[1] / "js/recorder.js").read_text()


def between(start, end):
    offset = SOURCE.index(start)
    return SOURCE[offset:SOURCE.index(end, offset)]


def evaluate(code):
    node = shutil.which("node")
    if node:
        subprocess.run([node, "-e", code + "\nrequire('node:timers').setImmediate(() => { if (globalThis.testResult !== 'PASS') throw Error(globalThis.testResult); });"], check=True)
        return
    if sys.platform != "darwin":
        raise RuntimeError("Install Node to run these tests on this platform.")
    library = ctypes.CDLL("/System/Library/Frameworks/JavaScriptCore.framework/JavaScriptCore")
    pointer = ctypes.c_void_p
    declarations = [
        ("JSGlobalContextCreate", pointer, [pointer]),
        ("JSStringCreateWithUTF8CString", pointer, [ctypes.c_char_p]),
        ("JSEvaluateScript", pointer, [pointer, pointer, pointer, pointer, ctypes.c_int, ctypes.POINTER(pointer)]),
        ("JSValueToStringCopy", pointer, [pointer, pointer, ctypes.POINTER(pointer)]),
        ("JSStringGetUTF8CString", ctypes.c_size_t, [pointer, ctypes.c_char_p, ctypes.c_size_t]),
        ("JSStringRelease", None, [pointer]),
        ("JSGlobalContextRelease", None, [pointer]),
    ]
    for name, result, arguments in declarations:
        function = getattr(library, name)
        function.restype, function.argtypes = result, arguments
    context = library.JSGlobalContextCreate(None)

    def run(script):
        exception = pointer()
        source = library.JSStringCreateWithUTF8CString(script.encode())
        try:
            value = library.JSEvaluateScript(context, source, None, None, 1, ctypes.byref(exception))
        finally:
            library.JSStringRelease(source)
        string = library.JSValueToStringCopy(context, exception if exception.value else value, None)
        buffer = ctypes.create_string_buffer(65536)
        library.JSStringGetUTF8CString(string, buffer, len(buffer))
        library.JSStringRelease(string)
        text = buffer.value.decode()
        if exception.value:
            raise AssertionError(text)
        return text

    try:
        run(code)
        for _ in range(100):
            result = run("globalThis.testResult")
            if result != "pending":
                break
        assert result == "PASS", result
    finally:
        library.JSGlobalContextRelease(context)


MOCKS = r"""
const assert = (value, message) => { if (!value) throw Error(message); };
const console = {error(){}};
const FINALIZATION_NOTICE_MS = 10000, STORAGE_READ_TIMEOUT_MS = 2000;
const timers = new Map();
let timerSequence = 0;
function setTimeout(callback) { const id = ++timerSequence; timers.set(id, callback); return id; }
function clearTimeout(id) { timers.delete(id); }
class Element {
    constructor() { this.children = []; this.style = {}; this.events = {}; this.attributes = {}; }
    append(...items) { for (const item of items) {if (typeof item === 'object') item.parentElement = this; this.children.push(item);} }
    appendChild(item) { this.append(item); }
    prepend(item) { this.children.unshift(item); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute() {}
    addEventListener(name, handler) { this.events[name] = handler; }
    click() { if (!this.disabled) return this.events.click(); }
    pause() {}
    load() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); }
}
class Blob {
    constructor(parts, options = {}) {
        this.content = parts.map(part => part.content ?? part).join('');
        this.size = this.content.length;
        this.type = options.type || '';
    }
}
const location = new Element();
const document = {body: new Element(), createElement: () => new Element(), createTextNode: text => text, getElementById: () => location};
const window = {lastRecording: null};
const audioPlayer = new Element(), recordingControls = new Element(), status = {};
const revoked = [];
const URL = {createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url)};
let recordingUrl = null, displayedSessionId = null, displayedRecordingFilename = null, activeSession = null, db = null;
let recordingStore = {isOpen: () => Boolean(db)};
let lastRecordingPeakBytes = 0, startRequest = 0, recordingLease = null;
const microphoneLevelCheck={stop:()=>Promise.resolve()};
function getRecoveryPanel() { return location.children.find(element => element.id === 'recoveryPanel'); }
function getSavedPlayback() {
    const dialog = document.body.children.find(element => element.className === 'saved-audio-dialog');
    return dialog ? {dialog, player:dialog.children[1], id:dialog.getAttribute('data-session-id')} : null;
}
const writingSessions = new Set();
let leaseAcquisitions = 0, leaseReleases = 0;
const recordingStorage = {
    run: operation => Promise.resolve().then(operation),
    async hold() { leaseAcquisitions++; return {async release() {leaseReleases++;}}; }
};
let startupFailure = 'permission';
async function acquireRecordingMicrophone() {
    if (startupFailure === 'permission') throw Error('permission rejected');
    if (startupFailure === 'cancel') startRequest++;
    return {};
}
function publishMicrophoneProcessing() {}
function createCompatibleRecorder() { throw Error('recorder initialization test'); }
let emergencyRecordings;
const downloads = [], disk = new Map();
let preservationTestEnabled = false, preservationTestResult = null;
let downloadFails = false, storageReadable = true;
let reads = 0, writes = 0;
async function getSession() { reads++; throw Error('must not read partial stored session'); }
async function getChunks(id) {
    reads++;
    if (!storageReadable) throw Error('storage unavailable');
    return disk.get(id) || [];
}
async function putSession() { writes++; }
async function putSessionNow(record) { return putSession(record); }
async function getAllSessions() {
    if (!storageReadable) throw Error('storage unavailable');
    return [...disk].map(([id, parts]) => ({id, state: 'interrupted',
        startedAt: '2026-11-03T10:00:00Z', chunkCount: parts.length,
        bytesStored: parts.reduce((n, part) => n + part.blob.size, 0)}));
}
function downloadAudioBlob(blob, name) {
    if (downloadFails) throw Error('download failed');
    downloads.push({blob, name});
}
function logRecordingEvent() {} function closeCommandWindow() {}
function cleanupAudioMonitor() {} function stopStream() {}
function releaseStoppedPlaybackSession() {}
function microphoneCheckBusy(){return false;}
const voiceDiagnostics={record(){}};
function publishRecordingDiagnostics() {} function publishMicrophoneCheckState() {} function setAudioCommandsToggleLocked() {}
function setMicrophoneSelectionLocked() {} function setSilencePauseLocked() {}
function releaseScreenWakeLock() {} function setWakeStatus() {}
function setRecordingControlState() {} function setReadyUI() {}
function sayResponse() {}
async function moveSessionToRecentlyDeleted() { throw Error('not configured'); }
async function restoreRecentlyDeletedSession() { throw Error('not configured'); }
async function deleteSessionData() { throw Error('not configured'); }
async function downloadRecordingEvents() {}
let current, id, stream = {};
function seed(name) {
    db = {};
    id = name;
    current = {
        id, metadata: {id, startedAt: '2026-11-03T10:00:00Z', mimeType: 'audio/mp4'},
        stopHandled: false, activeSinceMs: null, peakPendingBytes: 0,
        writeQueue: Promise.resolve(), persistenceError: Error('quota exceeded'),
        storageStopRequested: true,
        pendingChunks: new Map([[1, new Blob(['tail-' + name])]])
    };
    disk.set(id, [{sequence: 0, blob: new Blob(['header-' + name])}]);
    activeSession = current;
    writingSessions.add(id);
}
"""

stop_marker = '        recorder.addEventListener("stop", async () => {'
stop_offset = SOURCE.index(stop_marker) + len(stop_marker)
stop_body = SOURCE[stop_offset:SOURCE.index('        });\n        await setupSilenceMonitor(current);', stop_offset)]
LIBRARY_SOURCE = (Path(__file__).resolve().parents[1] / "js/recording-library.js").read_text().replace("export ", "")
INTEGRITY_SOURCE = (Path(__file__).resolve().parents[1] / "js/recording-integrity.js").read_text().replace("export ", "")
STORE_SOURCE = (Path(__file__).resolve().parents[1] / "js/recording-store.js").read_text().replace("export ", "")
STORE_WIRING = between("const recordingStore = createRecordingStore(", "// Maximum audio waiting")
RECOVERY_SOURCE = re.sub(r'^import .*?;\n', '', (Path(__file__).resolve().parents[1] / "js/recording-recovery.js").read_text(), flags=re.M).replace("export ", "")
RECOVERY_WIRING = between("const recordingRecovery = createRecordingRecovery(", "const recordingLibrary =")
assert 'import { createRecordingLibrary } from "./recording-library.js";' in SOURCE
assert 'import { createRecordingStore, RECORDING_DB_NAME } from "./recording-store.js";' in SOURCE
assert 'import { createRecordingRecovery } from "./recording-recovery.js";' in SOURCE
FUNCTIONS = (
    (Path(__file__).resolve().parents[1] / "js/recording-download.js").read_text().replace("export ", "")
    + (Path(__file__).resolve().parents[1] / "js/stopped-audio.js").read_text().replace("export ", "")
    + INTEGRITY_SOURCE
    + RECOVERY_SOURCE
    + LIBRARY_SOURCE
    + between("function boundedStorageRead(", "function updatePreservationTestControls(")
    + between("function clearPlayback()", "function setAudioCommandsToggleLocked(")
    + between("function showPlayback(", "function audioFileExtension(")
    + between("function sessionFilename(", "function renderRecoverableSessions(")
    + between("function renderRecoverableSessions(", "async function initialize(")
    + between("function assertSessionIdle(", "function stopStream(")
    + between("async function startRecording()", 'recordButton.addEventListener("click"')
    + "async function stopHandler() {" + stop_body + "}\n"
    + RECOVERY_WIRING.replace("const emergencyRecordings =", "emergencyRecordings =")
    + between("const recordingLibrary = createRecordingLibrary(", "// Deliberately session-only")
)

