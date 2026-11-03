"""Run with python3 tests/test_recording_storage.py. Controlled concurrency tests;
not a substitute for browser IndexedDB/Web Locks or device acceptance tests.
"""
from pathlib import Path
from test_emergency_recordings import SOURCE, between, evaluate


coordinator = (Path(__file__).resolve().parents[1] / "js/recording-storage-coordinator.js").read_text().replace("export ", "")
functions = (
    between("function transactionDone(", "// Independent IndexedDB")
    + between("async function getAllSessions(", "async function getChunks(")
    + between("async function deleteSessionData(", "function stopStream(")
    + between("async function initialize()", "// Run a short, disposable")
)

mock = r"""
const assert = (value, message) => { if (!value) throw Error(message); };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const console = {error(){}};
const status = {}, window = {indexedDB: {}};
let rendered = 0;
async function renderRecoverableSessions() { rendered++; }
async function getRecordingEvents() { return []; }
async function getChunks(id) { return [...chunks.values()].filter(value => value.sessionId === id); }
async function openDatabase() { return db; }
const SESSION_STORE = 'sessions', CHUNK_STORE = 'chunks', EVENT_STORE = 'events';
let sessions = new Map(), chunks = new Map(), transactions = [], committed = 0;
let preservationTestEnabled = false;
function logRecordingEvent() {}
const writingSessions = new Set(), emergencyRecordings = new Map();
let db = {transaction(names) {
    const operations = [];
    const tx = {
        operations, aborted: false,
        abort() { this.aborted = true; },
        objectStore(name) {
            return {
                get(key) { const request = {}; operations.push({name, type:'get', key, request}); return request; },
                getAll() { const request = {}; operations.push({name, type:'all', request}); return request; },
                put(value) { operations.push({name, type:'put', value:clone(value)}); },
                delete(key) { operations.push({name, type:'delete', key}); }
            };
        }
    };
    transactions.push(tx);
    return tx;
}};
function commit() {
    const tx = transactions.shift();
    const oldSessions = new Map(sessions), oldChunks = new Map(chunks);
    while (tx.operations.length && !tx.aborted) {
        const op = tx.operations.shift(), store = op.name === SESSION_STORE ? sessions : chunks;
        const key = Array.isArray(op.key) ? JSON.stringify(op.key) : op.key;
        if (op.type === 'get' || op.type === 'all') {
            op.request.result = clone(op.type === 'all' ? [...store.values()] : store.get(key));
            op.request.onsuccess?.();
        } else if (op.type === 'put') {
            const id = op.name === SESSION_STORE ? op.value.id : JSON.stringify([op.value.sessionId,op.value.sequence]);
            store.set(id, op.value);
        } else store.delete(key);
    }
    if (tx.aborted) {
        sessions = oldSessions; chunks = oldChunks;
        Promise.resolve().then(() => tx.onabort?.());
    } else { committed++; Promise.resolve().then(() => tx.oncomplete?.()); }
}
async function drain(promise) {
    let finished = false, failure;
    promise.then(() => finished = true, error => {failure = error; finished = true;});
    for (let i=0;i<300 && !finished;i++) {
        if (transactions.length) commit();
        await Promise.resolve();
    }
    if (failure) throw failure;
    assert(finished, 'operation did not finish: ' + globalThis.checkpoint);
}
async function rejects(promise, text) {
    let error;
    try { await drain(promise); } catch (failure) { error = failure; }
    assert(error && error.message.includes(text), 'expected rejection: ' + text);
}
// Independent coordinators use one lock manager, as separate tabs would.
const held = new Set();
const locks = {request(name, options, callback) {
    if (held.has(name)) return Promise.resolve().then(() => callback(null));
    held.add(name);
    return Promise.resolve().then(() => callback({name})).finally(() => held.delete(name));
}};
const first = createRecordingStorageCoordinator(locks, 'recording-storage');
const second = createRecordingStorageCoordinator(locks, 'recording-storage');
let recordingStorage = first;
"""

