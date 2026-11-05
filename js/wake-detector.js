// Model selection only. The recorder retains readiness, session and audio ownership.
import { loadHeedWakeWord } from "./heed/heed-adapter.js";
import { loadVoicuteWakeWord } from "./voicute/voicute-adapter.js";

export function loadWakeDetector({ engineName, threshold, onStatus }) {
    // Return the adapter promise directly to retain existing loading timing/cache behavior.
    return engineName === "heed"
        ? loadHeedWakeWord({ threshold, onStatus })
        : loadVoicuteWakeWord({ threshold, onStatus });
}
