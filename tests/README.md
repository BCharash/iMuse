# Recording regression tests

Run all checks from the repository root:

```sh
python3 -m unittest discover -s tests -v
```

Python 3 runs JavaScript through Node when available, otherwise the macOS JavaScriptCore framework. Other platforms require Node. No pip dependencies are needed. Python and these files are development tools; the web application does not use them.

| Suite | Why retained |
| --- | --- |
| `test_speech_detection.py` | Production state policy, threshold/history boundaries, persisted settings, warmed worker lifetime, queue/timeout/error cancellation, late results, resampler continuity and Silero input context |
| `test_recording_download.py` | Local timestamps, portable names, dialog preview/confirmation/cancellation, single-dialog ownership, actual download format and URL behavior, current-playback button creation/start-time naming and retained downloads without database metadata, and saved/emergency cancellation outside the writer lock |
| `test_emergency_recordings.py` | Emergency retention and recorder/library integration; a separate test exercises the complete library module directly, including dialog ownership and deletion/restore/bulk cancellation |
| `test_preservation_failure_control.py` | Opt-in fault control, default-off behavior, final tail retention and a normal next recording |
| `test_recording_storage.py` | Complete store module plus recorder wiring: ordering, counters, ownership, competing startup/deletion, abort/restore, diagnostic cleanup, schema and blocked/failed opens |
| `test_audio_prompts.py` | Spoken prompt gain, mute/full-volume restoration, serialization and cancellation; predecoded complete-buffer playback for all six prompts, selected volume, acknowledgement completion and queue release |
| `test_recording_finalization.py` | Complete recovery module and recorder wiring: integrity/error/delay handling, fullest-copy retention, truthful status, stop announcement before storage completion, microphone retention/release and timeout independent of persisted audio, confirmed discard with failure retention and current-player isolation |
| `test_storage_persistence.py` | Grants/refusals/unsupported APIs, errors/timeouts and automatic Settings refresh |
| `test_microphone_level_check.py` | Ten-second temporary capture, cancellation/late permission and context results, cleanup/retry, manager ownership guards and recording startup handoff |
| `test_microphone_levels.py` | Passive RMS math, dial range/clamping, measured Q/N references, inactive/paused/unavailable states, separate buffers, visible-only polling and original microphone requests versus browser reports |
| `test_voice_diagnostics.py` | Default-on 500-event bounded memory, safe copies/no raw audio, overflow, human-readable window summaries/partial data, automatic display/Settings refresh/clear/disable controls, observer failures, readable summary/detail exports matching displayed rows, runtime build label and build metadata in voice/recording diagnostic exports |
| `test_voice_control.py` | Complete voice controller, recorder session bridge, real pause/manual handlers and finalization entry: prompt/listener ordering, Go shutdown, Stop confirmation, timeout/thresholds, failures, stale sessions, narrow session capabilities, preserved deadline semantics, and TensorFlow clone/override/startup teardown |
| `test_wake_detector.py` | Existing production audio callback and wake routing, both adapter implementations and real Heed preprocessing/trigger logic: scaling, ring boundaries, resampling, pending frames, busy skips, reset/rearm, thresholds/cooldowns, load selection/cache/retry, late results and explicitly identified existing async edge behavior |
| `test_fresh_speech.py` | Detector-aligned windows, raw sample bounds/amplitude for both engines, independent fresh state/context and traces, and bounded comparison lane with busy/timeout/error/late-result protections |
| `test_recorder_lab.py` | New recorder lab: warmed Whisper worker limits, bounded shadow verification/strict phrase matching/latency/deadlines, immediate pre-roll dispatch, opening-sentence phrase filenames, review clip bounds/WAV and gap/Stop handling, TP/FP/TN/FN comparisons, review playback guards and saved labels, continuous anti-alias resampling, speech/level gates, failed writes/late tails, actual encoder-start fallback, model-before-microphone ordering/cancellation, idempotent cleanup, final data after microphone loss, silent AudioWorklet packets, scripts and offline asset integrity |
| `test_wake_lab.py` | Archived comparison lab clip boundaries/grouping, WAV encoding, script parsing, review playback/labels, local storage, portable audio/run-log archives, MP3 worker wiring/failure retention, original-audio comparison, playback blocking and safe history clearing |

