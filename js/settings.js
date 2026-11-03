// Stage 1: configuration only. The existing wake-word implementation remains
// unchanged until the Heed/TensorFlow integration is tested in later stages.
const KEY = "imuse.voice-settings.v1";
const defaults = Object.freeze({audioCommands:false, wakeEngine:"voicute", wakeThreshold:0.67, voicuteThreshold:0.90, commandWindow:5, silencePauseSeconds:5, silenceThresholdDb:-36.5, wakeMinimumDb:-40, autoGainControl:false, noiseSuppression:true, echoCancellation:true,
    goThreshold:0.60, stopThreshold:0.85, yesThreshold:0.85, noThreshold:0.55, overlapFactor:"auto"});
const allowedOverlap = new Set(["auto", "0.5", "0.75", "0.9"]);
const clamp = (value,min,max,fallback) => Number.isFinite(Number(value)) ? Math.min(max,Math.max(min,Number(value))) : fallback;
export function loadSettings() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { /* storage unavailable */ }
    return {audioCommands:stored.audioCommands === true,
        interruptionWarningEnabled:stored.interruptionWarningEnabled !== false,
        wakeEngine:stored.wakeEngine === "heed" ? "heed" : "voicute",
        voicuteThreshold:clamp(stored.voicuteThreshold,.3,.95,defaults.voicuteThreshold),
        wakeThreshold:clamp(stored.wakeThreshold,.3,.99,defaults.wakeThreshold),
        silencePauseSeconds:Math.round(clamp(stored.silencePauseSeconds,3,15,defaults.silencePauseSeconds)),
        silenceThresholdDb:clamp(stored.silenceThresholdDb,-65,-20,defaults.silenceThresholdDb),
        wakeMinimumDb:Math.round(clamp(stored.wakeMinimumDb,-65,-20,defaults.wakeMinimumDb)),
        autoGainControl:stored.autoGainControl === true,
        noiseSuppression:stored.noiseSuppression !== false,
        echoCancellation:stored.echoCancellation !== false,
        commandWindow:Math.round(clamp(stored.commandWindow,2,15,defaults.commandWindow)),
        goThreshold:clamp(stored.goThreshold,.3,.99,defaults.goThreshold),
        stopThreshold:clamp(stored.stopThreshold,.3,.99,defaults.stopThreshold),
        yesThreshold:clamp(stored.yesThreshold,.3,.99,defaults.yesThreshold),
        noThreshold:clamp(stored.noThreshold,.3,.99,defaults.noThreshold),
        overlapFactor:allowedOverlap.has(String(stored.overlapFactor)) ? String(stored.overlapFactor) : "auto"};
}
let settings = loadSettings();
export const getSettings = () => ({...settings});
export const effectiveOverlap = deviceClass => settings.overlapFactor === "auto" ? (deviceClass === "mobile" ? .9 : .75) : Number(settings.overlapFactor);
// Use the recorder's actual runtime classification, not a separate device guess.
// The recorder sets window.deviceClass during module initialization.
function updateAutomaticOverlapLabel() {
    const select = document.getElementById("overlapFactor");
    const option = select?.querySelector('option[value="auto"]');
    if (!option) return;
    const deviceClass = window.deviceClass;
    option.textContent = deviceClass === "mobile" ? "Automatic — Mobile (0.90)"
        : deviceClass === "desktop" ? "Automatic — Desktop (0.75)"
        : "Automatic (detecting device…)";
}
const panel = document.getElementById("settingsPanel");
const button = document.getElementById("settingsButton");
button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    updateAutomaticOverlapLabel();
    button.setAttribute("aria-expanded", String(!panel.hidden));
});
const controls = {interruptionWarningEnabled:"interruptionWarningEnabled",autoGainControl:"autoGainControl",noiseSuppression:"noiseSuppression",echoCancellation:"echoCancellation",silenceThresholdDb:"silenceThresholdDb",wakeMinimumDb:"wakeMinimumDb",silencePauseSeconds:"silencePauseSeconds",wakeEngine:"wakeEngine",voicuteThreshold:"voicuteThreshold",audioCommands:"audioCommandsToggle",wakeThreshold:"wakeThreshold",commandWindow:"commandWindow",
    goThreshold:"goThreshold",stopThreshold:"stopThreshold",yesThreshold:"yesThreshold",noThreshold:"noThreshold",overlapFactor:"overlapFactor"};
