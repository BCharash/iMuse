# iMuse next steps

Updated 5 November 2026. This is the active work queue. **Build 2026-11-05.3 is the accepted wake-refactor/race-fix checkpoint:** the user tested it and reported success. The latest implementation suite passed 94 methods across fourteen suites; device/browser details of that user check were not specified. See the [documentation index](README.md) and [recording investigation](recording-investigation.md). The detailed 1 November roadmap is [archived](Archive/roadmap-2026-11-01.md); it retains later feature requirements but no longer sets today's priority.

## Current priorities

**Accepted download checkpoint: build 2026-11-05.6.** The user reported the current-player download fix worked after permanent deletion. Device/browser details were not specified. The current player retains its audio/default filename without an extra message; download-only description editing is implemented. Saved-list title editing, Whisper naming and a broader file-save workflow remain future work. See [download naming](recording-investigation.md#download-naming).

**Deferred by the user:** asset fingerprinting/version-maintenance upgrades and further live lab work. Keep the accepted production behavior stable. Generated asset/build automation remains a separate future assessment under the [build guide](build-versioning.md), not the current priority.

1. **Preserve accepted behavior and user tuning.** Library/store/recovery extractions and the Discard correction were reported working, including on iPhone. Command diagnostics helped the user distinguish intended scores (at least 0.90) from unintended ones (at most 0.88), and they raised the threshold. Do not reset their settings. This does not prove the intermittent issue is eliminated or establish its cause. Diagnostics remain default-on, page-memory-only, last 500 events in Advanced.
2. **Keep preservation and voice regressions covered.** Four preservation stages, the microphone-level check/countdown, grouped Settings, temporary voice-action suspension and wake refactor are implemented. Run the repository suite after relevant code changes; the latest implementation checkpoint is 94 methods across fourteen suites. Use the [tests guide](../tests/README.md) and [focused manual checklist](recording-investigation.md#focused-manual-checks) for scope and limits. The successful user check is accepted without claiming a complete device matrix or measured false-trigger rate.
3. **Defer native testing until equipment is available.** The user lacks a suitable cable. A small native recorder is the first feasibility gate, not a full port. Continue web iMuse for desktop/other platforms and the reported working iPhone Safari-tab route. Native iMuse with transcription/multiple cached models is under consideration; [native scope and recording-priority requirements](iMuse%20Swift%20migration%20plan.md) are conditional, not implemented.
4. **Evaluate transcription after the refactor.** Keep Whisper out of live wake verification. Compare Base with Tiny for finished-recording naming/transcription; the user's Memora experience favors Base, but iMuse device performance needs measurement. Recording, including paused sessions and preservation, always takes priority. No transcription implementation is authorized by this roadmap.

**Deferred lab follow-up:** the user cannot undertake fresh-Silero queue/latency changes now. The [documented resume plan](wake-word-evaluation.md#deferred-queue-and-fresh-latency-investigation) measures the existing eight-packet limit, dispatch/render scheduling and 30–248 ms observed comparison delays before changing architecture. Keep continuous gating as the live baseline; do not increase the queue, introduce graded silence/pause policy or change production as incidental work. The earlier genuine-phrase rescue was an offline fresh-state replay, not yet a demonstrated benefit of the current live 1.12-second comparison. Resume implementation only when requested.

A candidate background workaround must retain actual spoken background audio, not merely the recording icon, microphone indicator, running context, or eventual chunk callbacks. Keep production changes small; test the affected browser and installed modes separately. Screen lock and app switching need distinct acceptance results.

## Implemented foundation to preserve

- Independent Record/Pause/Resume and manual Stop; spoken Stop requires Yes confirmation. No or timeout leaves capture paused. Wake-triggered command mode is separate from automatic silence/manual pause.
- Atomic incremental IndexedDB storage and reload recovery; an **8 MiB** pending threshold requests a protective stop. Chunks release after commit. The threshold is not a hard bound on final chunks, retained emergencies, total memory or assembly.
- Separate session IDs, ordered chunk sequences, actual MIME type, supported format preference and appropriate export extension.
- Microphone selection including exposed Shokz inputs, with acquisition/release centralized in the microphone manager. Headset media-button controls are retired on **both** desktop and mobile.
- Selectable Heed/Voicute wake engines; TensorFlow Go/Stop and Yes/No listeners; serialized normal spoken responses and paused reminder tones. No always-on idle wake before first Record.
- Extracted wake loading/inference with latest-load, session/detector/arming-cycle guards and guarded error reporting; readable production build identity in Settings and diagnostic exports. AudioWorklet migration and Silero remain separate experiments.
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
| Voice/controller regressions | Wake race fixes are user-accepted and automatically covered; retain stale-session/arming/load and command-shutdown checks when changing their boundaries |
| Bulk permanent deletion | Use disposable recordings: cancel changes nothing; confirm deletes only selected deleted sessions; preserve other recordings |
| Deployment/versioning | Build display/diagnostic identity implemented; generated asset fingerprinting and cache-consistent deployment remain to be assessed without clearing IndexedDB |

Do not restart the Record UI redesign or bounded-queue implementation. Recheck the temporary TensorFlow getUserMedia override only when changing listener ownership or investigating a reproducible interaction; it is not necessary for the installed-lab failure.

## Later roadmap, retained but not started by this update

1. **Further preservation and long-file work.** Structural checks and interrupted outcomes are implemented. Consider automatic persistence retries for emergency tails and audit `getAll()`/Blob memory before choosing another architecture. A future separate finalized artifact needs commit/readback validation while preserving original chunks. Container decoding and audible completeness remain distinct from structural checks; migrations must be nondestructive.
2. **UUID and provenance metadata.** New capture and combined outputs have their own IDs; titles never define identity. Preserve source dates/IDs, ordered segment occurrences (including repeated use), verified durations/offsets and export/reimport metadata. Existing recordings need a non-destructive backfill design before schema changes.
3. **Optional naming after finalization.** Download-only editable descriptions are implemented; persisted saved-list titles remain separate future work; optional opening-audio model suggestion after safe persistence and only while recording is inactive; compare Base/Tiny and inspect Memora's current model management before reuse. Naming failure cannot change audio or recording status.
4. **Separate Combine workflow.** A Combine Recordings button below Saved Recordings; select and order library recordings, produce a new recording, preserve originals. No capture-time append mode or new standalone Combine tab. Use compatible AAC/M4A remuxing only with verified format checks; independent MP4 files cannot be byte-concatenated. Detailed requirements remain in the [archived roadmap](Archive/roadmap-2026-11-01.md).
5. **Memora integration.** Use its existing Transcribe, file management, Edit/Combine and Search; expose a narrow non-destructive audio handoff. See the [integration contract](iMuse%20Memora%20integration%20handoff.md). Do not make Whisper a recording dependency.

Deferred: idle wake listening; custom “Hey iMuse” training; reversible command-audio removal; headset media-button revival; native implementation. The [Swift proposal](iMuse%20Swift%20migration%20plan.md) now includes possible native transcription and multiple cached models, while retaining Memora and web iMuse. Full Memora feature parity is not agreed.

## Working method

Inspect current workspace source and deployed revision; request files only when absent or unavailable. Preserve original audio and unrelated user changes. Make one explainable change per experiment and inspect its result before expanding scope. Keep checkpoints in version control without automatically committing or deploying. When delivering replacement code in a ZIP, preserve exact repository-relative filenames and explicitly identify deletions; a ZIP containing replacements cannot itself remove old files.

Keep new test results in the investigation and dated decisions in the journal. Do not reinstate removed warning playback or broadly instrument capture without a missing measurement that warrants it. Never clear browser site data/IndexedDB to solve a cache problem.
