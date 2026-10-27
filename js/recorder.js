const recordButton = document.getElementById("recordButton");
const pauseButton = document.getElementById("pauseButton");
const audioPlayer = document.getElementById("audioPlayer");
const recordingControls = document.getElementById("recordingControls");
const deleteButton = document.getElementById("deleteButton");
const status = document.getElementById("status");

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

function playReadyChime() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const now = audioContext.currentTime;
    const oscillator1 = audioContext.createOscillator();
    const oscillator2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator1.frequency.value = 659.25;
    oscillator2.frequency.value = 783.99;
    oscillator1.type = "sine";
    oscillator2.type = "sine";
    oscillator1.connect(gain);
    oscillator2.connect(gain);
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    oscillator1.start(now);
    oscillator2.start(now + 0.12);
    oscillator1.stop(now + 0.35);
    oscillator2.stop(now + 0.47);
    oscillator2.addEventListener("ended", () => audioContext.close(), { once: true });
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

async function startRecording() {
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
        const recorder = new MediaRecorder(stream);
        const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const metadata = {
            id,
            state: "recording",
            startedAt: new Date().toISOString(),
            mimeType: recorder.mimeType || "audio/webm",
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
            sequence: 0,
            writeQueue: Promise.resolve(),
            persistenceError: null,
            memoryChunks: [],
            discard: false,
            stopHandled: false
        };
        activeSession = current;
        recorder.addEventListener("dataavailable", event => {
            if (current.discard || !event.data || !event.data.size) return;
            const sequence = current.sequence++;
            current.memoryChunks.push(event.data);
            current.writeQueue = current.writeQueue.then(async () => {
                if (current.discard) return;
                await persistChunk(current, sequence, event.data);
                status.textContent = `Recording — ${current.metadata.chunkCount} chunks saved to this browser.`;
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
            status.textContent = `Paused — ${current.metadata.chunkCount} chunks saved so far.`;
        });
        recorder.addEventListener("resume", async () => {
            if (activeSession !== current || current.discard) return;
            current.metadata.state = "recording";
            current.metadata.lastUpdatedAt = new Date().toISOString();
            try { await putSession(current.metadata); } catch (error) { console.error(error); }
            pauseButton.textContent = "Pause";
            status.textContent = "Recording resumed.";
        });
        recorder.addEventListener("stop", async () => {
            if (current.stopHandled) return;
            current.stopHandled = true;
            stopStream(stream);
            if (activeSession === current) activeSession = null;
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
                finalBlob = new Blob(parts, { type: current.metadata.mimeType || "audio/webm" });
                if (!finalBlob.size) throw new Error("No saved audio chunks were found.");
                current.metadata.state = "completed";
                current.metadata.completedAt = new Date().toISOString();
                current.metadata.lastUpdatedAt = current.metadata.completedAt;
                await putSession(current.metadata);
                showPlayback(finalBlob, id);
                status.textContent = `Recording complete. ${savedChunks.length} chunks were saved to this browser.`;
            } catch (error) {
                console.error("Could not finalize persisted recording:", error);
                finalBlob = new Blob(current.memoryChunks, { type: current.metadata.mimeType || "audio/webm" });
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
        recorder.start(250);
        recordButton.textContent = "Stop Recording";
        recordButton.disabled = false;
        pauseButton.textContent = "Pause";
        pauseButton.disabled = false;
        status.textContent = "Recording — saving audio chunks as they arrive.";
        playReadyChime();
    } catch (error) {
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
    const current = activeSession;
    if (current.recorder.state === "recording" || current.recorder.state === "paused") {
        recordButton.disabled = true;
        pauseButton.disabled = true;
        current.metadata.state = "finalizing";
        current.metadata.lastUpdatedAt = new Date().toISOString();
        putSession(current.metadata).catch(error => console.error("Could not mark session finalizing:", error));
        status.textContent = "Finalizing recording...";
        current.recorder.stop();
    }
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

initialize();