tests = r"""
globalThis.testResult = 'pending';
(async () => {
    const lease = await first.hold();
    await rejects(second.run(() => { throw Error('must not enter'); }), 'another tab');
    await rejects(second.hold(), 'another tab');
    await rejects(first.hold(), 'already starting');

    const record = {id:'live', metadata:{id:'live',state:'recording',chunkCount:0,bytesStored:0}};
    await drain(putSession(record.metadata));
    const chunkWrite = persistChunk(record, 0, {size:3, type:'audio/mp4'});
    // Change state before chunk commit. A stale pause snapshot must not undo
    // committed counters, nor may chunk completion undo the in-memory pause.
    record.metadata.state = 'paused';
    const pauseWrite = putSession(record.metadata);
    record.metadata.state = 'finalizing';
    const stopWrite = putSession(record.metadata);
    await drain(Promise.all([chunkWrite,pauseWrite,stopWrite]));
    assert(sessions.get('live').state === 'finalizing', 'latest lifecycle state wins');
    assert(record.metadata.state === 'finalizing', 'chunk completion preserves memory lifecycle');
    assert(sessions.get('live').chunkCount === 1 && sessions.get('live').bytesStored === 3, 'stale lifecycle snapshot preserves committed counters');
    await drain(persistChunk(record, 0, {size:4, type:'audio/mp4'}));
    assert(sessions.get('live').bytesStored === 4 && chunks.size === 1, 'repeated sequence does not double-count bytes');
    await drain(persistChunk(record, 1, {size:5, type:'audio/mp4'}));
    assert(sessions.get('live').chunkCount === 2 && sessions.get('live').bytesStored === 9, 'subsequent chunk counts match storage');

    recordingStorage = second;
    const before = committed;
    await drain(initialize());
    assert(sessions.get('live').state === 'finalizing', 'second-page initialization leaves live session untouched');
    assert(committed === before, 'second-page initialization performs no storage writes');
    await rejects(moveSessionToRecentlyDeleted('live'), 'another tab');
    await rejects(deleteSessionData('live'), 'another tab');
    assert(chunks.size === 2, 'competing deletion preserves live audio');

    recordingStorage = first;
    writingSessions.add('live');
    await rejects(moveSessionToRecentlyDeleted('live'), 'Stop and finish');
    await rejects(deleteSessionData('live'), 'Stop and finish');
    writingSessions.delete('live');
    emergencyRecordings.set('live', {});
    await rejects(moveSessionToRecentlyDeleted('live'), 'unsaved audio');
    emergencyRecordings.delete('live');

    let finishPendingWrite;
    const pendingWrite = first.run(() => new Promise(resolve => { finishPendingWrite = resolve; }));
    for(let i=0;i<6;i++) await Promise.resolve();
    const releasing = lease.release();
    await rejects(second.run(() => {}), 'another tab');
    finishPendingWrite();
    await Promise.all([pendingWrite, releasing]);
    // The Web Locks request settles on a later microtask after release.
    for(let i=0;i<6;i++) await Promise.resolve();
    recordingStorage = second;
    globalThis.checkpoint = 'second initialization';
    await drain(initialize());
    assert(sessions.get('live').state === 'interrupted', 'orphan can be recovered after ownership ends');
    globalThis.checkpoint = 'soft deletion';
    await drain(moveSessionToRecentlyDeleted('live'));
    assert(sessions.get('live').state === 'deleted' && chunks.size === 2, 'soft deletion retains audio');
    globalThis.checkpoint = 'restore';
    await drain(restoreRecentlyDeletedSession('live'));
    assert(sessions.get('live').state === 'interrupted', 'restore remains functional');
    assert(!('deletedAt' in sessions.get('live')) && !('previousState' in sessions.get('live')), 'restore removes deletion metadata');
    await drain(moveSessionToRecentlyDeleted('live'));
    globalThis.checkpoint = 'permanent deletion';
    await drain(deleteSessionData('live'));
    assert(!sessions.has('live') && chunks.size === 0, 'permanent deletion works after ownership release');

    // A failed transaction must not poison subsequent operations or release an
    // active owner's lock. Missing/deleted sessions may not be recreated by chunks.
    await rejects(persistChunk(record, 2, {size:8}), 'aborted');
    await drain(putSession({id:'new',state:'completed',chunkCount:0,bytesStored:0}));
    assert(sessions.has('new') && !sessions.has('live'), 'queue recovers from transaction abort without resurrection');
    const unavailable = createRecordingStorageCoordinator(null, 'unsupported');
    await rejects(unavailable.run(() => sessions.clear()), 'Web Locks');
    await rejects(unavailable.hold(), 'Web Locks');
    assert(sessions.has('new'), 'unsupported coordination fails without mutation');
    globalThis.testResult = 'PASS';
})().catch(error => { globalThis.testResult = String(error) + '\n' + (error.stack || ''); });
"""

if __name__ == "__main__":
    evaluate(coordinator + mock + functions + tests)
    print("PASS: exclusive ownership; competing initialization/deletion; serialized lifecycle/chunk writes; exact counters; abort rollback; queue recovery; orphan recovery; deletion/restore; unsupported coordination")
