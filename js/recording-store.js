// Owns IndexedDB I/O. Capture, emergency memory and completion decisions remain
// with the caller. All audio/session mutations share its existing coordinator.
export const RECORDING_DB_NAME = "imuse-recording-breadboard";
export const RECORDING_DB_VERSION = 2;

export function createRecordingStore({
    coordinator: recordingStorage,
    assertSessionIdle,
    databaseFactory,
    keyRange
}) {
    const DB_NAME = RECORDING_DB_NAME;
    const DB_VERSION = RECORDING_DB_VERSION;
    const SESSION_STORE = "sessions";
    const CHUNK_STORE = "chunks";
    const EVENT_STORE = "recordingEvents";
    let db = null;

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = (databaseFactory || globalThis.indexedDB).open(DB_NAME, DB_VERSION);
            let settled = false;
            const fail = error => { settled = true; reject(error); };
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
            request.onsuccess = () => {
                // A blocked request can succeed later. A rejected initialization
                // must not silently make this store ready or leak that connection.
                if (settled) { request.result.close(); return; }
                settled = true;
                db = request.result;
                resolve();
            };
            request.onerror = () => fail(request.error || new Error("Could not open IndexedDB."));
            request.onblocked = () => fail(new Error("The recording database is blocked by another open page."));
        });
    }

    function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
            transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
        });
    }

    async function getRecordingEvents(sessionId) {
        const transaction = db.transaction(EVENT_STORE, "readonly");
        const request = transaction.objectStore(EVENT_STORE).index("sessionId").getAll((keyRange || globalThis.IDBKeyRange).only(sessionId));
        const result = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
        await transactionDone(transaction);
        return result;
    }

    function appendEvent(entry) {
        if (!db) return;
        try {
            const transaction = db.transaction(EVENT_STORE, "readwrite");
            transaction.objectStore(EVENT_STORE).add(entry);
            transaction.onerror = () => console.warn("Could not save recording diagnostic event:", transaction.error);
        } catch (error) { console.warn("Could not log recording event:", error); }
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

    async function persistChunk(id, sequence, blob) {
        return recordingStorage.run(async () => {
            const transaction = db.transaction([SESSION_STORE, CHUNK_STORE], "readwrite");
            const done = transactionDone(transaction);
            const sessions = transaction.objectStore(SESSION_STORE);
            const chunks = transaction.objectStore(CHUNK_STORE);
            let updated;
            const request = sessions.get(id);
            request.onsuccess = () => {
                if (!request.result || request.result.state === "deleted") {
                    transaction.abort();
                    return;
                }
                const stored = request.result;
                const previous = chunks.get([id, sequence]);
                previous.onsuccess = () => {
                    updated = { ...stored,
                        chunkCount: Math.max(stored.chunkCount || 0, sequence + 1),
                        bytesStored: (stored.bytesStored || 0) - (previous.result?.bytes || 0) + blob.size,
                        lastPersistedAt: new Date().toISOString() };
                    chunks.put({ sessionId: id, sequence,
                        type: blob.type || stored.mimeType, blob, bytes: blob.size });
                    sessions.put(updated);
                };
            };
            await done;
            return { chunkCount: updated.chunkCount, bytesStored: updated.bytesStored,
                lastPersistedAt: updated.lastPersistedAt };
        });
    }

    async function getChunks(id) {
        const transaction = db.transaction(CHUNK_STORE, "readonly");
        const result = await new Promise((resolve, reject) => {
            const request = transaction.objectStore(CHUNK_STORE).index("sessionId").getAll((keyRange || globalThis.IDBKeyRange).only(id));
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

    return {
        open: openDatabase,
        isOpen: () => Boolean(db),
        getAllSessions, getSession, getChunks,
        putSession, persistChunk,
        // Only for operations already inside the same coordinator.run callback;
        // queuing again there would deadlock. Normal callers use putSession.
        putSessionOwned: putSessionNow,
        deleteSessionData, moveSessionToRecentlyDeleted, restoreRecentlyDeletedSession,
        appendEvent, getRecordingEvents
    };
}
