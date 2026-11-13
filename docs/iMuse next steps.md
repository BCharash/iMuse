# iMuse next steps

**Production Combine checkpoint, 13 November — 2026-11-13.6:** [Saved Recordings Combine](combine-recordings.md) creates new compatible M4A/AAC files, retains originals and embeds source history. Nested chronological ordering and repeated occurrences are preserved. The separate Combine prototype is removed; the wake/Silero lab stays. Next: iPhone playback/seek/Files acceptance using disposable recordings and resource measurements for larger combinations.

## Phase-one acceptance — 2026-11-13.4

Check on iPhone and Mac: both audio-command controls mirror each other during capture/pause, main button text remains readable, command status is below Microphone, completion/player/download/delete order, pulse and cancelled/completed download requests, reload persistence, View/Hide, Archive/Unarchive chronology and confirmed permanent deletion. Use disposable recordings for deletion. Preserve the separate iOS 27 installed-PWA background and lightweight Swift feasibility plans. The user has already recorded more than 90 minutes; review existing playback/seek/export evidence instead of requiring another duration test merely to repeat it.

## Combine replaces the append proposal

Capture-time appending and an Appending Recording label are superseded. Combine is a separate Saved Recordings operation. New combined files rise to the top; originals remain until the user archives/deletes them. Automatic cleanup of old download-requested recordings remains future work under a separate retention policy; a download request is not verified external backup.

## Next acceptance

1. Check iPhone startup with Audio commands off: prompts prepare, voice models do not. Enable commands and check readiness, wake/commands and warm off/on reuse. Enabled-model UI stalls remain open; worker isolation requires separate design and validation.
2. Check all spoken prompts at full/reduced volume, speaker/Bluetooth, Safari/PWA. Yes/preview is user-accepted; the other messages still need acceptance. Confirm stop timing, disabled New Recording until cleanup, saved playback/download and another recording.
3. Retain production Silero acceptance: pause on/recording off defaults, immediate post-pause wake, both engines and state switches, suspension and manual controls. Preserve user tuning.
4. Investigate reproducible failures with one hypothesis and detailed diagnostics. The intermittent menu issue was mainly reported after updates, is currently absent, and was not reproduced by single emulated touches. Do not add tap suppression speculatively.

## Deferred work

