"""Stage 3 checks using production functions and controlled storage/timers.
Run: python3 tests/test_recording_finalization.py
"""
import unittest
from recording_test_support import SOURCE, MOCKS, FUNCTIONS, INTEGRITY_SOURCE, RECOVERY_SOURCE, between, evaluate

marker = '        recorder.addEventListener("error", event => {'
offset = SOURCE.index(marker) + len(marker)
error_body = SOURCE[offset:SOURCE.index('        });\n        recorder.addEventListener("pause"', offset)]

EXTRA = r"""
const metadataStore = new Map();
let blockMetadata = false, unblockMetadata, released = 0;
async function putSession(record) {
    const snapshot = {...record};
    if (blockMetadata) await new Promise(resolve => {unblockMetadata = resolve;});
    metadataStore.set(record.id, snapshot);
}
async function putSessionNow(record) { return putSession(record); }
async function getSession(id) { return {...metadataStore.get(id)}; }
async function getAllSessions() { return [...metadataStore.values()]; }
async function moveSessionToRecentlyDeleted(id) {
    metadataStore.set(id, {...metadataStore.get(id), state:'deleted', deletedAt:'2026-11-03T10:00:00Z'});
}
function healthy(name) {
    seed(name);
    current.persistenceError = null;
    current.storageStopRequested = false;
    current.stopIntent = 'stop-button';
    current.sequence = 1;
    current.pendingChunks.clear();
    const chunk = disk.get(name)[0];
    chunk.bytes = chunk.blob.size;
    current.metadata.chunkCount = 1;
    current.metadata.bytesStored = chunk.bytes;
    metadataStore.set(name, {...current.metadata});
    recordingLease = {async release() {released++;}};
    return current;
}
async function flush() { for(let i=0;i<40;i++) await Promise.resolve(); }
"""

