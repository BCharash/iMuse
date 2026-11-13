"""Run with python3 tests/test_recording_storage.py. Controlled concurrency tests;
not a substitute for browser IndexedDB/Web Locks or device acceptance tests.
"""
import unittest
from pathlib import Path
from recording_test_support import SOURCE, STORE_SOURCE, STORE_WIRING, between, evaluate


coordinator = (Path(__file__).resolve().parents[1] / "js/recording-storage-coordinator.js").read_text().replace("export ", "")
functions = (
    between("function openDatabase(", "// Independent IndexedDB")
    + between("function getAllSessions(", "function stopStream(")
    + between("async function initialize()", "async function startRecording()")
)

mock = r"""
const assert = (value, message) => { if (!value) throw Error(message); };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const console = {error(){},warn(){}};
const status = {}, window = {indexedDB: {}};
let rendered = 0;
async function renderRecoverableSessions() { rendered++; }
const SESSION_STORE = 'sessions', CHUNK_STORE = 'chunks', EVENT_STORE = 'events';
let sessions = new Map(), chunks = new Map(), events = new Map(), transactions = [], committed = 0;
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
                index() { return {getAll(query) {const request={};operations.push({name,type:'index',query,request});return request;}}; },
                add(value) { operations.push({name,type:'put',value:clone({...value,key:events.size+1})}); },
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
    const oldSessions = new Map(sessions), oldChunks = new Map(chunks), oldEvents = new Map(events);
    while (tx.operations.length && !tx.aborted) {
        const op = tx.operations.shift(), store = op.name === SESSION_STORE ? sessions : op.name === CHUNK_STORE ? chunks : events;
        const key = Array.isArray(op.key) ? JSON.stringify(op.key) : op.key;
        if (op.type === 'get' || op.type === 'all' || op.type === 'index') {
            op.request.result = clone(op.type === 'index' ? [...store.values()].filter(value=>value.sessionId===op.query) : op.type === 'all' ? [...store.values()] : store.get(key));
            op.request.onsuccess?.();
        } else if (op.type === 'put') {
            const id = op.name === SESSION_STORE ? op.value.id : op.name === CHUNK_STORE ? JSON.stringify([op.value.sessionId,op.value.sequence]) : op.value.key;
            store.set(id, op.value);
        } else store.delete(key);
    }
    if (tx.aborted) {
        sessions = oldSessions; chunks = oldChunks; events = oldEvents;
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
const opened = [];
const databaseFactory = {open(name,version){
    opened.push([name,version]);
    const request={};
    Promise.resolve().then(()=>{request.result=db;request.onsuccess();});
    return request;
}};
const secondStore = createRecordingStore({coordinator:second,assertSessionIdle,databaseFactory,keyRange:{only:id=>id}});
globalThis.indexedDB = databaseFactory;
globalThis.IDBKeyRange = {only:id=>id};
"""

