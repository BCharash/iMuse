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
| `test_recording_finalization.py` | Integrity failures, error/unexpected stops, delayed operations, fuller recovery copies and truthful status |
| `test_storage_persistence.py` | Grants/refusals/unsupported APIs, errors/timeouts and automatic Settings refresh |

There are five suites with seven test methods. `recording_test_support.py` contains the shared engine bridge, production-source extraction and recorder fixtures. The complete library/store modules and actual recorder wiring are evaluated in integration checks; direct component tests supply fake DOM or IndexedDB services. Test suites do not import another suite. Each JavaScript evaluation has a fresh context. Individual files still run with `python3 tests/test_recording_storage.py`, for example.

These are regression checks, not temporary recording labs. They execute extracted production functions with controlled mocks and never access real recordings, a microphone, or browser databases. They do not certify actual IndexedDB/Web Locks behavior, native player layout/decoding, file saving, background execution or long-recording memory use. Function-boundary changes may require updating source extraction in the harness.

Manual acceptance lives in the [current recording brief](../docs/recording-investigation.md#focused-manual-checks). Keep that checklist current instead of adding a stage-specific checklist for every change.
