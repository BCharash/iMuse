const BASE = "https://cdn.jsdelivr.net/gh/voicute/onnx-wakeword@main";
const MODEL_INFO = `${BASE}/models/en/model_info.json`;
const MEL_MODEL = `${BASE}/models/melspectrogram.onnx`;
const ORT_SCRIPT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js";
const VOICUTE_SCRIPT = `${BASE}/web/wakeword.js`;

let loadPromise = null;

function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = [...document.scripts].find(script => script.src === src);
        const script = existing || document.createElement("script");
        const onReady = () => {
            cleanup();
            if (ready()) resolve();
            else reject(new Error(`Script loaded but its expected API was not found: ${src}`));
        };
        const onError = () => {
            cleanup();
            reject(new Error(`Could not load external script: ${src}`));
        };
        const cleanup = () => {
            script.removeEventListener("load", onReady);
            script.removeEventListener("error", onError);
        };

        script.addEventListener("load", onReady, { once: true });
        script.addEventListener("error", onError, { once: true });
        if (!existing) {
            script.src = src;
            script.async = true;
            document.head.appendChild(script);
        }
    });
}

function humanizeModelName(value) {
    const text = String(value || "").replace(/[_-]+/g, " ").trim();
    if (!text) return "the loaded Voicute wake phrase";
    return text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

export async function loadVoicuteWakeWord({ threshold = 0.9, onStatus = () => {} } = {}) {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        onStatus("Wake-word detector: loading ONNX Runtime…");
        await loadScript(ORT_SCRIPT, () => Boolean(window.ort));
        onStatus("Wake-word detector: loading Voicute browser engine…");
        await loadScript(VOICUTE_SCRIPT, () => Boolean(window.VoicuteWakeWord));

        onStatus("Wake-word detector: loading the free public demo model…");
        let engine = window.VoicuteWakeWord.create();
        const originalFetch = window.fetch.bind(window);
        let loadedFriday = false;

        // The standalone experiment uses this metadata to request the public
        // Hey Friday demo asset even when the repository's current config
        // points at a different public keyword.
        window.fetch = async (input, init) => {
            const url = typeof input === "string" ? input : input?.url;
            if (url === MODEL_INFO) {
                return new Response(JSON.stringify({
                    model_type: "multi_keyword",
                    keywords: ["Hey Friday"],
                    model_file: "hey_friday.onnx",
                    mel_time: 98,
                    cons_frames: 3,
                    n_mels: 32
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            return originalFetch(input, init);
        };

        try {
            try {
                await engine.load(MODEL_INFO, MEL_MODEL);
                loadedFriday = true;
            } catch (fridayError) {
                // If the older public Friday asset is no longer available,
                // try the repository's current public model configuration.
                engine = window.VoicuteWakeWord.create();
                await engine.load(MODEL_INFO, MEL_MODEL);
            }
        } finally {
            window.fetch = originalFetch;
        }

        engine.setThreshold(threshold);
        engine.setL1?.(true);
        engine.setL2?.(false);
        engine.setL3?.(true);
        engine.setCooldown?.(2000);
        engine.setL4?.(false);
        engine.setL5?.(false);

        const models = typeof engine.getModels === "function" ? engine.getModels() : [];
        const modelName = models.map(model => model.name).filter(Boolean).join(", ");
        const phrase = loadedFriday ? "Hey Friday" : humanizeModelName(modelName);
        onStatus(`Wake-word detector loaded: ${phrase}.`);

        return {
            engine,
            phrase,
            loadedFriday,
            modelName: modelName || phrase,
            threshold
        };
    })();

    try {
        return await loadPromise;
    } catch (error) {
        loadPromise = null;
        throw error;
    }
}