TESTS = r"""
globalThis.testResult = 'pending';
(async () => {
    const firstBlob = new Blob(['abc']), lastBlob = new Blob(['de']);
    const meta = {chunkCount:2, bytesStored:5};
    const valid = [{sequence:0, bytes:3, blob:firstBlob}, {sequence:1, bytes:2, blob:lastBlob}];
    assert(inspectRecordingChunks(meta, valid, 2).report.ok, 'valid chunks pass');
    for (const [name, item, chunks, received] of [
        ['gap', {...meta,chunkCount:3}, [valid[0], {...valid[1],sequence:2}], 3],
        ['duplicate', meta, [valid[0],valid[0]], 2],
        ['no header', {chunkCount:1,bytesStored:2}, [valid[1]], 1],
        ['invalid sequence', meta, [{...valid[0],sequence:-1},valid[1]], 2],
        ['wrong bytes', {...meta,bytesStored:99}, valid, 2],
        ['wrong chunk bytes', meta, [{...valid[0],bytes:99},valid[1]], 2],
        ['empty chunk', meta, [valid[0],{sequence:1,bytes:0,blob:new Blob([])}], 2],
        ['missing received tail', meta, valid, 3],
        ['no audio', {chunkCount:0,bytesStored:0}, [], 0]
    ]) assert(!inspectRecordingChunks(item,chunks,received).report.ok, name + ' fails validation');

    healthy('normal');
    await stopHandler();
    await flush();
    assert(metadataStore.get('normal').state === 'completed', 'normal user stop completes');
    assert(metadataStore.get('normal').integrityReport.ok, 'completion records structural checks');
    assert(timers.size === 0, 'normal finalization clears watchdog and read timers');

    healthy('unexpected');
    current.stopIntent = null;
    await stopHandler();
    assert(metadataStore.get('unexpected').state === 'interrupted', 'unexpected stop is never normal completion');
    assert(status.textContent.includes('interrupted'), 'unexpected stop has truthful status');

    healthy('encoder-error');
    errorHandler({error: Error('encoder broke')});
    await stopHandler();
    assert(metadataStore.get('encoder-error').state === 'interrupted', 'encoder error survives stop');
    assert(metadataStore.get('encoder-error').recorderError === 'encoder broke', 'encoder error persists');
    await recoverSession('encoder-error', {disabled:false});
    assert(metadataStore.get('encoder-error').state === 'interrupted', 'recovery preserves interruption classification');

    healthy('gapped');
    current.metadata.chunkCount = 3;
    current.metadata.bytesStored = 5;
    metadataStore.set('gapped', {...current.metadata,state:'completed'});
    disk.set('gapped', [valid[0], {...valid[1],sequence:2}]);
    writingSessions.delete('gapped');
    await recoverSession('gapped', {disabled:false});
    assert(metadataStore.get('gapped').state === 'interrupted', 'previously completed gapped audio is reclassified');
    assert(!metadataStore.get('gapped').integrityReport.ok && window.lastRecording.size === 5, 'partial audio is retained and loadable');
    await exportSavedSession('gapped', {disabled:false});
    assert(status.textContent.includes('incomplete') && downloads.at(-1).blob.size === 5, 'partial export warns and retains available data');

    // Missing stop: watchdog offers a snapshot but does not free ownership.
    healthy('no-stop');
    current.pendingChunks.set(1, new Blob(['unsaved']));
    current.sequence = 2;
    armFinalizationWatchdog(current);
    timers.get(current.finalizationTimer)();
    await flush();
    assert(current.finalizationDelayed && emergencyRecordings.has('no-stop'), 'missing stop offers available audio');
    assert(writingSessions.has('no-stop'), 'missing stop keeps writer protected');
    const saved = emergencyRecordings.get('no-stop').blob;
    await startRecording();
    assert(emergencyRecordings.get('no-stop').blob === saved && status.textContent.includes('still finishing'), 'new recording cannot clear or compete with delayed writer');
    await exportSavedSession('no-stop', {disabled:false});
    assert(downloads.at(-1).blob.content.includes('unsaved'), 'watchdog snapshot is exportable');
    await stopHandler();
    assert(emergencyRecordings.get('no-stop').blob.size >= saved.size, 'late finalization never replaces fuller snapshot with prefix');
    assert(metadataStore.get('no-stop').state === 'interrupted', 'late finalization retains delayed classification');

    // A transaction which eventually completes must not overwrite the watchdog
    // notice with a false normal completion or release ownership prematurely.
    healthy('blocked');
    blockMetadata = true;
    const finishing = stopHandler();
    await flush();
    assert(unblockMetadata, 'metadata write is pending');
    const previousReleased = released;
    await recordingRecovery.offerDelayedFinalization(current);
    assert(writingSessions.has('blocked') && released === previousReleased, 'pending transaction retains ownership');
    blockMetadata = false;
    unblockMetadata();
    await finishing;
    assert(metadataStore.get('blocked').state === 'interrupted', 'late transaction completion keeps delayed classification');
    assert(!writingSessions.has('blocked') && released === previousReleased+1, 'settled finalization releases ownership once');

    healthy('pending-chunk');
    const tail = new Blob(['delayed-tail']);
    current.pendingChunks.set(1, tail);
    current.sequence = 2;
    let settleChunk;
    current.writeQueue = new Promise(resolve => {settleChunk = resolve;});
    const pendingFinalization = stopHandler();
    await flush();
    await recordingRecovery.offerDelayedFinalization(current);
    assert(emergencyRecordings.get('pending-chunk').blob.content.includes('delayed-tail'), 'pending chunk remains accessible while its write is blocked');
    disk.get('pending-chunk').push({sequence:1,blob:tail,bytes:tail.size});
    current.metadata.chunkCount = 2;
    current.metadata.bytesStored += tail.size;
    current.pendingChunks.clear();
    settleChunk();
    await pendingFinalization;
    assert(metadataStore.get('pending-chunk').integrityReport.ok, 'eventually committed tail passes integrity checks');
    assert(metadataStore.get('pending-chunk').state === 'interrupted', 'delay history remains after queued chunk commits');
    assert(emergencyRecordings.get('pending-chunk').blob.content.includes('delayed-tail'), 'late successful write does not truncate recovery copy');

    healthy('empty');
    current.sequence = 0;
    current.metadata.chunkCount = 0;
    current.metadata.bytesStored = 0;
    disk.set('empty', []);
    await stopHandler();
    assert(metadataStore.get('empty').state === 'interrupted', 'empty recording is not misclassified as successful or storage failure');
    assert(!metadataStore.get('empty').integrityReport.ok, 'empty recording retains validation evidence');

    // A read which never resolves has a bounded fallback, not deletion/abort.
    const reading = boundedStorageRead(new Promise(() => {}));
    const timer = [...timers.keys()].at(-1);
    const rejection = reading.catch(error => error.message);
    timers.get(timer)();
    assert((await rejection).includes('too long'), 'stalled read reaches bounded fallback');

    // Stale watchdog work cannot replace a completed player's status/audio.
    healthy('done');
    const old = current;
    old.finalizationFinished = true;
    const oldStatus = status.textContent, oldPlayback = window.lastRecording;
    await recordingRecovery.offerDelayedFinalization(old);
    assert(status.textContent === oldStatus && window.lastRecording === oldPlayback, 'finished watchdog is inert');
    writingSessions.delete('done');

    metadataStore.set('ui-delete', {id:'ui-delete',state:'completed',bytesStored:2048,chunkCount:2,startedAt:'2026-11-03T10:00:00Z'});
    await renderRecoverableSessions();
    const savedRow = getRecoveryPanel().children.find(element => element.children?.some(child => child.textContent === 'Delete') && element.children[0].textContent.includes(formatRecordingSize(2048)));
    const topBeforeDelete = window.lastRecording;
    await savedRow.children.find(child => child.textContent === 'Delete').click();
    assert(window.lastRecording === topBeforeDelete, 'deleting a saved row keeps the top in-memory recording');
    const deletedSection = getRecoveryPanel().children.find(element => element.children?.some(child => child.textContent === 'Recently Deleted (1)'));
    assert(deletedSection && deletedSection.children.some(row => row.children?.some(child => child.textContent?.includes(formatRecordingSize(2048)))), 'Recently Deleted includes file size in KB');
    healthy('discard-current');
    current.persistenceError=Error('quota');
    current.pendingChunks.set(1,new Blob(['unsaved']));
    current.sequence=2;
    await stopHandler();
    const fullCurrent=window.lastRecording;
    await recordingRecovery.discardEmergencyRecording('no-stop');
    assert(window.lastRecording===fullCurrent,'discarding another emergency preserves the current player');
    await recordingRecovery.discardEmergencyRecording('discard-current');
    assert(window.lastRecording===null && !emergencyRecordings.has('discard-current'),'explicit discard clears its own current-player copy');
    assert(metadataStore.get('discard-current').state==='deleted','discard preserves committed prefix in Recently Deleted');
    globalThis.testResult = 'PASS';
})().catch(error => {globalThis.testResult = String(error) + '\n' + (error.stack || '');});
"""