Lab queue/fresh-comparison work remains separate: measure dispatch, render time, audio age, occupancy and drops before changing the eight-packet limit. Do not enlarge queues as a first fix. See the [resume plan](wake-word-evaluation.md#deferred-queue-and-fresh-latency-investigation).

Native feasibility waits for suitable equipment and real-device capture tests. Production transcription/naming, Base/Tiny comparison, asset fingerprinting/version-maintenance upgrades and AudioWorklet migration remain deferred. Heed Hey iMuse training/integration and the production Silero integration are already implemented; do not restart them as pending projects.

## Implemented foundation to preserve

- Independent Record/Pause/Resume and manual Stop; spoken Stop requires Yes confirmation. No or timeout leaves capture paused. Wake-triggered command mode is separate from automatic silence/manual pause.
- Atomic incremental IndexedDB storage and reload recovery; an **8 MiB** pending threshold requests a protective stop. Chunks release after commit. The threshold is not a hard bound on final chunks, retained emergencies, total memory or assembly.
- Separate session IDs, ordered chunk sequences, actual MIME type, supported format preference and appropriate export extension.
- Microphone selection including exposed Shokz inputs, with acquisition/release centralized in the microphone manager. Headset media-button controls are retired on **both** desktop and mobile.
- Selectable Heed/Voicute wake engines; TensorFlow Go/Stop and Yes/No listeners; serialized normal spoken responses and paused reminder tones. No always-on idle wake before first Record.
- Extracted wake loading/inference with latest-load, session/detector/arming-cycle guards and guarded error reporting; readable production build identity in Settings and diagnostic exports. AudioWorklet migration and fresh-Silero comparison remain separate experiments; continuous Silero now optionally checks production wake acceptance in selected states.
- Unified saved-recording playback/export, retained emergency copies, interrupted/error history, structural checks, Archived Recordings, restore and explicit permanent deletion. Source audio is not released by starting another recording or requesting an export. Recovery does not imply normal completion.
- Serialized session/chunk updates, exclusive writer coordination through finalization, delayed-finalization recovery actions and browser-controlled persistent-storage requests/reporting.

The earlier seven-minute MacBook test reported about 27 KB peak pending audio with no accumulating queue. It is not multi-hour or iPhone memory certification. General syntax checks and mocked tests are not microphone/device acceptance.

## Open acceptance and correctness work

The following were not established as completed by the latest background tests. Schedule them after choosing a supported capture path, or when changing the affected code:

| Work | Required evidence |
| --- | --- |
| Recovered-recording UI persistence | Load after reload using ▶, play/download, reload again, verify availability and interruption history remain |
| iPhone session duration | 10–15-minute supported-mode recording, then 30-minute finalization/seek/export; inspect beginning/middle/end |
| Persistence failure/backpressure | Automated coverage and a reported short device test exist; broader device/long-file acceptance remains |
| Unexpected stop and acquisition stall | Error/stop classification is implemented and mock-tested; actual acquisition-stall detection and foreground repair remain open |
| Voice/controller regressions | Wake race fixes are user-accepted and automatically covered; retain stale-session/arming/load and command-shutdown checks when changing their boundaries |
| Bulk permanent deletion | Use disposable recordings: cancel changes nothing; confirm deletes only selected deleted sessions; preserve other recordings |
| Deployment/versioning | Build display/diagnostic identity implemented; generated asset fingerprinting and cache-consistent deployment remain to be assessed without clearing IndexedDB |

Do not restart the Record UI redesign or bounded-queue implementation. Recheck the temporary TensorFlow getUserMedia override only when changing listener ownership or investigating a reproducible interaction; it is not necessary for the installed-lab failure.

## Later roadmap, retained but not started by this update

1. **Further preservation and long-file work.** Structural checks and interrupted outcomes are implemented. Consider automatic persistence retries for emergency tails and audit `getAll()`/Blob memory before choosing another architecture. A future separate finalized artifact needs commit/readback validation while preserving original chunks. Container decoding and audible completeness remain distinct from structural checks; migrations must be nondestructive.
2. **UUID and provenance metadata.** Capture and combined outputs have their own IDs; titles never define identity. Combine now stores and embeds original source snapshots and ordered occurrences, including repeats and packet boundaries, without a schema change. Broader original-file metadata embedding/import remains future work.
3. **Optional naming after finalization.** Download-only editable descriptions are implemented; persisted saved-list titles remain separate future work; optional opening-audio model suggestion after safe persistence and only while recording is inactive; compare Base/Tiny and inspect Memora's current model management before reuse. Naming failure cannot change audio or recording status.
4. **Combine follow-up.** Compatible M4A/AAC remuxing and source history are implemented; see [current behavior and remaining device checks](combine-recordings.md). Broader format conversion, external import and very large-file memory work remain separate future decisions.
5. **Memora integration.** Use its existing Transcribe, file management, Edit/Combine and Search; expose a narrow non-destructive audio handoff. See the [integration contract](iMuse%20Memora%20integration%20handoff.md). Do not make Whisper a recording dependency.

Deferred: idle wake listening; reversible command-audio removal; headset media-button revival; native implementation. The [Swift proposal](iMuse%20Swift%20migration%20plan.md) now includes possible native transcription and multiple cached models, while retaining Memora and web iMuse. Full Memora feature parity is not agreed.

## Working method

Inspect current workspace source and deployed revision; request files only when absent or unavailable. Preserve original audio and unrelated user changes. Make one explainable change per experiment and inspect its result before expanding scope. Keep checkpoints in version control without automatically committing or deploying. When delivering replacement code in a ZIP, preserve exact repository-relative filenames and explicitly identify deletions; a ZIP containing replacements cannot itself remove old files.

Keep new test results in the investigation and dated decisions in the journal. Do not reinstate removed warning playback or broadly instrument capture without a missing measurement that warrants it. Never clear browser site data/IndexedDB to solve a cache problem.
