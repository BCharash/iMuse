// Model loading and inference routing. No recorder, microphone, timers or DOM ownership.
import { loadHeedWakeWord } from "./heed/heed-adapter.js";
import { loadVoicuteWakeWord } from "./voicute/voicute-adapter.js";

export function loadWakeDetector({ engineName, threshold, onStatus }) {
    // Return the adapter promise directly to retain existing loading timing/cache behavior.
    return engineName === "heed"
        ? loadHeedWakeWord({ threshold, onStatus })
        : loadVoicuteWakeWord({ threshold, onStatus });
}

// The caller supplies a buffer view and live guards, never its mutable recording session.
// Keep the engines' existing post-await checks distinct during this extraction.
export async function evaluateWakeDetector({
    engineName, engine, buffer, sampleRate, getThreshold, cooldownMs,
    isEnabled, isCurrent, isListening, onTrigger, onError, onComplete
}) {
    try {
        if (engineName === "heed") {
            const needed = 2048;
            if (buffer.collectedSamples < needed) return;
            const raw = new Float32Array(needed);
            const start = (buffer.position - needed + buffer.ring.length) % buffer.ring.length;
            for (let i = 0; i < needed; i++) raw[i] = buffer.ring[(start + i) % buffer.ring.length];
            const result = await engine.consume(raw, sampleRate);
            if (result?.triggered && isEnabled() && isCurrent()) {
                onTrigger();
            }
            return;
        }
        const samplesNeededAt16k = engine.audioSamplesNeeded();
        const needed = Math.ceil(samplesNeededAt16k * sampleRate / 16000);
        if (buffer.collectedSamples < needed || needed <= 0 || needed > buffer.ring.length) return;

        const raw = new Float32Array(needed);
        const start = (buffer.position - needed + buffer.ring.length) % buffer.ring.length;
        for (let i = 0; i < needed; i++) {
            raw[i] = buffer.ring[(start + i) % buffer.ring.length];
        }

        let modelChunk;
        if (sampleRate === 16000) {
            modelChunk = raw;
        } else {
            const outputLength = Math.floor(raw.length * 16000 / sampleRate);
            modelChunk = new Float32Array(outputLength);
            const ratio = sampleRate / 16000;
            for (let i = 0; i < outputLength; i++) {
                const position = i * ratio;
                const low = Math.floor(position);
                const high = Math.min(low + 1, raw.length - 1);
                const fraction = position - low;
                modelChunk[i] = raw[low] * (1 - fraction) + raw[high] * fraction;
            }
        }

        const result = await engine.predict(modelChunk);
        if (!result || !isEnabled() || !isCurrent() || !isListening()) return;

        const probability = Number(result.prob) || 0;
        const detected = engine.detect(
            result.word,
            result.prob,
            result.consFrames,
            getThreshold(),
            cooldownMs,
            Date.now(),
            result.sigmoid
        );

        if (detected && isCurrent() && isEnabled()) {
            onTrigger();
        }
    } catch (error) {
        onError(error);
    } finally {
        // Complete within this evaluation, rather than an extra promise continuation,
        // so the recorder's busy flag clears at the original point in the sequence.
        onComplete();
    }
}
