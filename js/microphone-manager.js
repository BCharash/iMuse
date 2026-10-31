// iMuse microphone ownership for the recording pathway. No startup capture.
// Device selection is independent of voice-command and headset-media settings.
const KEY = "imuse.microphone-device.v1";
const select = document.getElementById("microphoneChoice");
const refresh = document.getElementById("refreshMicrophones");
const indicator = document.getElementById("microphoneStatus");
let selectedId = "";
try { selectedId = localStorage.getItem(KEY) || ""; } catch (_) {}
let ownedStream = null;
let operation = 0;
function report(message) { if (indicator) indicator.textContent = message; }
export function showMicrophoneInactive() { report("Microphone: inactive (not listening)"); }
export async function refreshMicrophones() {
    if (!select || !navigator.mediaDevices?.enumerateDevices) return;
    try {
        const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
        const options = [new Option("System default", "")];
        for (const device of inputs) {
            if (!device.deviceId || device.deviceId === "default") continue;
            options.push(new Option(device.label || "Microphone (permission required to identify)", device.deviceId));
        }
        select.replaceChildren(...options);
        if (selectedId && !inputs.some(d => d.deviceId === selectedId)) {
            // Preserve a missing preference, but never silently substitute another input.
            select.add(new Option("Previously selected microphone unavailable", selectedId));
        }
        select.value = selectedId;
    } catch (error) { console.warn("Microphone enumeration failed:", error); }
}
if (select) select.addEventListener("change", () => {
    selectedId = select.value;
    try { localStorage.setItem(KEY, selectedId); } catch (_) {}
    if (ownedStream?.getAudioTracks()?.some(t => t.readyState === "live")) {
        report("Microphone: selection saved; applies to next recording");
    }
});
if (refresh) refresh.addEventListener("click", () => void refreshMicrophones());
export async function acquireRecordingMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw Error("Microphone access unavailable");
    const request = ++operation;
    const audio = { channelCount: { ideal: 1 } };
    if (selectedId) audio.deviceId = { exact: selectedId };
    // Explicit selection fails visibly rather than silently using the wrong microphone.
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") {
        stream.getTracks().forEach(t => t.stop());
        throw Error("No live microphone track was acquired");
    }
    if (request !== operation) { stream.getTracks().forEach(t => t.stop()); throw Error("Microphone request superseded"); }
    ownedStream = stream;
    const actualId = track.getSettings?.().deviceId;
    if (selectedId && actualId && actualId !== selectedId) {
        stream.getTracks().forEach(t => t.stop()); ownedStream = null;
        showMicrophoneInactive();
        throw Error("Browser returned a different microphone than the selected device");
    }
    report("Microphone: recording — " + (track.label || "Unidentified input"));
    track.addEventListener("ended", () => {
        if (ownedStream === stream) { ownedStream = null; report("Microphone: disconnected"); }
    });
    void refreshMicrophones();
    return stream;
}
export function releaseRecordingMicrophone(stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
    if (ownedStream === stream) { ownedStream = null; showMicrophoneInactive(); }
}
showMicrophoneInactive();
void refreshMicrophones();