COMPONENT_TESTS = r"""
globalThis.testResult='pending';
(async()=>{
    const calls=[],played=[],exported=[];
    const metadata={id:'component',state:'recording',mimeType:'audio/mp4',chunkCount:2,bytesStored:5};
    const parts=[{sequence:0,bytes:3,blob:new Blob(['abc'])},{sequence:1,bytes:2,blob:new Blob(['de'])}];
    const session={id:'component',metadata:{...metadata},sequence:2,stopIntent:'stop-button',writeQueue:Promise.resolve(),pendingChunks:new Map()};
    let saved={...metadata},delayedCleanup=0,discardFails=true,discarded=null;
    const recovery=createRecordingRecovery({
        recordingStorage:{run:operation=>operation()},status:{},
        getSession:async()=>{calls.push('session-read');return {...saved};},
        getChunks:async()=>{calls.push('chunks-read');return parts;},
        putSession:async item=>{saved={...item};calls.push('write');},
        putSessionNow:async item=>{saved={...item};calls.push('owned-write');},
        assertSessionIdle:()=>calls.push('guard'),
        showPlayback:(blob,id)=>played.push({blob,id}),
        downloadAudioBlob:(blob,name)=>exported.push({blob,name}),
        sessionFilename:()=> 'component-file',
        renderRecoverableSessions:async()=>{calls.push('render');},
        logRecordingEvent:()=>calls.push('event'),
        onStopDelayed:()=>{delayedCleanup++;},
        onEmergencyRetained:()=>calls.push('retained'),
        moveSessionToRecentlyDeleted:async(id,options)=>{
            assert(options.discardEmergency===true,'discard is an explicit guarded operation');
            if(discardFails)throw Error('storage unavailable');
            saved={...saved,state:'deleted'};
        },
        onEmergencyDiscarded:id=>{discarded=id;}
    });
    assert(calls.length===0&&timers.size===0&&recovery.emergencies.size===0,'constructor has no storage, timer or UI effects');
    recovery.armWatchdog(session);
    const watchdog=session.finalizationTimer;
    await recovery.finalize(session);
    assert(saved.state==='completed'&&saved.integrityReport.ok,'module classifies normal finalization and persists report');
    assert(played[0].blob.content==='abcde'&&played[0].id==='component','module presents assembled audio');
    assert(timers.has(watchdog)&&!session.finalizationFinished,'controller retains finish/lease ordering responsibility');
    recovery.finish(session);
    assert(session.finalizationFinished&&!timers.has(watchdog),'controller finish clears watchdog');

    session.pendingChunks.set(2,new Blob(['tail']));
    recovery.retainEmergencyRecording(session,new Blob(['abcdetail']));
    const retained=recovery.emergencies.get('component');
    assert(retained.unsavedBytes===4,'module owns retained emergency tail');
    recovery.retainEmergencyRecording(session,new Blob(['abc']));
    assert(recovery.emergencies.get('component')===retained,'smaller fallback cannot replace fuller copy');
    const before=calls.length;
    await recovery.exportSavedSession('component',{disabled:false});
    assert(exported[0].blob===retained.blob&&calls.length===before,'emergency export is independent of storage');
    let selected;
    await recovery.recoverSession('component',{disabled:false},blob=>{selected=blob;});
    assert(selected===retained.blob&&calls.length===before,'recovery selects emergency without promoting saved metadata');
    await recovery.offerDelayedFinalization(session);
    assert(delayedCleanup===0,'finished watchdog cannot clean up or replace a completed session');

    saved={...metadata,id:'other',state:'interrupted'};
    await recovery.recoverSession('other',{disabled:false},()=>{});
    assert(saved.state==='interrupted'&&saved.integrityReport.ok,'loading structurally valid interrupted audio retains interruption');
    assert(delayedCleanup===0,'normal recovery does not control microphone cleanup');
    assert(document.body.children.length===0,'module does not create DOM or own an audio element');
    await recovery.discardEmergencyRecording('component').then(()=>{throw Error('expected failure');},()=>{});
    assert(recovery.emergencies.get('component')===retained && discarded===null,'failed soft deletion retains full recovery copy');
    discardFails=false;
    await recovery.discardEmergencyRecording('component');
    assert(!recovery.emergencies.has('component') && discarded==='component' && saved.state==='deleted','successful discard releases memory after soft deletion');
    globalThis.testResult='PASS';
})().catch(error=>{globalThis.testResult=String(error)+'\n'+(error.stack||'');});
"""


class RecordingFinalizationTests(unittest.TestCase):
    def test_finalization_and_integrity(self):
        evaluate(MOCKS + FUNCTIONS + EXTRA + 'function errorHandler(event) {' + error_body + '}\n' + TESTS)

    def test_recovery_component(self):
        evaluate(MOCKS + INTEGRITY_SOURCE + RECOVERY_SOURCE + COMPONENT_TESTS)


if __name__ == "__main__":
    unittest.main()
