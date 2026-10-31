// Stage 1: configuration only. The existing wake-word implementation remains
// unchanged until the Heed/TensorFlow integration is tested in later stages.
const KEY = "imuse.voice-settings.v1";
const defaults = Object.freeze({audioCommands:false, wakeEngine:"voicute", wakeThreshold:0.667, voicuteThreshold:0.90, commandWindow:5,
    goThreshold:0.60, stopThreshold:0.85, overlapFactor:"auto"});
const allowedOverlap = new Set(["auto", "0.5", "0.75", "0.9"]);
const clamp = (value,min,max,fallback) => Number.isFinite(Number(value)) ? Math.min(max,Math.max(min,Number(value))) : fallback;
export function loadSettings() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { /* storage unavailable */ }
    return {audioCommands:stored.audioCommands === true,
        wakeEngine:stored.wakeEngine === "heed" ? "heed" : "voicute",
        voicuteThreshold:clamp(stored.voicuteThreshold,.3,.95,defaults.voicuteThreshold),
        wakeThreshold:clamp(stored.wakeThreshold,.3,.99,defaults.wakeThreshold),
        commandWindow:Math.round(clamp(stored.commandWindow,2,15,defaults.commandWindow)),
        goThreshold:clamp(stored.goThreshold,.3,.99,defaults.goThreshold),
        stopThreshold:clamp(stored.stopThreshold,.3,.99,defaults.stopThreshold),
        overlapFactor:allowedOverlap.has(String(stored.overlapFactor)) ? String(stored.overlapFactor) : "auto"};
}
let settings = loadSettings();
export const getSettings = () => ({...settings});
export const effectiveOverlap = deviceClass => settings.overlapFactor === "auto" ? (deviceClass === "mobile" ? .9 : .75) : Number(settings.overlapFactor);
const panel = document.getElementById("settingsPanel");
const button = document.getElementById("settingsButton");
button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
});
const controls = {wakeEngine:"wakeEngine",voicuteThreshold:"voicuteThreshold",audioCommands:"audioCommandsToggle",wakeThreshold:"wakeThreshold",commandWindow:"commandWindow",
    goThreshold:"goThreshold",stopThreshold:"stopThreshold",overlapFactor:"overlapFactor"};
function render() {
    for (const [key,id] of Object.entries(controls)) {
        const el=document.getElementById(id);if (!el) continue;
        if (el.type === "checkbox") el.checked = settings[key]; else el.value=String(settings[key]);
        const output=document.getElementById(key+"Value");if (output) output.textContent=String(settings[key]);
    }
    document.getElementById("heedThresholdRow").hidden = settings.wakeEngine !== "heed";
    document.getElementById("voicuteThresholdRow").hidden = settings.wakeEngine !== "voicute";
    document.getElementById("voiceSettings").querySelectorAll("input,select").forEach(el => el.disabled = !settings.audioCommands);
}
for (const [key,id] of Object.entries(controls)) {
    const el=document.getElementById(id);if (!el) continue;
    el.addEventListener(el.type === "range" ? "input" : "change", () => {
        settings[key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
        try {localStorage.setItem(KEY,JSON.stringify(settings));} catch (error) {console.warn("iMuse settings could not be saved",error);}
        render();
        window.dispatchEvent(new CustomEvent("imuse-settings-changed",{detail:getSettings()}));
    });
}
render();
