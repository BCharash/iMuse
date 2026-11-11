# iMuse file map

Updated 11 November 2026. Paths are relative to the repository root. Click a filename to open it, or search this page for its exact name. Every tracked repository file is listed individually, including models, vendor runtimes and archived tools; this map also lists itself. Git internals, local OS files and generated Python caches are excluded.

## Find the right file quickly

| What you want to find | Start here |
| --- | --- |
| Recording controls and main player | [js/recorder.js](js/recorder.js) |
| Download name dialog and filename rules | [js/recording-download.js](js/recording-download.js) |
| Saved recordings and Recently Deleted | [js/recording-library.js](js/recording-library.js) |
| Stored audio chunks and database operations | [js/recording-store.js](js/recording-store.js) |
| Writer lock and storage-operation ordering | [js/recording-storage-coordinator.js](js/recording-storage-coordinator.js) |
| Recovery, finalization and emergency audio | [js/recording-recovery.js](js/recording-recovery.js) |
| Microphone ownership and selection | [js/microphone-manager.js](js/microphone-manager.js) |
| Voice commands and listening windows | [js/voice-controller.js](js/voice-controller.js) |
| Pause/record speech gating | [js/speech-detection.js](js/speech-detection.js) |
| Wake model selection/loading | [js/wake-detector.js](js/wake-detector.js) |
| Production appearance | [css/style.css](css/style.css) |
| Lab queue and fresh-Silero comparison | [js/lab/app.js](js/lab/app.js) |
| Current status and decisions | [docs/README.md](docs/README.md) |
| Upcoming and deferred work | [docs/iMuse next steps.md](docs/iMuse%20next%20steps.md) |
| Running regression checks | [tests/README.md](tests/README.md) |

## Folder guide

```text
iMuse/
├── index.html             Production application
├── lab.html               Separate experimental recorder
├── audio/                 Spoken response files
├── css/                   Production styles
├── icons/                 Application/browser icons
├── js/                    Production modules
│   ├── heed/              Heed wake engine and model
│   ├── voicute/           Voicute integration
│   ├── tensorflow/        Command adapter and its diagnostic lab
│   └── lab/               Experimental code, models and runtimes
├── docs/                  Current guides
│   └── Archive/           Historical guides and earlier review tool
├── scripts/               Maintenance helpers
└── tests/                 Automated regression checks
```

Production starts at `index.html`, which loads `js/settings.js` and `js/recorder.js`. The recorder connects capture, storage/recovery, voice control and the main player. Saved audio lives in browser IndexedDB, not in a repository folder. The current player also retains an audio Blob and its default filename independently of that database.

The current lab starts at `lab.html` and uses separate workers and storage. Its queue-limit findings belong to the lab; they do not establish the same defect in production. Bundled Whisper remains lab-only. Production state-specific Silero now shares the pinned VAD runtime/model assets, using its own worker and lifecycle; it does not import lab UI, queues or comparison logic.

## Jump to a folder

