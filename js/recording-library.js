// Saved/Recently Deleted UI owns its DOM, dialog and playback URL. Capture,
// storage transactions, recovery decisions and emergency audio remain in recorder.
export function createRecordingLibrary({
    container, status, getAllSessions, getEmergencyRecordings, isSessionWriting,
    recoverSession, exportSavedSession, moveSessionToRecentlyDeleted, getSession,
    deleteSessionData, restoreRecentlyDeletedSession, downloadRecordingEvents,
    pauseCurrentPlayback
}) {
    let recoveryPanel = null;
    let savedPlayback = null;
    let savedPlaybackRequest = 0;

    function closeSavedPlayback() {
        if (!savedPlayback) return;
        const previous = savedPlayback;
        savedPlayback = null;
        previous.player.pause();
        previous.player.removeAttribute("src");
        previous.player.load();
        URL.revokeObjectURL(previous.url);
        if (previous.dialog.open && typeof previous.dialog.close === "function") previous.dialog.close();
        previous.dialog.remove();
    }

    function showSavedPlayback(blob, id) {
        closeSavedPlayback();
        pauseCurrentPlayback();
        const dialog = document.createElement("dialog");
        dialog.className = "saved-audio-dialog";
        dialog.setAttribute("data-session-id", id);
        dialog.setAttribute("aria-label", "Saved recording player");
        const heading = document.createElement("h3");
        heading.textContent = "Saved recording";
        const player = document.createElement("audio");
        player.controls = true;
        player.preload = "metadata";
        const url = URL.createObjectURL(blob);
        player.src = url;
        player.type = blob.type || "audio/webm";
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.addEventListener("click", closeSavedPlayback);
        dialog.addEventListener("close", () => {
            if (savedPlayback?.dialog === dialog) closeSavedPlayback();
        });
        dialog.append(heading, player, close);
        savedPlayback = { id, player, dialog, url };
        document.body.appendChild(dialog);
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
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
        container.appendChild(recoveryPanel);
        return recoveryPanel;
    }

    function formatDate(value) {
        if (!value) return "Unknown time";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
    }

    async function renderRecoverableSessions() {
        const panel = ensureRecoveryPanel();
        let allSessions = [], readError = null;
        try { allSessions = await getAllSessions(); }
        catch (error) { readError = error; }
        const emergencyRecordings = getEmergencyRecordings();
        const available = new Map(allSessions.filter(item =>
            ["completed", "recording", "paused", "interrupted", "finalizing", "storage-error"].includes(item.state)
        ).map(item => [item.id, item]));
        for (const [id, emergency] of emergencyRecordings) {
            available.set(id, { ...emergency.metadata, id, state: "storage-error" });
        }
        const sessions = [...available.values()].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
        const deletedSessions = allSessions.filter(item => item.state === "deleted" && !emergencyRecordings.has(item.id))
            .sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
        panel.replaceChildren();
        const heading = document.createElement("h2");
        heading.textContent = "Saved recordings";
        heading.style.fontSize = "1.1rem";
        panel.appendChild(heading);
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.textContent = "Refresh recordings";
        refresh.addEventListener("click", () => {
            void renderRecoverableSessions().catch(error => console.error(error));
        });
        panel.appendChild(refresh);
        panel.hidden = !sessions.length && !deletedSessions.length && !readError;
        if (readError) {
            const notice = document.createElement("p");
            notice.textContent = "Saved recordings could not be read. Any available emergency audio is listed below. Browser data has not been cleared.";
            panel.appendChild(notice);
        }
        if (sessions.length) {
            const explanation = document.createElement("p");
            explanation.textContent = "Saved recordings remain available after reopening. Interrupted audio may be incomplete.";
            panel.appendChild(explanation);
        }
        for (const item of sessions) {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.flexWrap = "wrap";
            row.style.alignItems = "center";
            row.style.gap = "0.5rem";
            row.style.marginTop = "0.5rem";
            const label = document.createElement("span");
            label.style.flex = "1 1 12rem";
            const emergency = emergencyRecordings.get(item.id);
            const busy = !emergency && (isSessionWriting(item.id) || ["recording", "paused", "finalizing"].includes(item.state));
            label.textContent = emergency
                ? `${formatDate(item.startedAt)} — ${formatRecordingSize(emergency.blob.size)}. ${emergency.unsavedBytes ? "Includes unsaved audio" : "Recovery copy; finalization was delayed"}; download before closing or reloading.`
                : `${formatDate(item.startedAt)} — ${formatRecordingSize(item.bytesStored)}${busy ? " — recording or finishing" : ""}`;
            if (item.integrityReport?.ok === false) label.textContent += " — audio may be incomplete";
            else if (item.state === "interrupted") label.textContent += " — interrupted recording";
            row.appendChild(label);
            const recoverButton = document.createElement("button");
            recoverButton.type = "button";
            recoverButton.textContent = "▶";
            recoverButton.className = "saved-audio-open";
            recoverButton.title = "Open audio player";
            recoverButton.setAttribute("aria-label", `Play recording from ${formatDate(item.startedAt)}`);
            recoverButton.setAttribute("aria-haspopup", "dialog");
            recoverButton.disabled = busy;
            recoverButton.addEventListener("click", () => {
                void loadRecording(item.id, recoverButton);
            });
            row.appendChild(recoverButton);
            const downloadButton = document.createElement("button");
            downloadButton.type = "button";
            downloadButton.textContent = "Download audio";
            downloadButton.disabled = busy;
            downloadButton.addEventListener("click", () => exportSavedSession(item.id, downloadButton));
            row.appendChild(downloadButton);
            const discardButton = document.createElement("button");
            discardButton.type = "button";
            discardButton.textContent = "Delete";
            discardButton.disabled = busy || !!emergency;
            discardButton.addEventListener("click", async () => {
                discardButton.disabled = true;
                try {
                    await moveSessionToRecentlyDeleted(item.id);
                    if (savedPlayback?.id === item.id) closeSavedPlayback();
                    // Saved-list actions leave the current in-memory player intact.
                    status.textContent = "Recording moved to Recently Deleted. It can be restored.";
                    await renderRecoverableSessions();
                } catch (error) {
                    console.error(error);
                    status.textContent = "Could not move the recording to Recently Deleted.";
                    discardButton.disabled = false;
                }
            });
            row.appendChild(discardButton);
            // Keep stop diagnostics available for every saved recording: an
            // unexpected stop may still leave a session marked completed.
            // Keep this secondary action last in the row.
            {
                const diagnosticButton = document.createElement("button");
                diagnosticButton.type = "button";
                diagnosticButton.textContent = "↓";
                diagnosticButton.className = "recording-diagnostic-download";
                diagnosticButton.title = "Download stop diagnostics";
                diagnosticButton.setAttribute("aria-label", "Download stop diagnostics");
                diagnosticButton.addEventListener("click", () => {
                    downloadRecordingEvents(item.id).catch(error => {
                        console.error("Could not export diagnostics:", error);
                        status.textContent = "Could not export recording diagnostics.";
                    });
                });
                const diagnostics = document.createElement("span");
                diagnostics.className = "recording-diagnostic-action";
                const description = document.createElement("span");
                description.textContent = "Stop diagnostics";
                diagnostics.append(diagnosticButton, description);
                row.appendChild(diagnostics);

            }
            panel.appendChild(row);
        }
        if (deletedSessions.length) {
            const section = document.createElement("section");
            section.setAttribute("aria-label", "Recently Deleted recordings");
            const heading = document.createElement("h3");
            heading.textContent = `Recently Deleted (${deletedSessions.length})`;
            section.appendChild(heading);
            const note = document.createElement("p");
            note.textContent = "Deleted recordings remain in browser storage until permanently deleted. Browser storage is not a guaranteed backup.";
            section.appendChild(note);
            const selectionBar = document.createElement("div");
            selectionBar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:.75rem 0";
            const selectAllLabel = document.createElement("label");
            selectAllLabel.style.cssText = "display:inline-flex;align-items:center;gap:.35rem";
            const selectAll = document.createElement("input");
            selectAll.type = "checkbox";
            selectAll.setAttribute("aria-label", "Select all recently deleted recordings");
            selectAllLabel.append(selectAll, document.createTextNode("Select all"));
            const selectionCount = document.createElement("span");
            const deleteSelectedButton = document.createElement("button");
            deleteSelectedButton.type = "button";
            deleteSelectedButton.textContent = "Delete selected permanently";
            const selectedIds = new Set();
            const selectionBoxes = [];
            function updateSelection() {
                selectionCount.textContent = `${selectedIds.size} selected`;
                deleteSelectedButton.disabled = selectedIds.size === 0;
                selectAll.checked = selectedIds.size === deletedSessions.length;
                selectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < deletedSessions.length;
            }
            selectAll.addEventListener("change", () => {
                selectedIds.clear();
                for (const checkbox of selectionBoxes) {
                    checkbox.checked = selectAll.checked;
                    if (checkbox.checked) selectedIds.add(checkbox.value);
                }
                updateSelection();
            });
            deleteSelectedButton.addEventListener("click", async () => {
                const ids = [...selectedIds];
                if (!ids.length) return;
                if (!window.confirm(`Permanently delete ${ids.length} selected recording${ids.length === 1 ? "" : "s"} and all their saved audio? This cannot be undone.`)) return;
                deleteSelectedButton.disabled = true;
                selectAll.disabled = true;
                for (const checkbox of selectionBoxes) checkbox.disabled = true;
                let deleted = 0;
                const failures = [];
                for (const id of ids) {
                    try {
                        const current = await getSession(id);
                        if (!current || current.state !== "deleted") throw new Error("Recording is no longer in Recently Deleted.");
                        await deleteSessionData(id);
                        if (savedPlayback?.id === id) closeSavedPlayback();
                        deleted++;
                    } catch (error) {
                        console.error("Could not permanently delete selected recording:", error);
                        failures.push(id);
                    }
                }
                status.textContent = failures.length
                    ? `${deleted} recording(s) permanently deleted; ${failures.length} could not be deleted and remain available.`
                    : `${deleted} recording(s) permanently deleted.`;
                try {
                    await renderRecoverableSessions();
                } catch (error) {
                    console.error("Could not refresh recordings after deletion:", error);
                    status.textContent += " Refresh the page to update the list.";
                    selectAll.disabled = false;
                    for (const checkbox of selectionBoxes) checkbox.disabled = false;
                    updateSelection();
                }
            });
            selectionBar.append(selectAllLabel, selectionCount, deleteSelectedButton);
            section.appendChild(selectionBar);
            updateSelection();
            for (const item of deletedSessions) {
                const row = document.createElement("div");
                row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-top:.5rem";
                const selectionBox = document.createElement("input");
                selectionBox.type = "checkbox";
                selectionBox.value = item.id;
                selectionBox.setAttribute("aria-label", `Select recording from ${formatDate(item.startedAt)} for permanent deletion`);
                selectionBox.addEventListener("change", () => {
                    if (selectionBox.checked) selectedIds.add(item.id);
                    else selectedIds.delete(item.id);
                    updateSelection();
                });
                selectionBoxes.push(selectionBox);
                row.appendChild(selectionBox);
                const label = document.createElement("span");
                label.style.flex = "1 1 12rem";
                label.textContent = `${formatDate(item.startedAt)} — ${formatRecordingSize(item.bytesStored)} — deleted ${formatDate(item.deletedAt)}`;
                row.appendChild(label);
                const restoreButton = document.createElement("button");
                restoreButton.type = "button";
                restoreButton.textContent = "Restore";
                restoreButton.addEventListener("click", async () => {
                    restoreButton.disabled = true;
                    try {
                        await restoreRecentlyDeletedSession(item.id);
                        status.textContent = "Recording restored to Saved recordings.";
                        await renderRecoverableSessions();
                    } catch (error) {
                        status.textContent = `Could not restore recording: ${error.message || error}`;
                        restoreButton.disabled = false;
                    }
                });
                row.appendChild(restoreButton);
                const permanentButton = document.createElement("button");
                permanentButton.type = "button";
                permanentButton.textContent = "Delete Permanently";
                permanentButton.addEventListener("click", async () => {
                    if (!window.confirm("Permanently delete this recording and its saved audio? This cannot be undone.")) return;
                    permanentButton.disabled = true;
                    try {
                        const current = await getSession(item.id);
                        if (!current || current.state !== "deleted") throw new Error("Recording is no longer in Recently Deleted.");
                        await deleteSessionData(item.id);
                        if (savedPlayback?.id === item.id) closeSavedPlayback();
                        status.textContent = "Recording permanently deleted.";
                        await renderRecoverableSessions();
                    } catch (error) {
                        status.textContent = `Could not permanently delete recording: ${error.message || error}`;
                        permanentButton.disabled = false;
                    }
                });
                row.appendChild(permanentButton);
                section.appendChild(row);
            }
            panel.appendChild(section);
        }
    }

    async function loadRecording(id, button) {
        const request = ++savedPlaybackRequest;
        return recoverSession(id, button, (blob, sessionId) => {
            if (request === savedPlaybackRequest) showSavedPlayback(blob, sessionId);
        });
    }

    return {
        render: renderRecoverableSessions,
        showPlayback: showSavedPlayback,
        closePlayback: closeSavedPlayback
    };
}

export function formatRecordingSize(bytes) {
    return `${(Math.max(0, Number(bytes) || 0) / 1024).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
}

