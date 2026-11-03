# iMuse next steps

Updated 3 November 2026. This is the active work queue. See the [documentation index](README.md) and [recording investigation](recording-investigation.md) for evidence and source details. The detailed 1 November roadmap is [archived](Archive/roadmap-2026-11-01.md); it retains later feature requirements but no longer sets today's priority.

## Recommended immediate sequence

1. **Use the warning-free baseline.** Warning code, setting, WAV and temporary background labs are removed. Identify the deployed revision before the next device comparison. Existing user tests establish Safari-tab background success without warning playback; do not repeat the entire component matrix.
2. **Run the minimal installed capture comparison.** The user authorized a new lab.html and separate manifest after both audio-session experiments failed to improve installed capture and were reverted. Open the Safari control, then install **iMuse Mic Lab** and confirm **Standalone**. Capture before/background/after speech and download audio/JSON in each mode. See the [procedure](recording-investigation.md#minimal-installed-capture-lab--new-focused-test). No production code changes accompany this lab.
3. **Continue web-first while platform evidence is collected.** The user prefers to complete the web app before native work. They have no suitable cable for device-system logging, and an iOS 27 volunteer result may take days. Official Safari 27 notes include a related audio-session fix but do not prove this installed-host issue is repaired. Use the working Safari route for other development; no native project is scheduled.
4. **Address truthful interruption/recovery behavior separately.** Detect acquisition failure without interpreting silence or intentional pause as failure; handle interrupted contexts; retain source audio; distinguish interrupted output from clean completion. Context resume alone is not a recorder repair. Do not silently create and concatenate independent MP4 recordings.

A candidate background workaround must retain actual spoken background audio, not merely the recording icon, microphone indicator, running context, or eventual chunk callbacks. Keep production changes small; test the affected browser and installed modes separately. Screen lock and app switching need distinct acceptance results.

## Implemented foundation to preserve

- Independent Record/Pause/Resume and manual Stop; spoken Stop requires Yes confirmation. No or timeout leaves capture paused. Wake-triggered command mode is separate from automatic silence/manual pause.
- Incremental IndexedDB storage and reload recovery; an **8 MiB** pending-audio limit and release of chunks after commit. This bounds the pending capture buffer, not total browser memory or final assembly.
- Separate session IDs, ordered chunk sequences, actual MIME type, supported format preference and appropriate export extension.
- Microphone selection including exposed Shokz inputs, with acquisition/release centralized in the microphone manager. Headset media-button controls are retired on **both** desktop and mobile.
- Selectable Heed/Voicute wake engines; TensorFlow Go/Stop and Yes/No listeners; serialized normal spoken responses and paused reminder tones. No always-on idle wake before first Record.
- Saved recordings, recovery-to-saved-recording promotion, Recently Deleted, restore and selected permanent deletion. Source recordings are not deleted by starting a new session, exporting or sending audio to transcription.

The earlier seven-minute MacBook test reported about 27 KB peak pending audio with no accumulating queue. It is not multi-hour or iPhone memory certification. General syntax checks and mocked tests are not microphone/device acceptance.

## Open acceptance and correctness work

The following were not established as completed by the latest background tests. Schedule them after choosing a supported capture path, or when changing the affected code:

| Work | Required evidence |
| --- | --- |
| Recovered-recording UI persistence | Recover after reload, play/download, reload again, verify saved state and interruption history remain |
| iPhone session duration | 10–15-minute supported-mode recording, then 30-minute finalization/seek/export; inspect beginning/middle/end |
| Persistence failure/backpressure | Retain committed and pending audio appropriately; safe stop includes final recorder data; no false completion |
| Unexpected stop and acquisition stall | Correct session status; no restored/completed claim based only on state or nonempty Blob |
| Voice/controller races | Late callbacks cannot affect another session; serialized listener teardown; manual Stop versus confirmed spoken Stop |
| Bulk permanent deletion | Use disposable recordings: cancel changes nothing; confirm deletes only selected deleted sessions; preserve other recordings |
| Deployment/versioning | Identify actual module revision without clearing IndexedDB; top-level URL cache busting alone does not version imported modules |

Do not restart the Record UI redesign or bounded-queue implementation. Recheck the temporary TensorFlow getUserMedia override only when changing listener ownership or investigating a reproducible interaction; it is not necessary for the installed-lab failure.

## Later roadmap, retained but not started by this update

1. **Durable finalization and identity.** Separate interrupted capture from clean completion and validated final output. Preserve recovery chunks until any new finalized artifact is committed/read back and validated. Distinguish storage checks, container validity and audible completeness. Audit long-file `getAll()`/Blob memory before choosing a new storage architecture. Use nondestructive migrations only when justified.
2. **UUID and provenance metadata.** New capture and combined outputs have their own IDs; titles never define identity. Preserve source dates/IDs, ordered segment occurrences (including repeated use), verified durations/offsets and export/reimport metadata. Existing recordings need a non-destructive backfill design before schema changes.
3. **Optional naming after finalization.** Timestamp fallback and editable title first; optional opening-audio Whisper Tiny suggestion only after safe persistence, using Memora's existing model management where available. Naming failure cannot change audio or recording status.
4. **Separate Combine workflow.** A Combine Recordings button below Saved Recordings; select and order library recordings, produce a new recording, preserve originals. No capture-time append mode or new standalone Combine tab. Use compatible AAC/M4A remuxing only with verified format checks; independent MP4 files cannot be byte-concatenated. Detailed requirements remain in the [archived roadmap](Archive/roadmap-2026-11-01.md).
5. **Memora integration.** Use its existing Transcribe, file management, Edit/Combine and Search; expose a narrow non-destructive audio handoff. See the [integration contract](iMuse%20Memora%20integration%20handoff.md). Do not make Whisper a recording dependency.

Deferred: idle wake listening; custom “Hey iMuse” training; reversible command-audio removal; headset media-button revival; native iOS/Android implementation. The [Swift proposal](iMuse%20Swift%20migration%20plan.md) is a conditional alternative if installed iPhone capture cannot meet requirements, not a second full Memora product.

## Working method

Inspect current workspace source and deployed revision; request files only when absent or unavailable. Preserve original audio and unrelated user changes. Make one explainable change per experiment and inspect its result before expanding scope. Keep checkpoints in version control without automatically committing or deploying. When delivering replacement code in a ZIP, preserve exact repository-relative filenames and explicitly identify deletions; a ZIP containing replacements cannot itself remove old files.

Keep new test results in the investigation and dated decisions in the journal. Do not reinstate removed warning playback or broadly instrument capture without a missing measurement that warrants it. Never clear browser site data/IndexedDB to solve a cache problem.