let silencePauseLocked = false;
let microphoneProcessingLocked = false;
export function setMicrophoneProcessingLocked(locked) {
    microphoneProcessingLocked = Boolean(locked);
    for (const id of ["autoGainControl", "noiseSuppression", "echoCancellation"]) {
        const control = document.getElementById(id);
        if (control) {
            control.disabled = Boolean(locked);
            control.title = locked ? "Stop recording before changing microphone processing." : "";
        }
    }
}
export function setSilencePauseLocked(locked) {
    silencePauseLocked = Boolean(locked);
    const slider = document.getElementById("silencePauseSeconds");
    if (slider) slider.disabled = silencePauseLocked;
}
function render() {
    updateAutomaticOverlapLabel();
    for (const [key,id] of Object.entries(controls)) {
        const el=document.getElementById(id);if (!el) continue;
        if (el.type === "checkbox") el.checked = settings[key]; else el.value=String(settings[key]);
        const output=document.getElementById(key+"Value");if (output) output.textContent = ["wakeThreshold","voicuteThreshold","goThreshold","stopThreshold","yesThreshold","noThreshold"].includes(key) ? Number(settings[key]).toFixed(2) : String(settings[key]);
    }
    document.getElementById("heedThresholdRow").hidden = settings.wakeEngine !== "heed";
    document.getElementById("voicuteThresholdRow").hidden = settings.wakeEngine !== "voicute";
    document.getElementById("voiceSettings").querySelectorAll("input,select").forEach(el => el.disabled = !settings.audioCommands);
    setSilencePauseLocked(silencePauseLocked);
    setMicrophoneProcessingLocked(microphoneProcessingLocked);
}
for (const [key,id] of Object.entries(controls)) {
    const el=document.getElementById(id);if (!el) continue;
    el.addEventListener(el.type === "range" ? "input" : "change", () => {
        if (el.disabled) return;
        settings[key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
        try {localStorage.setItem(KEY,JSON.stringify(settings));} catch (error) {console.warn("iMuse settings could not be saved",error);}
        render();
        window.dispatchEvent(new CustomEvent("imuse-settings-changed",{detail:getSettings()}));
    });
}
render();

window.addEventListener("load", updateAutomaticOverlapLabel);


// Compact disclosures follow Memora's View/Hide convention.
function wireDisclosure(buttonElement, detailElement) {
    if (!buttonElement || !detailElement) return;
    buttonElement.addEventListener("click", () => {
        detailElement.hidden = !detailElement.hidden;
        buttonElement.textContent = detailElement.hidden ? "View" : "Hide";
        buttonElement.setAttribute("aria-expanded", String(!detailElement.hidden));
    });
}
wireDisclosure(document.getElementById("microphoneLevelsToggle"), document.getElementById("microphoneLevelsDetail"));

function renderMicrophoneProcessing() {
    const target = document.getElementById("microphoneProcessingDetails");
    if (!target) return;
    const data = window.imuseMicrophoneProcessing;
    if (!data) { target.textContent = "No recording microphone has been acquired yet."; return; }
    const format = (obj, key) => {
        if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return "Not reported";
        const value = obj[key];
        if (value && typeof value === "object") {
            if (Object.prototype.hasOwnProperty.call(value, "exact")) return String(value.exact);
            if (Object.prototype.hasOwnProperty.call(value, "ideal")) return String(value.ideal) + " (preferred)";
        }
        return String(value);
    };
    const fields = [
        ["Automatic gain control", "autoGainControl"],
        ["Noise suppression", "noiseSuppression"],
        ["Echo cancellation", "echoCancellation"],
        ["Sample rate", "sampleRate"],
        ["Channel count", "channelCount"]
    ];
    target.replaceChildren();
    const title = document.createElement("p");
    title.textContent = `Microphone: ${format(data.active, "label") !== "Not reported" ? format(data.active, "label") : (data.label || "Not reported")} · ${data.live ? "Live" : "Last acquired"}`;
    target.append(title);
    const table = document.createElement("div");
    table.className = "imuse-mic-table";
    const header = document.createElement("div");
    header.className = "imuse-mic-table-row";
    for (const heading of ["Feature", "Requested", "Active", "Supported"]) {
        const cell = document.createElement("strong"); cell.textContent = heading; header.append(cell);
    }
    table.append(header);
    for (const [label, key] of fields) {
        const row = document.createElement("div"); row.className = "imuse-mic-table-row";
        for (const value of [label, format(data.requested, key), format(data.active, key), format(data.supported, key)]) {
            const cell = document.createElement("span"); cell.textContent = value; row.append(cell);
        }
        table.append(row);
    }
    target.append(table);
}
window.addEventListener("imuse-microphone-processing", renderMicrophoneProcessing);
renderMicrophoneProcessing();

// Recording diagnostics are read-only and do not modify recording or storage.
const diagnosticsSection = document.createElement("section");
diagnosticsSection.id = "recordingDiagnostics";
diagnosticsSection.setAttribute("aria-label", "Recording and storage diagnostics");
diagnosticsSection.style.cssText = "border:1px solid #b8b8b8;border-radius:12px;padding:1rem;margin-top:1.5rem";
const diagnosticsHeading = document.createElement("h3");
diagnosticsHeading.textContent = "Recording and storage diagnostics";
diagnosticsHeading.style.margin = "0";
const diagnosticsHeader = document.createElement("div");
diagnosticsHeader.className = "imuse-disclosure";
const diagnosticsToggle = document.createElement("button");
diagnosticsToggle.type = "button";
diagnosticsToggle.textContent = "View";
diagnosticsToggle.setAttribute("aria-expanded", "false");
diagnosticsToggle.setAttribute("aria-controls", "recordingDiagnosticsDetail");
diagnosticsHeader.append(diagnosticsHeading, diagnosticsToggle);
diagnosticsSection.appendChild(diagnosticsHeader);
const diagnosticsDetail = document.createElement("div");
diagnosticsDetail.id = "recordingDiagnosticsDetail";
diagnosticsDetail.className = "imuse-disclosure-detail";
diagnosticsDetail.hidden = true;
diagnosticsSection.appendChild(diagnosticsDetail);
wireDisclosure(diagnosticsToggle, diagnosticsDetail);
const diagnosticsGrid = document.createElement("div");
diagnosticsGrid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.65rem 1rem";
const diagnosticsFields = {};
for (const [key, label] of [
    ["pending", "Pending audio in RAM"],
    ["peak", "Peak pending audio"],
    ["queued", "Pending chunks"],
    ["limit", "Pending buffer limit"],
    ["recordings", "Saved recordings"],
    ["chunks", "Saved audio chunks"],
    ["audio", "Saved audio data"],
    ["usage", "Browser storage used (estimate)"],
    ["quota", "Browser storage quota (estimate)"],
    ["heap", "JavaScript heap (if available)"]
]) {
    const item = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = label;
    name.style.cssText = "font-size:.85rem;opacity:.8";
    const value = document.createElement("div");
    value.textContent = "—";
    value.style.cssText = "font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere";
    item.append(name, value);
    diagnosticsGrid.appendChild(item);
    diagnosticsFields[key] = value;
}
diagnosticsDetail.appendChild(diagnosticsGrid);
const diagnosticsNote = document.createElement("p");
diagnosticsNote.textContent = "Pending audio is only the unsaved recording buffer, not total app memory. Storage figures include recordings in Recently Deleted. Browser usage and quota are estimates for this site, not just iMuse audio.";
diagnosticsNote.style.cssText = "font-size:.83rem;opacity:.8;margin:.8rem 0";
diagnosticsDetail.appendChild(diagnosticsNote);
const diagnosticsActions = document.createElement("div");
diagnosticsActions.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:.75rem";
const diagnosticsRefresh = document.createElement("button");
diagnosticsRefresh.type = "button";
diagnosticsRefresh.textContent = "Refresh storage details";
const diagnosticsUpdated = document.createElement("span");
diagnosticsUpdated.style.cssText = "font-size:.8rem;opacity:.8";
diagnosticsActions.append(diagnosticsRefresh, diagnosticsUpdated);
diagnosticsDetail.appendChild(diagnosticsActions);
panel.appendChild(diagnosticsSection);
// Show up to four significant figures; switch to GB above 500 MB.
const formatBytes = bytes => {
    if (!Number.isFinite(bytes)) return "Unavailable";
    if (bytes === 0) return "0 B";
    const mb = 1024 * 1024;
    const gb = 1024 * mb;
    const format = (value, unit) => `${Number(value.toPrecision(4)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${unit}`;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < mb) return format(bytes / 1024, "KB");
    if (bytes > 500 * mb) return format(bytes / gb, "GB");
    return format(bytes / mb, "MB");
};
function updateRecordingDiagnostics() {
    const d = window.imuseRecordingDiagnostics || {};
    diagnosticsFields.pending.textContent = formatBytes(d.pendingBytes ?? 0);
    diagnosticsFields.peak.textContent = formatBytes(d.peakPendingBytes ?? 0);
    diagnosticsFields.queued.textContent = String(d.pendingChunks ?? 0);
    diagnosticsFields.limit.textContent = formatBytes(d.bufferLimitBytes ?? 8*1048576);
    const heap = performance.memory;
    diagnosticsFields.heap.textContent = heap?.usedJSHeapSize ? formatBytes(heap.usedJSHeapSize) : "Not available on this browser";
}
async function refreshRecordingStorageDetails() {
    updateRecordingDiagnostics();
    diagnosticsRefresh.disabled = true;
    diagnosticsUpdated.textContent = "Checking storage…";
    try {
        // Read only session metadata: never retrieve stored audio blobs for diagnostics.
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open("imuse-recording-breadboard");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Database unavailable"));
            request.onblocked = () => reject(new Error("Database busy"));
        });
        try {
            if (!db.objectStoreNames.contains("sessions")) {
                diagnosticsFields.recordings.textContent = "0";
                diagnosticsFields.chunks.textContent = "0";
                diagnosticsFields.audio.textContent = "0 B";
            } else {
                const sessions = await new Promise((resolve, reject) => {
                    const transaction = db.transaction("sessions", "readonly");
                    const request = transaction.objectStore("sessions").getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                    transaction.onabort = () => reject(transaction.error);
                });
                diagnosticsFields.recordings.textContent = String(sessions.length);
                diagnosticsFields.chunks.textContent = String(sessions.reduce((sum, item) => sum + (item.chunkCount || 0), 0));
                diagnosticsFields.audio.textContent = formatBytes(sessions.reduce((sum, item) => sum + (item.bytesStored || 0), 0));
            }
        } finally { db.close(); }
        if (navigator.storage?.estimate) {
            const estimate = await navigator.storage.estimate();
            diagnosticsFields.usage.textContent = formatBytes(estimate.usage);
            diagnosticsFields.quota.textContent = formatBytes(estimate.quota);
        } else {
            diagnosticsFields.usage.textContent = "Not available";
            diagnosticsFields.quota.textContent = "Not available";
        }
        diagnosticsUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        diagnosticsUpdated.textContent = `Storage details unavailable: ${error.message || error}`;
    } finally { diagnosticsRefresh.disabled = false; }
}
diagnosticsRefresh.addEventListener("click", refreshRecordingStorageDetails);
window.addEventListener("imuse-recording-diagnostics", () => {
    if (!panel.hidden) updateRecordingDiagnostics();
});
button.addEventListener("click", () => {
    if (!panel.hidden) void refreshRecordingStorageDetails();
});
updateRecordingDiagnostics();