tests = r"""
globalThis.testResult = 'pending';
(async () => {
    await recordingStore.open();
    assert(recordingStore.isOpen() && opened[0][0]==='imuse-recording-breadboard' && opened[0][1]===2,'same database and schema version');
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
    firstStore.appendEvent({sessionId:'live',type:'first'});
    await drain(firstStore.getRecordingEvents('live'));
    firstStore.appendEvent({sessionId:'other',type:'unrelated'});
    await drain(firstStore.getRecordingEvents('other'));
    assert(events.size===2 && chunks.size===2,'diagnostics do not change audio chunks');

    recordingStorage = second; recordingStore = secondStore;
    const before = committed;
    await drain(initialize());
    assert(sessions.get('live').state === 'finalizing', 'second-page initialization leaves live session untouched');
    assert(committed === before, 'second-page initialization performs no storage writes');
    await rejects(moveSessionToRecentlyDeleted('live'), 'another tab');
    await rejects(deleteSessionData('live'), 'another tab');
    assert(chunks.size === 2, 'competing deletion preserves live audio');

    recordingStorage = first; recordingStore = firstStore;
    writingSessions.add('live');
    await rejects(moveSessionToRecentlyDeleted('live'), 'Stop and finish');
    await rejects(moveSessionToRecentlyDeleted('live',{discardEmergency:true}), 'Stop and finish');
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
    recordingStorage = second; recordingStore = secondStore;
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
    assert(events.size===1 && [...events.values()][0].sessionId==='other','permanent deletion cleans only target diagnostics');

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

schema_tests = r"""
const assert=(value,message)=>{if(!value)throw Error(message);};
const warnings=[];
const console={warn:(...args)=>warnings.push(args)};
globalThis.testResult='pending';
(async()=>{
    const schemas=new Map(),indexes=[];
    let opens=0,closed=0,request,lastStore=null,transactions=[];
    const database={
        objectStoreNames:{contains:name=>schemas.has(name)},
        createObjectStore(name,options){
            schemas.set(name,options);
            return {createIndex:(...args)=>indexes.push([name,...args])};
        },
        close(){closed++;},
        transaction(name,mode){
            transactions.push([name,mode]);
            throw Error('diagnostic write denied');
        }
    };
    const factory={open(name,version){
        assert(name==='imuse-recording-breadboard'&&version===2,'existing name/version retained');
        opens++;request={result:database};return request;
    }};
    const coordinator={run:operation=>operation()};
    const store=createRecordingStore({coordinator,assertSessionIdle(){},databaseFactory:factory});
    assert(opens===0&&!store.isOpen(),'constructor does not open storage');
    store.appendEvent({sessionId:'test'});
    assert(transactions.length===0,'diagnostics before initialization are ignored');
    const opening=store.open();
    request.onupgradeneeded();
    request.onsuccess();
    await opening;
    assert(store.isOpen()&&schemas.size===3,'new database creates all existing stores');
    assert(schemas.get('sessions').keyPath==='id','session key preserved');
    assert(schemas.get('chunks').keyPath.join(',')==='sessionId,sequence','chunk compound key preserved');
    assert(schemas.get('recordingEvents').autoIncrement===true,'event key generation preserved');
    assert(indexes.length===2&&indexes.every(index=>index[1]==='sessionId'&&index[2]==='sessionId'&&index[3].unique===false),'session lookup indexes preserved');
    const reopening=store.open();
    request.onupgradeneeded();request.onsuccess();await reopening;
    assert(schemas.size===3&&indexes.length===2,'existing schemas are not recreated');
    store.appendEvent({sessionId:'test'});
    assert(warnings.length===1&&transactions.length===1&&transactions[0][0]==='recordingEvents','diagnostic failure is best effort and isolated');

    const blocked=createRecordingStore({coordinator,assertSessionIdle(){},databaseFactory:factory});
    const pending=blocked.open().then(()=>null,error=>error);
    request.onblocked();
    assert((await pending).message.includes('blocked')&&!blocked.isOpen(),'blocked opening reports unavailable');
    request.onsuccess();
    assert(closed===1&&!blocked.isOpen(),'late opening cannot make failed initialization ready');
    const failed=createRecordingStore({coordinator,assertSessionIdle(){},databaseFactory:factory});
    const failure=failed.open().then(()=>null,error=>error);
    request.error=Error('opening failed');request.onerror();
    assert((await failure).message==='opening failed'&&!failed.isOpen(),'opening failure preserves unavailable state');
    globalThis.testResult='PASS';
})().catch(error=>{globalThis.testResult=String(error)+'\n'+(error.stack||'');});
"""

class RecordingStorageTests(unittest.TestCase):
    def test_coordinated_storage(self):
        wiring = STORE_WIRING.replace("const recordingStore", "let recordingStore") + "const firstStore = recordingStore;\n"
        evaluate(coordinator + STORE_SOURCE + mock + functions + wiring + tests)

    def test_download_marker_preserves_audio_state_and_survives_archive(self):
        wiring = STORE_WIRING.replace("const recordingStore", "let recordingStore")
        evaluate(coordinator + STORE_SOURCE + mock + functions + wiring + r"""
