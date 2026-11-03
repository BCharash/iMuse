"""Run with python3 tests/test_emergency_recordings.py.

Exercises production recorder functions with a minimal DOM/storage harness.
Uses Node when installed, otherwise the macOS JavaScriptCore framework.
No microphone, browser database, or existing recording is accessed.
"""
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
        subprocess.run([node, "-e", code + "\nsetTimeout(() => { if (globalThis.testResult !== 'PASS') throw Error(globalThis.testResult); }, 0);"], check=True)
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
class Element {
    constructor() { this.children = []; this.style = {}; this.events = {}; }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.append(item); }
    prepend(item) { this.children.unshift(item); }
    replaceChildren(...items) { this.children = items; }
    setAttribute() {}
    removeAttribute() {}
    addEventListener(name, handler) { this.events[name] = handler; }
    click() { return this.events.click(); }
    pause() {}
    load() {}
}
class Blob {
    constructor(parts, options = {}) {
        this.content = parts.map(part => part.content ?? part).join('');
        this.size = this.content.length;
        this.type = options.type || '';
    }
}
const location = new Element();
const document = {createElement: () => new Element(), getElementById: () => location};
const window = {lastRecording: null};
const audioPlayer = new Element(), recordingControls = new Element(), status = {};
const revoked = [];
const URL = {createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url)};
let recordingUrl = null, displayedSessionId = null, activeSession = null, db = null;
let emergencyPanel = null, lastRecordingPeakBytes = 0, startRequest = 0;
const emergencyRecordings = new Map(), downloads = [], disk = new Map();
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
function downloadAudioBlob(blob, name) {
    if (downloadFails) throw Error('download failed');
    downloads.push({blob, name});
}
function logRecordingEvent() {} function closeCommandWindow() {}
function cleanupAudioMonitor() {} function stopStream() {}
function publishRecordingDiagnostics() {} function setAudioCommandsToggleLocked() {}
function setMicrophoneSelectionLocked() {} function setSilencePauseLocked() {}
function releaseScreenWakeLock() {} function setWakeStatus() {}
function setRecordingControlState() {} function setReadyUI() {}
function sayResponse() {} async function renderRecoverableSessions() {}
let current, id, stream = {};
function seed(name) {
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
}
"""

stop_marker = '        recorder.addEventListener("stop", async () => {'
stop_offset = SOURCE.index(stop_marker) + len(stop_marker)
stop_body = SOURCE[stop_offset:SOURCE.index('        });\n        await setupSilenceMonitor(current);', stop_offset)]
FUNCTIONS = (
    between("function clearPlayback()", "function setAudioCommandsToggleLocked(")
    + between("function showPlayback(", "function audioFileExtension(")
    + between("function sessionFilename(", "function ensureCurrentDownloadButton(")
    + between("function formatDate(", "async function renderRecoverableSessions(")
    + between("async function playSavedSession(", "async function initialize(")
    + between("async function startRecording()", 'recordButton.addEventListener("click"')
    + "async function stopHandler() {" + stop_body + "}\n"
)

TESTS = r"""
globalThis.testResult = 'pending';
(async () => {
    seed('first');
    await stopHandler();
    const first = emergencyRecordings.get('first');
    assert(first.blob.content === 'header-firsttail-first', 'finalization preserves committed prefix and unsaved tail');
    assert(window.lastRecording === first.blob, 'emergency initially loaded');
    assert(location.children.includes(emergencyPanel), 'emergency panel visible independently of saved list');
    assert(emergencyPanel.children.length === 3, 'one emergency row');

    // Execute the actual new-recording path through its unavailable-storage exit.
    // It clears the player before attempting database/microphone access.
    await startRecording();
    assert(window.lastRecording === null && audioPlayer.hidden, 'new recording clears old player');
    assert(emergencyRecordings.get('first') === first, 'new recording retains emergency data');
    assert(revoked.length > 0, 'player URL released without releasing emergency blob');

    // Another failure must not overwrite the earlier emergency.
    seed('second');
    await stopHandler();
    assert(emergencyRecordings.size === 2, 'two emergencies retained');
    assert(emergencyPanel.children.length === 4, 'both rows available');
    current.metadata.startedAt = 'changed';
    assert(emergencyRecordings.get('second').metadata.startedAt !== 'changed', 'metadata snapshot retained');

    // Interact with the actual rendered controls, then switch to other playback.
    const row = emergencyPanel.children[2];
    row.children[1].click();
    assert(window.lastRecording === first.blob, 'row reloads first emergency');
    showPlayback(new Blob(['ordinary-recording']), 'ordinary');
    clearPlayback();
    assert(emergencyRecordings.size === 2, 'playback switching retains both emergencies');
    const beforeReads = reads, beforeWrites = writes;
    await row.children[2].click();
    assert(downloads[0].blob.content === 'header-firsttail-first', 'row download contains unsaved tail');
    assert(!row.children[2].disabled, 'download control enabled again');
    await exportSavedSession('second', {disabled: false});
    assert(downloads[1].blob.content === 'header-secondtail-second', 'saved-list export prefers complete emergency');
    assert(reads === beforeReads, 'emergency export does not depend on readable database');
    assert(emergencyRecordings.size === 2, 'download requests never release emergency copies');

    for (const action of [playSavedSession, recoverSession]) {
        const button = {disabled: false};
        await action('first', button);
        assert(window.lastRecording === first.blob, 'saved action prefers emergency instead of partial disk audio');
        assert(!button.disabled, 'saved action remains repeatable');
    }
    assert(reads === beforeReads && writes === beforeWrites, 'recovery neither reads partial audio nor marks it completed');
    downloadFails = true;
    const failedButton = {disabled: false};
    await exportSavedSession('first', failedButton);
    assert(!failedButton.disabled && emergencyRecordings.get('first') === first, 'failed download retains emergency and allows retry');
    downloadFails = false;
    await exportSavedSession('first', failedButton);
    assert(downloads[2].blob === first.blob, 'retry exports original artifact');

    // If even committed chunks cannot be read, retain the available tail.
    // Retention does not claim that this fragment alone is playable.
    storageReadable = false;
    seed('unreadable');
    await stopHandler();
    assert(emergencyRecordings.get('unreadable').blob.content === 'tail-unreadable', 'read failure retains available tail');
    const empty = {id: 'empty', metadata: {}};
    retainEmergencyRecording(empty, new Blob([]));
    assert(emergencyRecordings.size === 3, 'empty artifact not listed');
    globalThis.testResult = 'PASS';
})().catch(error => { globalThis.testResult = String(error.stack || error); });
"""

if __name__ == "__main__":
    syntax_source = re.sub(r"^import .*?;\n", "", SOURCE, flags=re.M)
    evaluate("new Function(" + json.dumps(syntax_source) + ");\n" + MOCKS + FUNCTIONS + TESTS)
    print("PASS: recorder syntax; actual failure finalization; new-recording playback clearing; multiple emergencies; rendered controls; complete exports; database-independent access; recovery safeguards")
