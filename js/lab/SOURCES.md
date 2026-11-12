# Offline lab dependencies

These assets support `lab.html`. Production Silero (build 2026-11-11.1) also reuses the pinned wake/VAD ONNX Runtime loader/WASM, Silero v5 model and their license notices from this directory; its own worker/lifecycle remains outside the lab. Model execution is local; no API key or cloud inference is used. First offline preparation caches approximately 80 MiB. Keep license notices with redistribution. `manifest.json` records byte counts and SHA-256 checksums; regenerate it with `python3 scripts/build-lab-manifest.py` after edits.

| Asset | Source/version |
| --- | --- |
| Whisper tiny.en ONNX q8 encoder/merged decoder and tokenizer/config | `Xenova/whisper-tiny.en`, Hugging Face revision `79fb389fc764e7c395bd330e9531d9d32ada7049`; original OpenAI Whisper MIT license |
| Transformers.js bundle | `@huggingface/transformers@3.7.2`; Apache-2.0 |
| Whisper's matching ONNX Runtime Web WASM/loader | `onnxruntime-web@1.22.0-dev.20250409-89f8206ba4`; MIT |
| Wake/VAD ONNX Runtime Web bundle/WASM/loader | `onnxruntime-web@1.20.1`; MIT |
| Silero v5 ONNX | Shipped by `@ricky0123/vad-web@0.0.27/dist/silero_vad_v5.onnx`; Silero MIT license; state `[2,1,128]`; lab build .13 corrects the older package wrapper’s missing audio context: each 512-sample block at 16 kHz is prefixed with the previous 64 samples, following the official Silero v5.1 wrapper |
| Voicute engine, Friday classifier and mel frontend | `voicute/onnx-wakeword` commit `8002ba9a14d80c0f71447920d3f1c8ee986b1432`; MIT; local metadata deliberately chooses the same Hey Friday model as the comparison lab |
| Heed model/detector/preprocessing | User-trained medium Hey iMuse export installed 12 November 2026; existing Heed detector/preprocessing in `js/heed`, Apache-2.0; model SHA-256 `3c28466070aefb4b29421ea16921121c293beb2dbaf0e549bf771ca9bf61e157` |

Upstream links: https://github.com/openai/whisper · https://huggingface.co/Xenova/whisper-tiny.en · https://github.com/huggingface/transformers.js · https://github.com/microsoft/onnxruntime · https://github.com/snakers4/silero-vad · https://github.com/ricky0123/vad · https://github.com/voicute/onnx-wakeword · https://github.com/AndreiBulzan/heed-wakeword

Required notices are in `vendor/licenses`. Models and worker code are shipped as separate static files rather than embedded as base64 in the HTML. The service worker is registered with the narrow `lab.html` and `js/lab/` URL-prefix scopes (the second controls module-worker dependency requests offline), and does not control production iMuse pages. Runtime/module workers use separate JavaScript contexts for wake/VAD and Whisper so their different ONNX Runtime versions do not share global state. Changes to pinned vendor/model assets require a cache version bump in both `app.js` and `lab-sw.js`.

Silero input/state contract: https://github.com/snakers4/silero-vad/blob/v5.1/src/silero_vad/utils_vad.py . Reset both audio context and recurrent state at recording starts, rate configuration and analysis gaps. Context samples do not advance clip timestamps or add a wait for future audio.

Build 2026-11-05.1 reuses the same pinned Silero/ONNX assets for a separate fresh-state comparison worker; no new model or runtime version is introduced. The continuous worker and fresh worker have separate sessions/state.

The current lab labels Heed as Hey iMuse and defaults its threshold to 0.75 (including wake-mode/engine selection). The supplied metadata remains unchanged (phrase Hey Eyemews, threshold 0.738); the lab applies its selected threshold. The lab cache is imuse-simple-lab-v2 so the prior immutable Hey Doc weights are not reused. Existing saved reviews/labels are retained and describe the model/build that generated them; old Hey Doc evidence is historical. Optional strict Whisper verification now expects Hey iMuse, without adding fuzzy matching or changing its observational role.
