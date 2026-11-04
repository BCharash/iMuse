# iMuse next steps

Updated 4 November 2026. This is the active work queue. See the [documentation index](README.md) and [recording investigation](recording-investigation.md) for evidence and source details. The detailed 1 November roadmap is [archived](Archive/roadmap-2026-11-01.md); it retains later feature requirements but no longer sets today's priority.

## Current priorities

1. **Keep the accepted behavior stable.** The three extractions and Discard correction were reported working, including on iPhone. The approved command-controller extraction is implemented, following the tests/documentation checkpoint. All 39 test methods pass; isolated Chrome checks retained two recordings through manual pause/resume/Stop. MacBook/iPhone voice acceptance is next. See the [voice-control plan](voice-control-refactor.md) for protected behavior, ownership and staged extraction. The user approved this extraction after its description; inform the user before any further production change. Do not start wake-detector extraction yet. The full [manual checklist](recording-investigation.md#focused-manual-checks) remains available for relevant changes.
2. **Keep preservation regressions covered.** Four stages are implemented: emergency retention, coordinated writes/ownership, truthful completion checks/delayed recovery and browser-persistence reporting. Run `python3 -m unittest discover -s tests -v` after relevant changes. Details and limits live in [tests/README.md](../tests/README.md).
3. **Continue web-first.** Safari-tab capture is the reported working iPhone route. Keep completed negative PWA tests; do not reinstate warning playback or speculative activation/keep-alive patches. Await new platform evidence, an iOS 27 comparison or connected-device logging when available. No native project is scheduled.
4. **Choose further work with the user.** No fifth stage is authorized. Automatic retry of memory-only emergency tails, capture-stall detection/foreground repair and long-file memory improvements are distinct possible projects. None can reconstruct microphone audio never delivered by the OS.

A candidate background workaround must retain actual spoken background audio, not merely the recording icon, microphone indicator, running context, or eventual chunk callbacks. Keep production changes small; test the affected browser and installed modes separately. Screen lock and app switching need distinct acceptance results.

## Implemented foundation to preserve

- Independent Record/Pause/Resume and manual Stop; spoken Stop requires Yes confirmation. No or timeout leaves capture paused. Wake-triggered command mode is separate from automatic silence/manual pause.
- Atomic incremental IndexedDB storage and reload recovery; an **8 MiB** pending threshold requests a protective stop. Chunks release after commit. The threshold is not a hard bound on final chunks, retained emergencies, total memory or assembly.
- Separate session IDs, ordered chunk sequences, actual MIME type, supported format preference and appropriate export extension.
- Microphone selection including exposed Shokz inputs, with acquisition/release centralized in the microphone manager. Headset media-button controls are retired on **both** desktop and mobile.
- Selectable Heed/Voicute wake engines; TensorFlow Go/Stop and Yes/No listeners; serialized normal spoken responses and paused reminder tones. No always-on idle wake before first Record.
- Unified saved-recording playback/export, retained emergency copies, interrupted/error history, structural checks, Recently Deleted, restore and explicit permanent deletion. Source audio is not released by starting another recording or requesting an export. Recovery does not imply normal completion.
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
| Voice/controller races | Late callbacks cannot affect another session; serialized listener teardown; manual Stop versus confirmed spoken Stop |
| Bulk permanent deletion | Use disposable recordings: cancel changes nothing; confirm deletes only selected deleted sessions; preserve other recordings |
| Deployment/versioning | Identify actual module revision without clearing IndexedDB; top-level URL cache busting alone does not version imported modules |

Do not restart the Record UI redesign or bounded-queue implementation. Recheck the temporary TensorFlow getUserMedia override only when changing listener ownership or investigating a reproducible interaction; it is not necessary for the installed-lab failure.

## Later roadmap, retained but not started by this update

1. **Further preservation and long-file work.** Structural checks and interrupted outcomes are implemented. Consider automatic persistence retries for emergency tails and audit `getAll()`/Blob memory before choosing another architecture. A future separate finalized artifact needs commit/readback validation while preserving original chunks. Container decoding and audible completeness remain distinct from structural checks; migrations must be nondestructive.
2. **UUID and provenance metadata.** New capture and combined outputs have their own IDs; titles never define identity. Preserve source dates/IDs, ordered segment occurrences (including repeated use), verified durations/offsets and export/reimport metadata. Existing recordings need a non-destructive backfill design before schema changes.
3. **Optional naming after finalization.** Timestamp fallback and editable title first; optional opening-audio Whisper Tiny suggestion only after safe persistence, using Memora's existing model management where available. Naming failure cannot change audio or recording status.
4. **Separate Combine workflow.** A Combine Recordings button below Saved Recordings; select and order library recordings, produce a new recording, preserve originals. No capture-time append mode or new standalone Combine tab. Use compatible AAC/M4A remuxing only with verified format checks; independent MP4 files cannot be byte-concatenated. Detailed requirements remain in the [archived roadmap](Archive/roadmap-2026-11-01.md).
5. **Memora integration.** Use its existing Transcribe, file management, Edit/Combine and Search; expose a narrow non-destructive audio handoff. See the [integration contract](iMuse%20Memora%20integration%20handoff.md). Do not make Whisper a recording dependency.

Deferred: idle wake listening; custom “Hey iMuse” training; reversible command-audio removal; headset media-button revival; native iOS/Android implementation. The [Swift proposal](iMuse%20Swift%20migration%20plan.md) is a conditional alternative if installed iPhone capture cannot meet requirements, not a second full Memora product.

## Working method

Inspect current workspace source and deployed revision; request files only when absent or unavailable. Preserve original audio and unrelated user changes. Make one explainable change per experiment and inspect its result before expanding scope. Keep checkpoints in version control without automatically committing or deploying. When delivering replacement code in a ZIP, preserve exact repository-relative filenames and explicitly identify deletions; a ZIP containing replacements cannot itself remove old files.

Keep new test results in the investigation and dated decisions in the journal. Do not reinstate removed warning playback or broadly instrument capture without a missing measurement that warrants it. Never clear browser site data/IndexedDB to solve a cache problem.
