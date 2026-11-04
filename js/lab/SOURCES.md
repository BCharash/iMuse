# Offline lab dependencies

These assets support only `lab.html`. Model execution is local; no API key or cloud inference is used. First offline preparation caches approximately 80 MiB. Keep license notices with redistribution. `manifest.json` records byte counts and SHA-256 checksums; regenerate it with `python3 scripts/build-lab-manifest.py` after edits.

| Asset | Source/version |
| --- | --- |
| Whisper tiny.en ONNX q8 encoder/merged decoder and tokenizer/config | `Xenova/whisper-tiny.en`, Hugging Face revision `79fb389fc764e7c395bd330e9531d9d32ada7049`; original OpenAI Whisper MIT license |
| Transformers.js bundle | `@huggingface/transformers@3.7.2`; Apache-2.0 |
| Whisper's matching ONNX Runtime Web WASM/loader | `onnxruntime-web@1.22.0-dev.20250409-89f8206ba4`; MIT |
| Wake/VAD ONNX Runtime Web bundle/WASM/loader | `onnxruntime-web@1.20.1`; MIT |
| Silero v5 ONNX | Shipped by `@ricky0123/vad-web@0.0.27/dist/silero_vad_v5.onnx`; Silero MIT license; its package wrapper confirms 512-sample input and state `[2,1,128]` |
| Voicute engine, Friday classifier and mel frontend | `voicute/onnx-wakeword` commit `8002ba9a14d80c0f71447920d3f1c8ee986b1432`; MIT; local metadata deliberately chooses the same Hey Friday model as the comparison lab |
| Heed model/detector/preprocessing | Existing repository assets in `js/heed`; Apache-2.0; model SHA-256 `2635f8c007651c39a8f63d9f6834c65f85359b7361d99e2e5d0770fa9513aa01` |

Upstream links: https://github.com/openai/whisper · https://huggingface.co/Xenova/whisper-tiny.en · https://github.com/huggingface/transformers.js · https://github.com/microsoft/onnxruntime · https://github.com/snakers4/silero-vad · https://github.com/ricky0123/vad · https://github.com/voicute/onnx-wakeword · https://github.com/AndreiBulzan/heed-wakeword

Required notices are in `vendor/licenses`. Models and worker code are shipped as separate static files rather than embedded as base64 in the HTML. The service worker is registered with the narrow `lab.html` and `js/lab/` URL-prefix scopes (the second controls module-worker dependency requests offline), and does not control production iMuse pages. Runtime/module workers use separate JavaScript contexts for wake/VAD and Whisper so their different ONNX Runtime versions do not share global state. Changes to pinned vendor/model assets require a cache version bump in both `app.js` and `lab-sw.js`.
