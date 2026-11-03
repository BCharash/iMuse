"""Safe failure-injection control tests; run with python3 tests/test_preservation_failure_control.py."""
from test_emergency_recordings import SOURCE, MOCKS, FUNCTIONS, between, evaluate


data_marker = '        recorder.addEventListener("dataavailable", event => {'
data_offset = SOURCE.index(data_marker) + len(data_marker)
data_body = SOURCE[data_offset:SOURCE.index('        });\n        recorder.addEventListener("error"', data_offset)]

controls = between("function updatePreservationTestControls()", "// Count actual active recording time")
storage = between("function transactionDone(", "// Independent IndexedDB") + between("async function persistChunk(", "async function getChunks(")
extra_mocks = r"""
let preservationTestButton = null;
document.createTextNode = text => text;
const performance = {now: () => 0};
const MAX_PENDING_AUDIO_BYTES = 8 * 1024 * 1024;
const SESSION_STORE = 'sessions', CHUNK_STORE = 'chunks';
function savedChunkProgress() { return 'test'; }
let transactionCount = 0;
const testDatabase = {transaction() {
    transactionCount++;
    let pending = 0;
    const tx = {objectStore: name => ({
        put(){},
        get() {
            pending++;
            const request = {};
            Promise.resolve().then(() => {
                request.result = name === SESSION_STORE ? {...current.metadata} : undefined;
                request.onsuccess?.();
                if (--pending === 0) tx.oncomplete?.();
            });
            return request;
        }
    })};
    return tx;
}};
let recorder, stopRequests = 0, requestedData = 0;
function begin(name) {
    seed(name);
    db = testDatabase;
    current.persistenceError = null;
    current.storageStopRequested = false;
    current.sequence = 1;
    current.metadata.chunkCount = 1;
    current.metadata.bytesStored = 6;
    current.pendingChunks = new Map();
    current.pendingBytes = 0;
    recorder = current.recorder = {
        state: 'recording',
        requestData() { requestedData++; },
        stop() { stopRequests++; this.state = 'inactive'; }
    };
}
"""

tests = r"""
globalThis.testResult = 'pending';
(async () => {
    initializePreservationTest();
    const panel = location.children[0], enable = panel.children[2].children[0];
    assert(!preservationTestEnabled && preservationTestButton.disabled, 'test defaults off');
    begin('disabled');
    current.simulateNextChunkFailure = true;
    await persistChunk(current, 1, new Blob(['real audio']));
    assert(transactionCount === 1 && !current.simulatedStorageFailure, 'disabled mode never injects failure');

    begin('simulated');
    enable.checked = true;
    enable.events.change();
    assert(!preservationTestButton.disabled, 'enabled after committed audio exists');
    current.metadata.chunkCount = 0;
    updatePreservationTestControls();
    assert(preservationTestButton.disabled, 'cannot fail before first committed chunk');
    current.metadata.chunkCount = 1;
    recorder.state = 'paused';
    updatePreservationTestControls();
    assert(preservationTestButton.disabled, 'paused recording cannot be armed');
    recorder.state = 'recording';
    updatePreservationTestControls();
    preservationTestButton.click();
    assert(requestedData === 1 && current.simulateNextChunkFailure, 'button targets active recording and requests recent data');
    const before = transactionCount;
    dataHandler({data: new Blob(['failed-tail'])});
    await current.writeQueue;
    assert(transactionCount === before, 'injected chunk fails before any database transaction');
    assert(stopRequests === 1 && current.persistenceError, 'existing storage error handler stops recording');
    assert(current.pendingChunks.get(1).content === 'failed-tail', 'failed write retains chunk');
    dataHandler({data: new Blob(['final-tail'])});
    await current.writeQueue;
    await stopHandler();
    const emergency = emergencyRecordings.get('simulated');
    assert(emergency.blob.content === 'header-simulatedfailed-tailfinal-tail', 'real failure path assembles prefix, failed chunk, final chunk');
    assert(preservationTestResult.textContent.includes('21 bytes not saved'), 'test result identifies unsaved tail bytes');
    const button = {disabled: false};
    await exportSavedSession('simulated', button);
    assert(downloads[0].blob === emergency.blob, 'test export contains unsaved tail');

    // The failure belongs to one recording, even while the control stays enabled.
    begin('next');
    const nextBefore = transactionCount;
    await persistChunk(current, 1, new Blob(['normal next recording']));
    assert(transactionCount === nextBefore + 1 && !current.persistenceError, 'next session writes normally without rearming');
    assert(emergencyRecordings.get('simulated') === emergency, 'next recording retains emergency');

    recorder.requestData = () => { throw Error('request rejected'); };
    updatePreservationTestControls();
    preservationTestButton.click();
    assert(!current.simulateNextChunkFailure && !preservationTestButton.disabled, 'failed request disarms and permits retry');
    recorder.requestData = () => {};
    preservationTestButton.click();
    enable.checked = false;
    enable.events.change();
    assert(!current.simulateNextChunkFailure && preservationTestButton.disabled, 'disabling test cancels pending injection');
    assert(emergencyRecordings.get('simulated') === emergency, 'disabling never clears emergency');
    globalThis.testResult = 'PASS';
})().catch(error => { globalThis.testResult = String(error) + '\n' + (error.stack || ''); });
"""

if __name__ == "__main__":
    evaluate(MOCKS + FUNCTIONS + extra_mocks + controls + storage + "function dataHandler(event) {" + data_body + "}\n" + tests)
    print("PASS: default-off control; active/committed/paused guards; actual write-error-stop pipeline; final tail retention/export; next session writes normally; cancellation and request failure")
