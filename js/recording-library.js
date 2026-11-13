// Saved/Archived Recordings UI owns its DOM, dialog and playback URL. Capture,
// storage transactions, recovery decisions and emergency audio remain in recorder.
export function createRecordingLibrary({
    container, status, getAllSessions, getEmergencyRecordings, isSessionWriting,
    recoverSession, exportSavedSession, moveSessionToRecentlyDeleted, getSession,
    deleteSessionData, restoreRecentlyDeletedSession, downloadRecordingEvents,
    pauseCurrentPlayback, discardEmergencyRecording, wasDownloadRequested = () => false,
    combineRecordings
}) {
    let recoveryPanel = null;
    let renderGeneration = 0;
    const categoryOpen = {saved:false, archived:false};
    let combineMode = false, combineController = null, combineSaving = false;
    let combineMessage = '', combineProgress = null, combineCancel = null;
    const combineSelection = new Set();

    function sourcesDisclosure(row, item) {
        const metadata = item.combineMetadata;
        if (!metadata?.segments?.length) return;
        const details = document.createElement('details');
        details.className = 'recording-sources';
        const summary = document.createElement('summary');
        summary.textContent = `Sources (${metadata.segments.length})`;
        const list = document.createElement('ol');
        for (const segment of metadata.segments) {
            const source = metadata.sources.find(source => source.id === segment.sourceId);
            const entry = document.createElement('li');
            entry.textContent = `${formatDate(segment.capturedAt)} — ${source?.filename || 'Recording'} — ${(segment.sampleCount / metadata.sampleRate).toFixed(1)} s`;
            list.appendChild(entry);
        }
        details.append(summary, list); row.appendChild(details);
    }

    function combineToolbar(body, sessions, emergencies) {
        if (!combineRecordings) return () => {};
        const available = new Set(sessions.filter(item => item.state === 'completed' && item.integrityReport?.ok !== false && !emergencies.has(item.id) && !isSessionWriting(item.id)).map(item => item.id));
        for (const id of combineSelection) if (!available.has(id)) combineSelection.delete(id);
        const toolbar = document.createElement('div'); toolbar.className = 'recording-combine-controls';
        const action = document.createElement('button'); action.type = 'button';
        action.textContent = combineMode ? `Combine selected (${combineSelection.size})` : 'Combine';
        const sync = () => { action.textContent = combineMode ? `Combine selected (${combineSelection.size})` : 'Combine'; action.disabled = Boolean(combineController) || (combineMode ? combineSelection.size < 2 : available.size < 2); };
        action.addEventListener('click', async () => {
            if (!combineMode) { combineMode = true; combineSelection.clear(); await renderRecoverableSessions({preservePosition:true}); return; }
            if (combineController || combineSelection.size < 2) return;
            combineController = new AbortController(); combineSaving = false; combineMessage = 'Preparing combined recording…';
            const controller = combineController;
            const ids = [...combineSelection];
            await renderRecoverableSessions({preservePosition:true});
            try {
                await combineRecordings(ids, {signal:controller.signal, onProgress:(message,options={}) => {
                    combineMessage = message; combineSaving = Boolean(options.saving);
                    if (combineProgress) combineProgress.textContent = message;
                    if (combineCancel) combineCancel.disabled = combineSaving;
                }});
                combineMode = false; combineSelection.clear(); categoryOpen.saved = true;
                status.textContent = 'Combined recording saved. Original recordings kept.';
            } catch (error) {
                status.textContent = controller.signal.aborted ? 'Combine cancelled. Original recordings kept.' : `Could not combine recordings: ${error.message || error}`;
            } finally {
                combineController = null; combineSaving = false; combineMessage = '';
                await renderRecoverableSessions({preservePosition:true});
            }
        });
        toolbar.appendChild(action);
        if (combineMode) {
            combineCancel = document.createElement('button'); combineCancel.type = 'button'; combineCancel.textContent = 'Cancel'; combineCancel.disabled = combineSaving;
            combineCancel.addEventListener('click', async () => {
                if (combineController) { if (!combineSaving) combineController.abort(); return; }
                combineMode = false; combineSelection.clear(); await renderRecoverableSessions({preservePosition:true});
            }); toolbar.appendChild(combineCancel);
        }
        combineProgress = document.createElement('span'); combineProgress.setAttribute('role','status'); combineProgress.textContent = combineMessage;
        toolbar.appendChild(combineProgress); body.appendChild(toolbar); sync();
        return (row,item) => {
            if (!combineMode) return;
            const box = document.createElement('input'); box.type = 'checkbox'; box.value = item.id;
            box.setAttribute('aria-label',`Select recording from ${formatDate(item.startedAt)} to combine`);
            box.checked = combineSelection.has(item.id); box.disabled = Boolean(combineController) || !available.has(item.id);
            box.addEventListener('change', () => { if(box.checked)combineSelection.add(item.id);else combineSelection.delete(item.id);sync(); });
            row.appendChild(box);
        };
    }
    function category(panel, title, key, count) {
        const section=document.createElement('section');
        section.className='recording-category';
        section.setAttribute('aria-label', title);
        const header=document.createElement('div');header.className='recording-category-header';
        const heading=document.createElement('h3');heading.textContent=`${title} (${count})`;
        const toggle=document.createElement('button');toggle.type='button';
        const body=document.createElement('div');body.className='recording-category-body';body.id=`recordings-${key}`;
        const sync=()=>{body.hidden=!categoryOpen[key];toggle.textContent=body.hidden?'View':'Hide';toggle.setAttribute('aria-expanded',String(!body.hidden));};
        toggle.setAttribute('aria-controls',body.id);
        toggle.addEventListener('click',async()=>{
            categoryOpen[key]=!categoryOpen[key];
            sync();
            if(categoryOpen[key]) {
                try { await renderRecoverableSessions(); }
                catch(error) { console.error('Could not update recordings:',error); }
            }
        });
        sync();header.append(heading,toggle);section.append(header,body);panel.appendChild(section);
        return body;
    }
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
        heading.textContent = "Recordings";
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

    async function renderRecoverableSessions({preservePosition=false,afterId=null}={}) {
        const generation=++renderGeneration;
        const panel = ensureRecoveryPanel();
        let allSessions = [], readError = null;
        try { allSessions = await getAllSessions(); }
        catch (error) { readError = error; }
        if(generation!==renderGeneration)return;
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
        // Keep a surviving visible row at the same screen position when a
        // mutation rebuilds the list; do not force a page-top recenter.
        const oldRows=preservePosition&&panel.querySelectorAll ? [...panel.querySelectorAll('[data-recording-id]')] : [];
        const actionIndex=oldRows.findIndex(row=>row.getAttribute('data-recording-id')===afterId);
        const candidates=actionIndex<0?oldRows:[...oldRows.slice(actionIndex+1),...oldRows.slice(0,actionIndex).reverse()];
        const anchors=candidates.map(row=>({id:row.getAttribute('data-recording-id'),category:row.parentElement.id,rect:row.getBoundingClientRect()})).filter(item=>item.rect.bottom>0&&item.rect.top<window.innerHeight);
        panel.replaceChildren();
        const heading = document.createElement("h2");
        heading.textContent = "Recordings";
        heading.style.fontSize = "1.1rem";
        panel.appendChild(heading);
        // Keep empty categories available so View can discover recordings
        // created in another tab since the last render.
        panel.hidden = false;
        if (readError) {
            const notice = document.createElement("p");
            notice.textContent = "Saved recordings could not be read. Any available emergency audio is listed below. Browser data has not been cleared.";
            panel.appendChild(notice);
        }
        if(emergencyRecordings.size)categoryOpen.saved=true;
        const savedBody=category(panel,'Saved Recordings','saved',sessions.length);
        const addCombineSelection=combineToolbar(savedBody,sessions,emergencyRecordings);
        if(!sessions.length){const empty=document.createElement('p');empty.textContent='No saved recordings.';savedBody.appendChild(empty);}
        for (const item of sessions) {
            const row = document.createElement("div");
            row.setAttribute("data-recording-id",item.id);
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
                ? `${formatDate(item.startedAt)} — ${formatRecordingSize(emergency.blob.size)}. Recording interrupted. ${emergency.unsavedBytes ? "Part of this recovery copy is held only in memory. Download to keep it before leaving this page." : "Finalization was delayed. Download this recovery copy before leaving this page."}`
                : `${formatDate(item.startedAt)} — ${formatRecordingSize(item.bytesStored)}${busy ? " — recording or finishing" : ""}`;
            if (item.integrityReport?.ok === false) label.textContent += " — audio may be incomplete";
            else if (item.state === "interrupted") label.textContent += " — interrupted recording";
            addCombineSelection(row,item);
            row.appendChild(label);
            if(item.combineMetadata)label.textContent+=' — Combined recording';
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
            downloadButton.textContent = "Download";
            const requested=Boolean(item.downloadRequestedAt)||wasDownloadRequested(item.id);
            downloadButton.className=requested?'':'recording-download-pending';
            if(!busy)label.textContent+=requested?' — Download requested':' — Not yet downloaded';
            downloadButton.disabled = busy;
            downloadButton.addEventListener("click", async () => {
                const requested=await exportSavedSession(item.id, downloadButton);
                if(requested===true)downloadButton.className='';
            });
            row.appendChild(downloadButton);
            if(!emergency){
                const archiveButton=document.createElement('button');archiveButton.type='button';archiveButton.textContent='Archive';archiveButton.disabled=busy;
                archiveButton.addEventListener('click',async()=>{
                    archiveButton.disabled=true;
                    try{await moveSessionToRecentlyDeleted(item.id);if(savedPlayback?.id===item.id)closeSavedPlayback();status.textContent='Recording archived.';await renderRecoverableSessions({preservePosition:true,afterId:item.id});}
                    catch(error){status.textContent=`Could not archive recording: ${error.message||error}`;archiveButton.disabled=false;}
                });
                row.appendChild(archiveButton);
            }
            const discardButton = document.createElement("button");
            discardButton.type = "button";
            discardButton.textContent = emergency ? "Discard…" : "Delete";
            discardButton.disabled = busy || (!!emergency && isSessionWriting(item.id));
            if (emergency && discardButton.disabled) discardButton.title = "Wait for recording and pending storage to finish before discarding.";
            discardButton.addEventListener("click", async () => {
                if (emergency && !window.confirm("Discard this interrupted recording's recovery copy? Audio held only in memory will be lost. The portion already saved will move to Archived Recordings. Download first if you want to keep the full recording.")) return;
                if(!emergency&&!window.confirm('Permanently delete this recording? This cannot be undone.'))return;
                discardButton.disabled = true;
                try {
                    if (emergency) await discardEmergencyRecording(item.id);
                    else await deleteSessionData(item.id);
                    if (savedPlayback?.id === item.id) closeSavedPlayback();
                    // Saved-list actions leave the current in-memory player intact.
                    status.textContent = emergency
                        ? "Recovery copy discarded. Only the previously saved portion can be restored from Archived Recordings."
                        : "Recording permanently deleted.";
                    await renderRecoverableSessions({preservePosition:true,afterId:item.id});
                } catch (error) {
                    console.error(error);
                    status.textContent = emergency
                        ? "Could not discard the recovery copy. It remains available; wait for pending storage to finish and try again."
                        : "Could not permanently delete recording.";
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
                diagnosticButton.textContent = "Diagnostics";
                diagnosticButton.title = "Open stop diagnostics";
                diagnosticButton.setAttribute("aria-label", "Open stop diagnostics");
                diagnosticButton.addEventListener("click", () => {
                    downloadRecordingEvents(item.id).catch(error => {
                        console.error("Could not open diagnostics:", error);
                        status.textContent = "Could not open stop diagnostics.";
                    });
                });
                row.appendChild(diagnosticButton);

            }
            sourcesDisclosure(row,item);
            if(combineController && row.querySelectorAll)for(const button of row.querySelectorAll('button'))button.disabled=true;
            savedBody.appendChild(row);
        }
        const section=category(panel,'Archived Recordings','archived',deletedSessions.length);
        if (deletedSessions.length) {
            const note = document.createElement("p");
            note.textContent = "Archived recordings remain stored until you permanently delete them.";
            section.appendChild(note);
            const selectionBar = document.createElement("div");
            selectionBar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:.75rem 0";
            const selectAllLabel = document.createElement("label");
            selectAllLabel.style.cssText = "display:inline-flex;align-items:center;gap:.35rem";
            const selectAll = document.createElement("input");
            selectAll.type = "checkbox";
            selectAll.setAttribute("aria-label", "Select all archived recordings");
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
                        if (!current || current.state !== "deleted") throw new Error("Recording is no longer in Archived Recordings.");
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
                    await renderRecoverableSessions({preservePosition:true,afterId:ids[ids.length-1]});
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
            row.setAttribute("data-recording-id",item.id);
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
                label.textContent = `${formatDate(item.startedAt)} — ${formatRecordingSize(item.bytesStored)} — archived ${formatDate(item.deletedAt)}`;
                row.appendChild(label);
                const restoreButton = document.createElement("button");
                restoreButton.type = "button";
                restoreButton.textContent = "Unarchive";
                restoreButton.addEventListener("click", async () => {
                    restoreButton.disabled = true;
                    try {
                        await restoreRecentlyDeletedSession(item.id);
                        status.textContent = "Recording restored to Saved recordings.";
                        await renderRecoverableSessions({preservePosition:true,afterId:item.id});
                    } catch (error) {
                        status.textContent = `Could not restore recording: ${error.message || error}`;
                        restoreButton.disabled = false;
                    }
                });
                row.appendChild(restoreButton);
                const permanentButton = document.createElement("button");
                permanentButton.type = "button";
                permanentButton.textContent = "Delete";
                permanentButton.addEventListener("click", async () => {
                    if (!window.confirm("Permanently delete this recording and its saved audio? This cannot be undone.")) return;
                    permanentButton.disabled = true;
                    try {
                        const current = await getSession(item.id);
                        if (!current || current.state !== "deleted") throw new Error("Recording is no longer in Archived Recordings.");
                        await deleteSessionData(item.id);
                        if (savedPlayback?.id === item.id) closeSavedPlayback();
                        status.textContent = "Recording permanently deleted.";
                        await renderRecoverableSessions({preservePosition:true,afterId:item.id});
                    } catch (error) {
                        status.textContent = `Could not permanently delete recording: ${error.message || error}`;
                        permanentButton.disabled = false;
                    }
                });
                row.appendChild(permanentButton);
                sourcesDisclosure(row,item);
                if(combineController && row.querySelectorAll)for(const button of row.querySelectorAll('button,input'))button.disabled=true;
                section.appendChild(row);
            }

        }
        if(!deletedSessions.length){const empty=document.createElement('p');empty.textContent='No archived recordings.';section.appendChild(empty);}
        if(anchors.length){
            const rows=[...panel.querySelectorAll('[data-recording-id]')];
            for(const anchor of anchors){
                const row=rows.find(node=>node.getAttribute('data-recording-id')===anchor.id&&node.parentElement.id===anchor.category);
                if(row){window.scrollBy(0,row.getBoundingClientRect().top-anchor.rect.top);break;}
            }
        }
        return {error:readError};
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

