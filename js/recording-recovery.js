import { inspectRecordingChunks, recordingCompletion } from "./recording-integrity.js";

// Owns recovery copies, assembly/validation and finalization. The caller retains
// microphone lifecycle, pending chunk writes and the writer lease.
export function createRecordingRecovery({
    recordingStorage, status, getSession, getChunks, putSession, putSessionNow,
    assertSessionIdle, showPlayback, downloadAudioBlob, sessionFilename,
    renderRecoverableSessions, logRecordingEvent, onStopDelayed,
    moveSessionToRecentlyDeleted,
    onEmergencyRetained = () => {}, onEmergencyDiscarded = () => {}
}) {
    const emergencyRecordings = new Map();
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
        if (!current.stopHandled) onStopDelayed(current);
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
        onEmergencyRetained(current, blob, emergencyRecordings.get(current.id).unsavedBytes);
    }

    function playEmergencyRecording(id, present = showPlayback) {
        const emergency = emergencyRecordings.get(id);
        if (!emergency) return false;
        present(emergency.blob, id, emergency.metadata);
        status.textContent = emergency.unsavedBytes
            ? "Available audio loaded, including unsaved audio. Download it before closing or reloading iMuse and check for missing sections."
            : "Recovery audio loaded. Finalization was delayed; check for missing sections and download before closing or reloading iMuse.";
        return true;
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
                if (await downloadAudioBlob(emergency.blob, sessionFilename(emergency.metadata)) === false) {
                    status.textContent = "Download canceled. Emergency recording retained.";
                    return;
                }
                status.textContent = "Emergency download started. Check the exported audio before closing or reloading iMuse; the emergency copy remains available here.";
                return true;
            }
            const prepared = await recordingStorage.run(async () => {
                assertSessionIdle(id);
                const item = await boundedStorageRead(getSession(id));
                if (!item || item.state === "deleted") throw new Error("This session is unavailable. Unarchive this recording before loading it.");
                const chunks = await boundedStorageRead(getChunks(id));
                const { blob, report } = assembleSavedAudio(item, chunks);
                return { blob, report, item };
            });
            // Release the writer lock before waiting for the user's filename choice.
            if (await downloadAudioBlob(prepared.blob, sessionFilename(prepared.item)) === false) {
                status.textContent = "Download canceled. Recording retained.";
                return;
            }
            status.textContent = `Recording download requested.${integrityNotice(prepared.report)}`;
            return true;
        } catch (error) {
            console.error("Could not export saved recording:", error);
            status.textContent = `Could not export audio: ${error.message || "unknown error"}`;
        } finally {
            if (button) button.disabled = false;
        }
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
                if (!item || item.state === "deleted") throw new Error("This session is unavailable. Unarchive this recording before loading it.");
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
                present(blob, id, item);
                status.textContent = state === "completed"
                    ? "Audio recording successful."
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

    async function finalize(current) {
        const id = current.id;
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
            showPlayback(finalBlob, id, current.metadata);
            status.textContent = emergencyRecordings.get(id)?.unsavedBytes
                ? "Audio recording unsuccessful."
                : current.metadata.state === "completed"
                ? "Audio recording successful."
                : "Audio recording unsuccessful.";
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
                showPlayback(emergencyRecordings.get(id).blob, id, emergencyRecordings.get(id).metadata);
            }
            current.metadata.state = error.integrityReport ? "interrupted" : "storage-error";
            current.metadata.finalizationError = String(error.message || error);
            current.metadata.interruptedAt ||= new Date().toISOString();
            current.metadata.interruptionReasons = [...new Set([...(current.metadata.interruptionReasons || []), "Finalization could not be verified"])];
            if (error.integrityReport) current.metadata.integrityReport = error.integrityReport;
            current.metadata.lastUpdatedAt = new Date().toISOString();
            try { await putSession(current.metadata); } catch (saveError) { console.error(saveError); }
            status.textContent = "Audio recording unsuccessful.";
        }
    }

    function finish(current) {
        current.finalizationFinished = true;
        clearTimeout(current.finalizationTimer);
    }

    async function discardEmergencyRecording(id) {
        const emergency = emergencyRecordings.get(id);
        if (!emergency) return;
        // The store still checks active/finalizing ownership. Release memory
        // only after the committed portion has been safely soft deleted.
        await moveSessionToRecentlyDeleted(id, { discardEmergency: true });
        if (emergencyRecordings.get(id) !== emergency) throw new Error("The recovery copy changed; review it before discarding.");
        emergencyRecordings.delete(id);
        onEmergencyDiscarded(id);
    }

    return {
        emergencies: emergencyRecordings,
        boundedRead: boundedStorageRead,
        armWatchdog: armFinalizationWatchdog,
        offerDelayedFinalization, retainEmergencyRecording,
        recoverSession, exportSavedSession, finalize, finish, discardEmergencyRecording
    };
}
