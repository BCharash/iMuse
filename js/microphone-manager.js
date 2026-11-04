import { getSettings, setMicrophoneProcessingLocked } from "./settings.js";
// Shared microphone selection for recording and an explicit temporary level check.
// Automatic mode prefers identifiable external headsets, then the system default.
const KEY = "imuse.microphone-device.v1";
const select = document.getElementById("microphoneChoice");
const refresh = document.getElementById("refreshMicrophones");
const indicator = document.getElementById("microphoneStatus");
let selectedId = "";
try { selectedId = localStorage.getItem(KEY) || ""; } catch (_) {}
let ownedStream = null;
// Keep the original request: browsers may omit unrecognized constraints afterward.
const requestedAudioByStream = new WeakMap();
export function getRequestedMicrophoneConstraints(stream) {
    const audio = requestedAudioByStream.get(stream);
    return audio ? JSON.parse(JSON.stringify(audio)) : null;
}
let locked = false;
let operation = 0;
let refreshGeneration = 0;
const headsetPattern = /shokz|openrun|openmove|aeropex|headset|headphones|headphone|hands.free|airpods|earpods|earbuds|earphones|beats|jabra|plantronics|poly voyager|bose|sony wh-|sony wf-|sennheiser|bluetooth|wireless headset|usb headset|usb audio headset/i;
const internalPattern = /built.in|internal|macbook|iphone microphone|ipad microphone|integrated|facetime|continuity|default/i;
function report(message) { if (indicator) indicator.textContent = message; }
export function showMicrophoneInactive() { report("Microphone: inactive (not listening)"); }
function isHeadset(device) { return headsetPattern.test(device.label || ""); }
function chooseHeadset(devices) {
    const candidates = devices.filter(d => d.deviceId && d.deviceId !== "default" && isHeadset(d));
    // A headset with a known name is preferable to an unidentified or internal device.
    // When multiple are present, prefer the OS default if it resolves to one of them.
    if (!candidates.length) return null;
    const systemDefault = devices.find(d => d.deviceId === "default");
    const defaultLabel = (systemDefault?.label || "").replace(/^default\s*[-–:]\s*/i, "").trim();
    return candidates.find(d => defaultLabel && d.label === defaultLabel) || candidates[0];
}
export function setMicrophoneSelectionLocked(value) {
    locked = Boolean(value);
    setMicrophoneProcessingLocked(locked);
    if (select) { select.disabled = locked; select.title = locked ? "Stop recording before changing microphones." : ""; }
    if (refresh) { refresh.disabled = locked; refresh.title = locked ? "Stop recording before refreshing microphones." : ""; }
}
export async function refreshMicrophones() {
    if (!select || !navigator.mediaDevices?.enumerateDevices) return;
    const generation = ++refreshGeneration;
    try {
        const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
        if (generation !== refreshGeneration) return;
        const options = [new Option("Automatic (headset preferred)", "")];
        for (const device of inputs) {
            if (!device.deviceId || device.deviceId === "default") continue;
            options.push(new Option(device.label || "Microphone (permission required to identify)", device.deviceId));
        }
        if (selectedId && !inputs.some(d => d.deviceId === selectedId)) {
            options.push(new Option("Manually selected microphone unavailable", selectedId));
        }
        select.replaceChildren(...options);
        select.value = selectedId;
        setMicrophoneSelectionLocked(locked);
    } catch (error) { console.warn("Microphone enumeration failed:", error); }
}
if (select) select.addEventListener("change", () => {
    if (locked) return;
    selectedId = select.value;
    try { localStorage.setItem(KEY, selectedId); } catch (_) {}
    report(selectedId ? "Microphone: manual selection ready" : "Microphone: automatic headset preference ready");
});
if (refresh) refresh.addEventListener("click", () => { if (!locked) void refreshMicrophones(); });
if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => { if (!locked) void refreshMicrophones(); });
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !locked) void refreshMicrophones();
});
export async function acquireRecordingMicrophone({purpose="recording",isCurrent=()=>true}={}) {
    if (!navigator.mediaDevices?.getUserMedia) throw Error("Microphone access unavailable");
    const request = ++operation;
    const processing = getSettings();
    const processingConstraints = {
        autoGainControl: { ideal: processing.autoGainControl },
        noiseSuppression: { ideal: processing.noiseSuppression },
        echoCancellation: { ideal: processing.echoCancellation }
    };
    const audio = { channelCount: { ideal: 1 }, ...processingConstraints };
    let candidate = null;
    if (selectedId) {
        audio.deviceId = { exact: selectedId };
    } else {
        try {
            const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
            candidate = chooseHeadset(inputs);
            if (candidate) audio.deviceId = { exact: candidate.deviceId };
        } catch (error) { console.warn("Could not inspect microphones; using system default:", error); }
    }
    if(request!==operation||!isCurrent())throw Error("Microphone request superseded");
    let stream;
    let requestedAudio = audio;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (error) {
        if (selectedId || !candidate || request!==operation || !isCurrent()) throw error;
        // Automatic mode can fall back if a headset vanished or could not open.
        console.warn("Preferred headset unavailable; trying system microphone:", error);
        requestedAudio = { channelCount: { ideal: 1 }, ...processingConstraints };
        stream = await navigator.mediaDevices.getUserMedia({ audio: requestedAudio });
    }
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live" || request !== operation || !isCurrent()) {
        stream.getTracks().forEach(t => t.stop());
        throw Error(request !== operation ? "Microphone request superseded" : "No live microphone track was acquired");
    }
    const actualId = track.getSettings?.().deviceId;
    if (selectedId && actualId && actualId !== selectedId) {
        stream.getTracks().forEach(t => t.stop());
        throw Error("Browser returned a different microphone than the manually selected device");
    }
    requestedAudioByStream.set(stream, JSON.parse(JSON.stringify(requestedAudio)));
    ownedStream = stream;
    report("Microphone: "+(purpose==="level-check"?"checking levels":"recording")+" — " + (track.label || "Unidentified input"));
    track.addEventListener("ended", () => {
        if (ownedStream === stream) { ownedStream = null; report("Microphone: disconnected"); }
    });
    return stream;
}
export function releaseRecordingMicrophone(stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
    if (ownedStream === stream) { ownedStream = null; showMicrophoneInactive(); }
}
showMicrophoneInactive();
void refreshMicrophones();