- [Root and page entry points](#root-and-page-entry-points)
- [Production interface and audio prompts](#production-interface-and-audio-prompts)
- [Production JavaScript](#production-javascript)
- [Heed wake engine](#heed-wake-engine)
- [Voicute wake engine](#voicute-wake-engine)
- [TensorFlow commands and diagnostic page](#tensorflow-commands-and-diagnostic-page)
- [Current lab code](#current-lab-code)
- [Lab model assets](#lab-model-assets)
- [Lab vendor runtimes and licenses](#lab-vendor-runtimes-and-licenses)
- [Current documentation](#current-documentation)
- [Archived documentation and tools](#archived-documentation-and-tools)
- [Maintenance scripts](#maintenance-scripts)
- [Regression tests](#regression-tests)

## Root and page entry points

| File | Function |
| --- | --- |
| [.gitattributes](.gitattributes) | Git text-file and line-ending normalization rules. |
| [.gitignore](.gitignore) | Files excluded from Git; currently macOS .DS_Store files. |
| [audio-output-check.html](audio-output-check.html) | Independent iPhone output-routing check page: before/after capture comparisons, optional playback intent and manually labeled reports; no saved-recording access. |
| [favicon.ico](favicon.ico) | Browser favicon in ICO format. |
| [filemap.md](filemap.md) | This searchable, linked guide to every repository file. |
| [index.html](index.html) | Production iMuse page: recording/player controls, Settings and Saved recordings; loads settings.js and recorder.js. |
| [lab-sw.js](lab-sw.js) | Service worker for the lab URL scopes; caches lab code and offline model/runtime assets, without controlling the production page. |
| [lab.html](lab.html) | Separate recorder/wake/filename experiment page. Its results do not establish production behavior. |
| [manifest.json](manifest.json) | Production installable-web-app identity, start URL, colors and icon references. |

## Production interface and audio prompts

| File | Function |
| --- | --- |
| [audio/confirm-stop-recording.wav](audio/confirm-stop-recording.wav) | Spoken request to confirm stopping. Played by the response manager. |
| [audio/new-recording.wav](audio/new-recording.wav) | Spoken new-recording announcement. Played by the response manager. |
| [audio/pause.wav](audio/pause.wav) | Spoken pause acknowledgement. Played by the response manager. |
| [audio/recording-stopped.wav](audio/recording-stopped.wav) | Spoken stopped acknowledgement. Played by the response manager. |
| [audio/recording.wav](audio/recording.wav) | Spoken recording acknowledgement. Played by the response manager. |
| [audio/yes.wav](audio/yes.wav) | Spoken Yes acknowledgement. Played by the response manager. |
| [css/style.css](css/style.css) | Production layout, controls, Settings, saved-player and download-dialog styling. |
| [icons/apple-touch-icon.png](icons/apple-touch-icon.png) | iOS home-screen touch icon. |
| [icons/favicon-16.png](icons/favicon-16.png) | 16-pixel browser favicon. |
| [icons/favicon-32-v2.png](icons/favicon-32-v2.png) | 32-pixel browser favicon variant. |
| [icons/iMuse2.png](icons/iMuse2.png) | Additional iMuse artwork/icon asset. |
| [icons/icon-192.png](icons/icon-192.png) | 192-pixel install icon referenced by the root app manifest. |
| [icons/icon-512.png](icons/icon-512.png) | 512-pixel install icon referenced by the root app manifest. |

## Production JavaScript

| File | Function |
| --- | --- |
| [js/app.js](js/app.js) | Legacy transcription-button hookup to window.transcribeRecording; not loaded by current index.html. |
| [js/audio-output-check.js](js/audio-output-check.js) | Isolated capture/analysis cleanup, existing stop-message playback, temporary optional audio-session request and output-report export. |
| [js/audio-response-manager.js](js/audio-response-manager.js) | Loads/caches prerecorded spoken prompts and serializes their playback. |
| [js/audio.js](js/audio.js) | Audio decoding and mono 16 kHz resampling helper intended for Whisper; not wired into current production recording. |
| [js/build-info.js](js/build-info.js) | Single production build identifier and Settings build-label helper. |
| [js/microphone-level-check.js](js/microphone-level-check.js) | Temporary microphone-level check: deadline, cancellation, cleanup and handoff to Record. |
| [js/microphone-manager.js](js/microphone-manager.js) | Microphone enumeration/selection, acquisition/release and requested-versus-reported processing settings. |
| [js/recorder.js](js/recorder.js) | Production coordinator: capture/start/pause/stop, pending audio writes, wake/silence graph, session guards, main player and current-download wiring. |
| [js/recording-download.js](js/recording-download.js) | Download filename dialog, local date/time formatting, description sanitization and filename preview; changes no saved-list title. |
| [js/recording-integrity.js](js/recording-integrity.js) | Checks chunk ordering/counts/byte totals and derives completion/interruption outcomes; does not prove audible continuity. |
| [js/recording-library.js](js/recording-library.js) | Saved/Recently Deleted lists, saved-player dialog, download actions, restore and deletion selection/confirmation UI. |
| [js/recording-recovery.js](js/recording-recovery.js) | Chunk-to-Blob assembly, saved playback/export, finalization/watchdog and retained emergency audio. |
| [js/recording-storage-coordinator.js](js/recording-storage-coordinator.js) | Serializes storage operations and manages exclusive writer ownership using Web Locks. |
| [js/recording-store.js](js/recording-store.js) | Production IndexedDB schema/version and session/chunk/diagnostic reads, writes, restore and deletion transactions. |
| [js/settings.js](js/settings.js) | Settings controls, persisted preferences, validation, microphone reports/meter and settings-change notifications. |
| [js/speech-detection-core.js](js/speech-detection-core.js) | Production speech state policy, score decisions, 16 kHz streaming resampling and Silero 64-sample context. |
| [js/speech-detection-worker.js](js/speech-detection-worker.js) | Dedicated production continuous Silero worker; loads pinned local assets and resets recurrent state/history per listening interval. |
| [js/speech-detection.js](js/speech-detection.js) | Warmed speech-worker lifecycle, bounded pending packets, timeout/error handling and stale-result cancellation; owns no microphone. |
| [js/stopped-audio.js](js/stopped-audio.js) | Waits for capture-side audio shutdown before the stop announcement, with bounded timeout/failure handling independent of audio preservation. |
| [js/storage-persistence.js](js/storage-persistence.js) | Browser storage-persistence requests/status and Storage Settings presentation. |
| [js/voice-controller.js](js/voice-controller.js) | Wake-to-command episodes, listening-window/countdown, Go/Stop and Yes/No sequencing through recorder capabilities. |
| [js/voice-diagnostics.js](js/voice-diagnostics.js) | Bounded page-memory voice-event log, separate results/detail views and matching readable exports plus full JSON. |
| [js/wake-detector.js](js/wake-detector.js) | Loads the selected wake adapter and routes inference; recorder retains microphone, buffers and timing ownership. |

## Heed wake engine

| File | Function |
| --- | --- |
| [js/heed/README.md](js/heed/README.md) | Heed integration notes and current ownership boundaries. |
| [js/heed/filter-coeffs.js](js/heed/filter-coeffs.js) | Generated Heed filter/window/mel constants; source comments reference an upstream generator absent from this checkout. |
| [js/heed/heed-adapter.js](js/heed/heed-adapter.js) | Loads Heed runtime/model and adapts audio to the detector interface. |
| [js/heed/preprocessing.js](js/heed/preprocessing.js) | Heed signal processing: filtering, framing, FFT and mel feature preparation. |
| [js/heed/wake.json](js/heed/wake.json) | Heed model metadata, phrase and detector/preprocessing/trigger parameters. |
| [js/heed/wake.onnx](js/heed/wake.onnx) | Bundled Hey Doc wake-classifier model weights. |
| [js/heed/wakeword.js](js/heed/wakeword.js) | Heed streaming detector, model execution and trigger/cooldown logic. |

## Voicute wake engine

| File | Function |
| --- | --- |
| [js/voicute/voicute-adapter.js](js/voicute/voicute-adapter.js) | Adapts Voicute loading, audio buffering/scaling and detection to production wake routing. |
| [js/voicute/wakeword.js](js/voicute/wakeword.js) | Loads external Voicute runtime/model resources and exposes the wake engine. |

## TensorFlow commands and diagnostic page

| File | Function |
| --- | --- |
| [js/tensorflow/README.md](js/tensorflow/README.md) | Command-listener ownership, microphone-clone lifecycle and diagnostic-lab notes. |
| [js/tensorflow/commands-adapter.js](js/tensorflow/commands-adapter.js) | TensorFlow speech-command listener for Go/Stop and Yes/No, with scores and guarded microphone-track cloning. |
| [js/tensorflow/labs/audio-worklet.js](js/tensorflow/labs/audio-worklet.js) | AudioWorklet used by the TensorFlow diagnostic page to buffer microphone samples for analysis. |
| [js/tensorflow/labs/iMuseCmd.html](js/tensorflow/labs/iMuseCmd.html) | Standalone voice-command/Heed diagnostic page; separate from production and the current recorder lab. |

## Current lab code

| File | Function |
| --- | --- |
| [js/lab/SOURCES.md](js/lab/SOURCES.md) | Pinned dependency/model sources, versions, licenses and offline packaging; selected VAD assets are shared with production. |
| [js/lab/app.js](js/lab/app.js) | Lab UI/orchestration: recording, analysis queue forwarding, fresh comparison, review display, naming and offline preparation. |
| [js/lab/capture.js](js/lab/capture.js) | Lab MediaRecorder lifecycle, chunk persistence, stop/finalization and failure retention. |
| [js/lab/core.js](js/lab/core.js) | Shared lab audio/math utilities, streaming resampling, Silero context/gates, naming and diagnostic helpers. |
| [js/lab/detection-worker.js](js/lab/detection-worker.js) | Serialized lab resampling, continuous Silero and wake detection, clip collection, fresh-window extraction and packet acknowledgements. |
| [js/lab/fresh-speech-worker.js](js/lab/fresh-speech-worker.js) | Separate worker/session for report-only fresh-state Silero comparison. |
| [js/lab/fresh-speech.js](js/lab/fresh-speech.js) | Detector-aligned comparison windows and fresh-state Silero evaluation with per-block traces. |
| [js/lab/input-worklet.js](js/lab/input-worklet.js) | Lab microphone analysis tap; transfers 1,024-sample packets and silences its speaker output. |
| [js/lab/manifest.json](js/lab/manifest.json) | Generated offline lab asset paths, byte counts and SHA-256 hashes; distinct from the root app manifest. |
| [js/lab/media.js](js/lab/media.js) | Lab microphone preparation, recorder-format/start fallback and AudioContext cleanup. |
| [js/lab/review.js](js/lab/review.js) | Rolling review-audio buffer, clip boundaries/WAV encoding, labels and linked-near-trigger classification helpers. |
| [js/lab/store.js](js/lab/store.js) | Separate lab IndexedDB storage for recordings, chunks and review data. |
| [js/lab/style.css](js/lab/style.css) | Current lab page, review cards, score traces and responsive controls. |
| [js/lab/verification.js](js/lab/verification.js) | Bounded optional Whisper wake-verification request lifecycle, deadlines and stale-result protection; experimental. |
| [js/lab/whisper-worker.js](js/lab/whisper-worker.js) | Local Whisper model loading and inference for lab naming/optional verification. |

## Lab model assets

| File | Function |
| --- | --- |
| [js/lab/models/voicute/hey_friday.onnx](js/lab/models/voicute/hey_friday.onnx) | Bundled lab Hey Friday wake-classifier weights. |
| [js/lab/models/voicute/melspectrogram.onnx](js/lab/models/voicute/melspectrogram.onnx) | Bundled lab Voicute audio-to-mel feature model. |
| [js/lab/models/voicute/model_info.json](js/lab/models/voicute/model_info.json) | Lab Voicute model selection/metadata pointing to the bundled Friday model. |
| [js/lab/models/whisper-tiny.en/added_tokens.json](js/lab/models/whisper-tiny.en/added_tokens.json) | Whisper tokenizer additional token mappings. |
| [js/lab/models/whisper-tiny.en/config.json](js/lab/models/whisper-tiny.en/config.json) | Whisper Tiny English model architecture/configuration. |
| [js/lab/models/whisper-tiny.en/generation_config.json](js/lab/models/whisper-tiny.en/generation_config.json) | Whisper decoding/generation defaults and special-token settings. |
| [js/lab/models/whisper-tiny.en/merges.txt](js/lab/models/whisper-tiny.en/merges.txt) | Whisper byte-pair tokenizer merge rules. |
| [js/lab/models/whisper-tiny.en/normalizer.json](js/lab/models/whisper-tiny.en/normalizer.json) | Whisper text-normalization mappings. |
| [js/lab/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx](js/lab/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx) | Quantized merged Whisper text decoder model weights. |
| [js/lab/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx](js/lab/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx) | Quantized Whisper audio encoder model weights. |
| [js/lab/models/whisper-tiny.en/preprocessor_config.json](js/lab/models/whisper-tiny.en/preprocessor_config.json) | Whisper audio feature-extraction configuration. |
| [js/lab/models/whisper-tiny.en/special_tokens_map.json](js/lab/models/whisper-tiny.en/special_tokens_map.json) | Whisper tokenizer special-token definitions. |
| [js/lab/models/whisper-tiny.en/tokenizer.json](js/lab/models/whisper-tiny.en/tokenizer.json) | Serialized Whisper tokenizer vocabulary/rules. |
| [js/lab/models/whisper-tiny.en/tokenizer_config.json](js/lab/models/whisper-tiny.en/tokenizer_config.json) | Whisper tokenizer configuration and defaults. |
| [js/lab/models/whisper-tiny.en/vocab.json](js/lab/models/whisper-tiny.en/vocab.json) | Whisper tokenizer token-to-ID vocabulary. |

## Lab vendor runtimes and licenses

| File | Function |
| --- | --- |
| [js/lab/vendor/licenses/heed-Apache-2.0.txt](js/lab/vendor/licenses/heed-Apache-2.0.txt) | Heed Apache 2.0 license notice. |
| [js/lab/vendor/licenses/onnxruntime-MIT.txt](js/lab/vendor/licenses/onnxruntime-MIT.txt) | ONNX Runtime MIT license notice. |
| [js/lab/vendor/licenses/silero-MIT.txt](js/lab/vendor/licenses/silero-MIT.txt) | Silero MIT license notice. |
| [js/lab/vendor/licenses/transformers-Apache-2.0.txt](js/lab/vendor/licenses/transformers-Apache-2.0.txt) | Transformers.js Apache 2.0 license notice. |
| [js/lab/vendor/licenses/voicute-MIT.txt](js/lab/vendor/licenses/voicute-MIT.txt) | Voicute MIT license notice. |
| [js/lab/vendor/licenses/whisper-MIT.txt](js/lab/vendor/licenses/whisper-MIT.txt) | Whisper MIT license notice. |
| [js/lab/vendor/ort-wasm-simd-threaded.mjs](js/lab/vendor/ort-wasm-simd-threaded.mjs) | Matching ONNX Runtime WASM loader for lab wake/Silero inference. |
| [js/lab/vendor/ort-wasm-simd-threaded.wasm](js/lab/vendor/ort-wasm-simd-threaded.wasm) | Matching compiled WASM runtime for lab wake/Silero inference. |
| [js/lab/vendor/ort.min.mjs](js/lab/vendor/ort.min.mjs) | Pinned ONNX Runtime Web bundle for lab wake/Silero and production speech detection. |
| [js/lab/vendor/silero_vad_v5.onnx](js/lab/vendor/silero_vad_v5.onnx) | Bundled Silero v5 speech-presence model used by the lab and production speech gate; does not recognize a wake phrase. |
| [js/lab/vendor/transformers.min.js](js/lab/vendor/transformers.min.js) | Pinned Transformers.js bundle used by lab Whisper inference. |
| [js/lab/vendor/voicute.js](js/lab/vendor/voicute.js) | Pinned third-party Voicute wake-engine implementation for the lab. |
| [js/lab/vendor/whisper/ort-wasm-simd-threaded.jsep.mjs](js/lab/vendor/whisper/ort-wasm-simd-threaded.jsep.mjs) | Whisper/Transformers.js matching ONNX Runtime WASM loader, separate from wake/Silero runtime. |
| [js/lab/vendor/whisper/ort-wasm-simd-threaded.jsep.wasm](js/lab/vendor/whisper/ort-wasm-simd-threaded.jsep.wasm) | Whisper/Transformers.js matching compiled WASM runtime. |

## Current documentation

| File | Function |
| --- | --- |
| [docs/README.md](docs/README.md) | Start here for current implementation status, acceptance evidence and links to authoritative subject guides. |
| [docs/build-versioning.md](docs/build-versioning.md) | Production build numbering/display, diagnostic identity and deferred asset-fingerprinting direction. |
| [docs/design-journal.md](docs/design-journal.md) | Dated design/implementation decisions and historical evidence; later entries supersede earlier plans. |
| [docs/iMuse Memora integration handoff.md](docs/iMuse%20Memora%20integration%20handoff.md) | Conditional non-destructive Record-to-Transcribe contract; Memora owns its existing browser workflows. |
| [docs/iMuse Swift migration plan.md](docs/iMuse%20Swift%20migration%20plan.md) | Conditional native iOS scope, capture feasibility gates, possible transcription/models and recording priority. |
| [docs/iMuse next steps.md](docs/iMuse%20next%20steps.md) | Active priorities, deferred work, completed foundations and remaining acceptance tasks. |
| [docs/recording-investigation.md](docs/recording-investigation.md) | Authoritative recording/storage/recovery behavior, download naming and device evidence/manual checks. |
| [docs/voice-control-refactor.md](docs/voice-control-refactor.md) | Accepted voice/wake architecture, race guards, Settings/diagnostic semantics and regression boundaries. |
| [docs/wake-word-evaluation.md](docs/wake-word-evaluation.md) | Current lab procedures/results, continuous-versus-fresh evidence and deferred queue/latency investigation. |

## Archived documentation and tools

| File | Function |
| --- | --- |
| [docs/Archive/README.md](docs/Archive/README.md) | Archive index: why each historical document/tool remains and what supersedes it. |
| [docs/Archive/architecture-stabilization-review.md](docs/Archive/architecture-stabilization-review.md) | Historical source/architecture audit and microphone/adapter questions. |
| [docs/Archive/headset control.md](docs/Archive/headset%20control.md) | Historical headset media-button and keep-alive experiments; those controls are retired. |
| [docs/Archive/iMuse voice-control integration plan.md](docs/Archive/iMuse%20voice-control%20integration%20plan.md) | Original proposed voice component/state separation and implementation gates. |
| [docs/Archive/native-proposal-2026-11-04.md](docs/Archive/native-proposal-2026-11-04.md) | Earlier native-recorder proposal; superseded by the current Swift migration guide. |
| [docs/Archive/recorder-lab-guide-2026-11-04.md](docs/Archive/recorder-lab-guide-2026-11-04.md) | Detailed earlier lab implementation/startup history and experimental Whisper procedures. |
| [docs/Archive/recording-investigation-handoff-2026-11-02.md](docs/Archive/recording-investigation-handoff-2026-11-02.md) | Earlier background-capture handoff, instrumentation/cache incidents and hypotheses. |
| [docs/Archive/recording-investigation-stages-2026-11-03.md](docs/Archive/recording-investigation-stages-2026-11-03.md) | Detailed preservation-stage implementation and background-capture experiment history. |
| [docs/Archive/roadmap-2026-11-01.md](docs/Archive/roadmap-2026-11-01.md) | Earlier roadmap with detailed identity/provenance, naming and Combine requirements; not the active work order. |
| [docs/Archive/voice-control-history-2026-11-05.md](docs/Archive/voice-control-history-2026-11-05.md) | Detailed characterization, staged extraction and race-fix history for the accepted voice checkpoint. |
| [docs/Archive/wake word implementation.md](docs/Archive/wake%20word%20implementation.md) | Early wake-model/phrase/threshold experiments and superseded implementation ideas. |
| [docs/Archive/wake-word-comparison-lab-2026-11-04.html](docs/Archive/wake-word-comparison-lab-2026-11-04.html) | Earlier standalone wake review/comparison tool with its own saved-review database. |
| [docs/Archive/wake-word-review-notes-2026-11-04.md](docs/Archive/wake-word-review-notes-2026-11-04.md) | Instructions/evidence for the archived comparison tool. |

## Maintenance scripts

| File | Function |
| --- | --- |
| [scripts/build-lab-manifest.py](scripts/build-lab-manifest.py) | Regenerates js/lab/manifest.json after lab code/model/runtime changes. |

## Regression tests

| File | Function |
| --- | --- |
| [tests/README.md](tests/README.md) | Test command, suite purposes, runner requirements and limitations of automated versus device checks. |
| [tests/recording_test_support.py](tests/recording_test_support.py) | Shared Python-to-JavaScript engine bridge, source extraction and controlled DOM/storage/recorder fixtures. |
| [tests/test_audio_output_check.py](tests/test_audio_output_check.py) | Independent output-check playback/cleanup, session-type restoration and canceled microphone-permission ownership tests. |
| [tests/test_emergency_recordings.py](tests/test_emergency_recordings.py) | Emergency retention and recorder/library integration; a separate test exercises the complete library module directly, including dialog ownership and deletion/restore/bulk cancellation. |
| [tests/test_fresh_speech.py](tests/test_fresh_speech.py) | Detector-aligned windows, raw sample bounds/amplitude for both engines, independent fresh state/context and traces, and bounded comparison lane with busy/timeout/error/late-result protections. |
| [tests/test_microphone_level_check.py](tests/test_microphone_level_check.py) | Ten-second temporary capture, cancellation/late permission and context results, cleanup/retry, manager ownership guards and recording startup handoff. |
| [tests/test_microphone_levels.py](tests/test_microphone_levels.py) | Passive RMS math, dial range/clamping, measured Q/N references, inactive/paused/unavailable states, separate buffers, visible-only polling and original microphone requests versus browser reports. |
| [tests/test_preservation_failure_control.py](tests/test_preservation_failure_control.py) | Opt-in fault control, default-off behavior, final tail retention and a normal next recording. |
| [tests/test_recorder_lab.py](tests/test_recorder_lab.py) | New recorder lab: warmed Whisper worker limits, bounded shadow verification/strict phrase matching/latency/deadlines, immediate pre-roll dispatch, opening-sentence phrase filenames, review clip bounds/WAV and gap/Stop handling, TP/FP/TN/FN comparisons, review playback guards and saved labels, continuous anti-alias resampling, speech/level gates, failed writes/late tails, actual encoder-start fallback, model-before-microphone ordering/cancellation, idempotent cleanup, final data after microphone loss, silent AudioWorklet packets, scripts and offline asset integrity. |
| [tests/test_recording_download.py](tests/test_recording_download.py) | Local timestamps, portable names, dialog preview/confirmation/cancellation, single-dialog ownership, actual download format and URL behavior, current-playback button creation/start-time naming and retained downloads without database metadata, and saved/emergency cancellation outside the writer lock. |
| [tests/test_recording_finalization.py](tests/test_recording_finalization.py) | Complete recovery module and recorder wiring: integrity/error/delay handling, fullest-copy retention, truthful status, confirmed discard with failure retention and current-player isolation. |
| [tests/test_recording_storage.py](tests/test_recording_storage.py) | Complete store module plus recorder wiring: ordering, counters, ownership, competing startup/deletion, abort/restore, diagnostic cleanup, schema and blocked/failed opens. |
| [tests/test_speech_detection.py](tests/test_speech_detection.py) | Production speech policy, settings, worker warm-up/lifecycle, bounded queue/timeout cancellation and streaming context/resampling regression checks. |
| [tests/test_storage_persistence.py](tests/test_storage_persistence.py) | Grants/refusals/unsupported APIs, errors/timeouts and automatic Settings refresh. |
| [tests/test_voice_control.py](tests/test_voice_control.py) | Complete voice controller, recorder session bridge, real pause/manual handlers and finalization entry: prompt/listener ordering, Go shutdown, Stop confirmation, timeout/thresholds, failures, stale sessions, narrow session capabilities, preserved deadline semantics, and TensorFlow clone/override/startup teardown. |
| [tests/test_voice_diagnostics.py](tests/test_voice_diagnostics.py) | Default-on 500-event bounded memory, safe copies/no raw audio, overflow, human-readable window summaries/partial data, automatic display/Settings refresh/clear/disable controls, observer failures, runtime build label and build metadata in voice/recording diagnostic exports. |
| [tests/test_wake_detector.py](tests/test_wake_detector.py) | Existing production audio callback and wake routing, both adapter implementations and real Heed preprocessing/trigger logic: scaling, ring boundaries, resampling, pending frames, busy skips, reset/rearm, thresholds/cooldowns, load selection/cache/retry, late results and explicitly identified existing async edge behavior. |
| [tests/test_wake_lab.py](tests/test_wake_lab.py) | Archived comparison lab clip boundaries/grouping, WAV encoding, script parsing, review playback/labels, local storage, portable audio/run-log archives, MP3 worker wiring/failure retention, original-audio comparison, playback blocking and safe history clearing. |

## Keeping this map current

When adding, moving or removing repository files, update the matching folder table and check its links. Describe generated and third-party assets here, but use [lab dependency notes](js/lab/SOURCES.md) for pinned versions/licenses and [the documentation index](docs/README.md) for current behavior and acceptance evidence. Earlier plans in the archive remain historical.