There are sixteen suites with one hundred seventeen test methods. `recording_test_support.py` contains the shared engine bridge, source extraction and recorder fixtures. Complete library/store/recovery modules and actual recorder wiring run in integration checks; direct component tests supply fake callbacks, DOM or IndexedDB services. Test suites do not import another suite. Each JavaScript evaluation has a fresh context. Individual files still run with `python3 tests/test_recording_storage.py`, for example.

Retain all sixteen suites: each covers an active production boundary or a still-available lab. The archived comparison suite remains useful while its HTML tool and saved-review database remain supported. No Python test file is removed by the documentation cleanup.

These are regression checks, not temporary recording labs. They execute extracted production functions with controlled mocks and never access real recordings, a microphone, or browser databases. They do not certify actual IndexedDB/Web Locks behavior, native player layout/decoding, file saving, background execution or long-recording memory use. Function-boundary changes may require updating source extraction in the harness.

Manual acceptance lives in the [current recording brief](../docs/recording-investigation.md#focused-manual-checks). Keep that checklist current instead of adding a stage-specific checklist for every change.

For the new standalone recorder lab, the asset-integrity check requires all bundled model/runtime files. Regenerate its manifest with `python3 scripts/build-lab-manifest.py` after lab edits. Device acceptance and reviewed-archive findings are in [wake-word evaluation](../docs/wake-word-evaluation.md). The archived comparison tests remain because the previous tool and its separate saved-review database are still available.

The voice suite executes the extracted production controller and recorder integration with diagnostics both off and on and fake model/playback/recorder/timer dependencies. It does not run speech models or certify browser microphone behavior. The scope, limitations and separately approved extraction sequence live in the [voice-control plan](../docs/voice-control-refactor.md).

The wake suite covers production speech-gate acceptance/stale-state guards as well as both extraction stages and the separately approved race fixes, including loader delegation/promise identity, live guards/threshold, trigger/error/busy-cleanup ordering, stale results/errors across replaced/discarded/inactive sessions and model/arm generations, cancelled rearm callbacks, cached detector reuse, rapid load success/error/progress ordering and threshold changes during loading. It executes the actual ScriptProcessor callback, recorder integration and extracted routing with a fake audio graph; adapter checks mock network/runtime/model dependencies. Heed trigger checks run the real filters and mel preprocessing with synthetic tones/silence and controlled logits. They do not execute the ONNX models or downloaded Voicute library, measure acoustic accuracy/latency, or certify native audio scheduling. Assertions documenting unwanted async behavior were deliberately replaced with regression checks for the approved fixes. Findings and history are maintained in the [wake checkpoint](../docs/voice-control-refactor.md#wake-race-corrections).

Earlier startup checkpoint: build 2026-11-12.11, 114 methods across sixteen suites. Chrome verified six startup prompt requests with commands off, no speech-model requests/workers, and functioning menus. Earlier checks covered real model activation and recording/stop cleanup. Enabled-model responsiveness and audible iPhone acceptance remain distinct from automated coverage. Documentation-only review does not rerun runtime tests.

Phase one, build 2026-11-13.1: 116 methods pass. Added download-marker state/counter preservation, archive/unarchive marker/chronology retention, no resurrection after permanent deletion, disclosure persistence, download cancellation/request and confirmed saved-recording deletion checks. Chrome additionally exercised the real UI/IndexedDB in a temporary profile, reload persistence and synthetic capture with command toggles. A 390 px screenshot had no horizontal overflow. Native iPhone behavior and real downloaded-file completion remain device checks.

Build 2026-11-13.3: 117 methods pass. Opening either recording category silently rereads storage, including initially empty lists; Hide does not fetch. The Refresh button and routine action messages are removed.
