# iMuse → Memora Integration Handoff

**Updated:** 31 October 2026  
**Audience:** Agent implementing the unified iMuse application  
**Status:** Current user decisions and proposed integration plan; **no code changes authorized by this document**

## Objective

Merge iMuse's independent, durable **Record** functionality into the Memora-based application. Intended tab order: **Record → Transcribe → Edit and Combine → Search**. Memora already has desktop/mobile file opening and saving, Whisper transcription, model/runtime management, editing/combining, and search. **Reuse those implementations rather than rebuilding them.** Record must remain usable even when Whisper is unavailable.

## What is established by user testing

- iMuse writes audio incrementally to IndexedDB and has recovered recordings after a page reload during active recording. A prior test recovered three spoken sections separated by pauses; a later test reloaded in the middle of speech after auto-pause and manual pause/resume, and recovered/exported an `.m4a` recording.
- The user accepts losing a short tail of speech immediately before an abrupt reload/crash. Preserving already committed audio and producing a usable recovery is the priority, not lossless last-millisecond crash capture.
- A prior exported `.webm` file was successfully opened by Memora. iMuse prefers M4A/AAC when the browser supports it, otherwise uses a supported format. **Do not relabel one container with another extension.**
- **Delete Saved Session** deletes only the selected saved recording. Starting a new recording does not disturb previous saved sessions. Delete is **hidden during active recording**, so a test of pressing Delete mid-recording is not a valid normal UI scenario.
- Auto-pause after about five seconds of detected inactivity, manual pause/resume, and the **periodic double beep while paused** remain recording functions. Heed and Voicute are now selectable wake engines; a detected wake opens a bounded TensorFlow Go/Stop command window. Neither wake nor command recognition justifies adding Whisper to Record.
- On MacBook Chrome, GitHub Pages microphone denial was fixed by adjusting site-specific microphone permission; localhost and iPhone access worked. No Git changes were involved. This is a permissions issue, not a demonstrated recording defect.
- Desktop opt-in headset controls have worked in Mac Chrome, with some variable responsiveness. Mobile headset controls are disabled/deferred: in tested iPhone conditions, microphone capture and headset media-button delivery did not coexist dependably. Do not reopen that investigation during integration.

## Evidence boundaries

The previous assistant reported technical checks of the recovered M4A (roughly 21 seconds of AAC audio and no reported decoding/timestamp problems). This handoff does **not** independently re-run those checks. One successful recording does not prove every browser/container combination or every crash scenario. IndexedDB can lose data that has not yet committed and remains subject to browser storage policies. Do not claim guarantees; equally, do not replace a working design without a demonstrated reason.

## Architecture and ownership

**Record owns:** microphone permission and capture, manual/automatic pause/resume, incremental IndexedDB chunk persistence, recovery, recording session list and explicit deletion, completed/recovered audio artifacts, and recording-specific metadata. Recording must not depend on model loading, transcription, or network availability.

**Memora owns:** desktop/iPhone file selection and save/export pathways, Transcribe workflow and Whisper model registry/resource manager, transcript creation, Edit and Combine, and Search. Avoid parallel file pickers, model selectors, or duplicate transcription workers unless existing architecture truly requires them.

**Integration boundary:** expose an audio Blob/File (or a stable retrieval function), actual MIME type, appropriate filename/extension, recording/session identifier, and status (`completed` or `recovered/interrupted`). Duration is useful if reliably known; don't invent it. The receiving Transcribe pathway should handle both newly recorded and imported audio using the same processing logic. Avoid coupling to internal IndexedDB object-store structure if a narrower interface can be used.

**Non-destructive transfer:** Passing audio to Transcribe, saving/exporting it, or creating a transcript **must not automatically delete the original audio** from IndexedDB. Explicit deletion remains a user action. Keep source data available if transfer or transcription fails. Determine ownership and lifetime of any temporary Blob/object URL during integration.

## Immediate implementation plan

1. **Request latest source** from both repositories (especially iMuse recorder/storage/UI and Memora file-open/import, Transcribe, and shared app/navigation code). Do not edit based on older files or memory.
2. **Map existing flows**: how iMuse lists/recovers/exports a saved session; how Memora opens an audio file on desktop and iPhone and passes it into Transcribe. Record actual formats and interfaces, not assumptions.
3. **Design the smallest handoff** and agree it with the user. Prefer invoking Memora's established import/transcription path with a Blob/File and metadata rather than building another file-save/load system.
4. **Implement incrementally**, preserving the Record tab's independent capture and recovery lifecycle. Avoid refactoring storage or media assembly unless a concrete integration failure requires it.
5. **Acceptance test** one normal completed recording and one interrupted/recovered recording through Transcribe; verify the source recording remains available afterward, and that existing desktop/mobile import/save functionality is not regressed.

## Explicitly deferred / not a blocker

- OPFS migration or more elaborate crash buffering to preserve a fraction of a second of speech.
- Repeating already successful Delete Saved Session, new-session isolation, and basic reload recovery tests without a new failure hypothesis.
- Broad container-remuxing or finalization redesign absent evidence of invalid output.
- iPhone Bluetooth headset media-button control during capture.
- Idle wake listening before the first Start Recording action (planned next, not implemented); custom wake-phrase training; Whisper-tiny commands (superseded by current TensorFlow Go/Stop).
- Comprehensive cross-browser, background/locked-screen, and long-duration stress certification. These may be separate future quality tasks; do not present them as completed.

## Working rules

- The latest files supplied by the user are authoritative. Ask for current versions of every source file before editing.
- Make focused changes, verify them, and return code in a ZIP **with each original filename unchanged** (no appended numbers, suffixes, or parentheses inside the ZIP).
- Remove temporary diagnostics when finished; avoid speculative modifications.
- Distinguish tested behavior, user acceptance, assistant inference, and untested assumptions.
- Keep the journal chronological. Use `iMuse next steps.md` for active priorities and this handoff for integration architecture.

**Bottom line:** iMuse Record has a useful, user-accepted IndexedDB recovery foundation. The next job is to connect that recording to Memora's existing Transcribe and file-management workflows **without losing the source recording or duplicating Memora's functionality**.

## Voice-control implementation update — 31 October 2026

- Existing code separates wake engines (`js/heed/`, `js/voicute/`), TensorFlow command recognition (`js/tensorflow/`), microphone acquisition (`js/microphone-manager.js`), and spoken playback (`js/audio-response-manager.js`). Recorder/controller code still coordinates multiple states; **do not assume the controller is fully decoupled yet**.
- During an active session, wake while recording pauses capture and opens Go/Stop listening after the pause acknowledgment; wake while already paused says “Yes?” before listening. Silence/manual pauses never themselves launch TensorFlow. Go resumes the existing session; Stop finalizes; timeout remains paused.
- State-driven WAV responses: New recording, Pause, Recording, Recording stopped. Keep the recurring **double beep** while paused. The command timer is now a compact light-blue, counterclockwise-emptying disk.
- User reported MacBook System default microphone selected Shokz and both wake engines worked in recent tests; further reliability and iPhone testing remain necessary.
- **Future idle behavior:** wake before first Start Recording → “Yes?” → Go creates a new session, which announces “New recording”. This is a design requirement, **not current implemented behavior**.
- Preserve audio source and crash recovery regardless of wake, TensorFlow, or spoken-response errors. Before integration, request fresh source from both repositories and verify interface details.
