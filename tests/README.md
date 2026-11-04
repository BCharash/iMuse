# Recording regression tests

Run all checks from the repository root:

```sh
python3 -m unittest discover -s tests -v
```

Python 3 runs JavaScript through Node when available, otherwise the macOS JavaScriptCore framework. Other platforms require Node. No pip dependencies are needed. Python and these files are development tools; the web application does not use them.

| Suite | Why retained |
| --- | --- |
| `test_emergency_recordings.py` | Emergency retention and recorder/library integration; a separate test exercises the complete library module directly, including dialog ownership and deletion/restore/bulk cancellation |
| `test_preservation_failure_control.py` | Opt-in fault control, default-off behavior, final tail retention and a normal next recording |
| `test_recording_storage.py` | Complete store module plus recorder wiring: ordering, counters, ownership, competing startup/deletion, abort/restore, diagnostic cleanup, schema and blocked/failed opens |
| `test_recording_finalization.py` | Complete recovery module and recorder wiring: integrity/error/delay handling, fullest-copy retention, truthful status, confirmed discard with failure retention and current-player isolation |
| `test_storage_persistence.py` | Grants/refusals/unsupported APIs, errors/timeouts and automatic Settings refresh |
| `test_microphone_level_check.py` | Ten-second temporary capture, cancellation/late permission and context results, cleanup/retry, manager ownership guards and recording startup handoff |
| `test_microphone_levels.py` | Passive RMS math, dial range/clamping, measured Q/N references, inactive/paused/unavailable states, separate buffers, visible-only polling and original microphone requests versus browser reports |
| `test_voice_diagnostics.py` | Default-on 500-event bounded memory, safe copies/no raw audio, overflow, human-readable window summaries/partial data, automatic display/Settings refresh/clear/disable controls and observer failures |
| `test_voice_control.py` | Complete voice controller, recorder session bridge, real pause/manual handlers and finalization entry: prompt/listener ordering, Go shutdown, Stop confirmation, timeout/thresholds, failures, stale sessions, narrow session capabilities, preserved deadline semantics, and TensorFlow clone/override/startup teardown |
| `test_recorder_lab.py` | New recorder lab: warmed Whisper worker limits, bounded shadow verification/strict phrase matching/latency/deadlines, immediate pre-roll dispatch, opening-sentence phrase filenames, review clip bounds/WAV and gap/Stop handling, TP/FP/TN/FN comparisons, review playback guards and saved labels, continuous anti-alias resampling, speech/level gates, failed writes/late tails, actual encoder-start fallback, model-before-microphone ordering/cancellation, idempotent cleanup, final data after microphone loss, silent AudioWorklet packets, scripts and offline asset integrity |
| `test_wake_lab.py` | Archived comparison lab clip boundaries/grouping, WAV encoding, script parsing, review playback/labels, local storage, portable audio/run-log archives, MP3 worker wiring/failure retention, original-audio comparison, playback blocking and safe history clearing |

There are eleven suites with forty-nine test methods. `recording_test_support.py` contains the shared engine bridge, source extraction and recorder fixtures. Complete library/store/recovery modules and actual recorder wiring run in integration checks; direct component tests supply fake callbacks, DOM or IndexedDB services. Test suites do not import another suite. Each JavaScript evaluation has a fresh context. Individual files still run with `python3 tests/test_recording_storage.py`, for example.

Retain all eleven suites: each covers an active production boundary or a still-available lab. The archived comparison suite remains useful while its HTML tool and saved-review database remain supported. No Python test file is removed by the documentation cleanup.

These are regression checks, not temporary recording labs. They execute extracted production functions with controlled mocks and never access real recordings, a microphone, or browser databases. They do not certify actual IndexedDB/Web Locks behavior, native player layout/decoding, file saving, background execution or long-recording memory use. Function-boundary changes may require updating source extraction in the harness.

Manual acceptance lives in the [current recording brief](../docs/recording-investigation.md#focused-manual-checks). Keep that checklist current instead of adding a stage-specific checklist for every change.

For the new standalone recorder lab, the asset-integrity check requires all bundled model/runtime files. Regenerate its manifest with `python3 scripts/build-lab-manifest.py` after lab edits. Device acceptance and reviewed-archive findings are in [wake-word evaluation](../docs/wake-word-evaluation.md). The archived comparison tests remain because the previous tool and its separate saved-review database are still available.

The voice suite executes the extracted production controller and recorder integration with diagnostics both off and on and fake model/playback/recorder/timer dependencies. It does not run speech models or certify browser microphone behavior. The scope, limitations and separately approved extraction sequence live in the [voice-control plan](../docs/voice-control-refactor.md).