globalThis.testResult='pending';
(async()=>{
 await openDatabase();
 const original={id:'downloaded',state:'completed',chunkCount:8,bytesStored:12345,startedAt:'2026-11-01T12:00:00Z'};
 sessions.set(original.id,original);
 await drain(recordingStore.markDownloadRequested(original.id));
 const marked=sessions.get(original.id),stamp=marked.downloadRequestedAt;
 assert(stamp&&marked.chunkCount===8&&marked.bytesStored===12345&&marked.state==='completed','download request adds metadata without altering capture');
 await drain(moveSessionToRecentlyDeleted(original.id));
 await drain(restoreRecentlyDeletedSession(original.id));
 assert(sessions.get(original.id).downloadRequestedAt===stamp&&sessions.get(original.id).startedAt===original.startedAt,'unarchive retains reminder and original chronology');
 sessions.delete(original.id);await drain(recordingStore.markDownloadRequested(original.id));
 assert(!sessions.has(original.id),'marking retained playback never recreates a permanently deleted session');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_combine_atomic_publication_and_failure_retains_originals(self):
        wiring = STORE_WIRING.replace("const recordingStore", "let recordingStore")
        evaluate(coordinator + STORE_SOURCE + mock + functions + wiring + r"""
globalThis.testResult='pending';
(async()=>{
 await openDatabase();
 for(const id of ['a','b']) {
  sessions.set(id,{id,state:'completed',chunkCount:1,bytesStored:3});
  chunks.set(JSON.stringify([id,0]),{sessionId:id,sequence:0,blob:{size:3},bytes:3});
 }
 const before=JSON.stringify([...sessions]),audioBefore=JSON.stringify([...chunks]);
 const make=async inputs=>{assert(inputs.length===2&&inputs[0].chunks.length===1,'full inputs read under lock');return {session:{id:'combined',state:'completed',chunkCount:1,bytesStored:6},blob:{size:6,type:'audio/mp4'}};};
 await drain(recordingStore.combineSessions(['b','a'],make));
 assert(sessions.get('combined').state==='completed'&&chunks.has(JSON.stringify(['combined',0])),'new session and audio committed');
 assert(JSON.stringify([...sessions].filter(([id])=>id!=='combined'))===before&&JSON.stringify([...chunks].filter(([key])=>!key.includes('combined')))===audioBefore,'original metadata and audio unchanged');
 const size=sessions.size,chunkSize=chunks.size;
 await rejects(recordingStore.combineSessions(['a','b'],async()=>{throw Error('bad AAC');}),'bad AAC');
 assert(sessions.size===size&&chunks.size===chunkSize,'worker failure publishes nothing');
 // Abort the publication transaction after its writes have been queued.
 const realTransaction=db.transaction;
 db.transaction=function(names,mode){const tx=realTransaction.call(db,names,mode);if(Array.isArray(names)&&mode==='readwrite')tx.aborted=true;return tx;};
 await rejects(recordingStore.combineSessions(['a','b'],async()=>({session:{id:'aborted',state:'completed',bytesStored:6},blob:{size:6,type:'audio/mp4'}})),'aborted');
 db.transaction=realTransaction;
 assert(!sessions.has('aborted')&&!chunks.has(JSON.stringify(['aborted',0])),'transaction abort leaves neither half');
 await rejects(recordingStore.combineSessions(['a','a'],make),'different');
 sessions.get('b').state='deleted';await rejects(recordingStore.combineSessions(['a','b'],make),'finished');sessions.get('b').state='completed';
 const lease=await second.hold();await rejects(recordingStore.combineSessions(['a','b'],make),'another tab');await lease.release();
 assert(sessions.size===size&&chunks.size===chunkSize,'rejections preserve all originals');
 globalThis.testResult='PASS';
})().catch(error=>globalThis.testResult=String(error)+String(error.stack));
""")

    def test_store_schema_and_open_failures(self):
        evaluate(STORE_SOURCE + schema_tests)


if __name__ == "__main__":
    unittest.main()
