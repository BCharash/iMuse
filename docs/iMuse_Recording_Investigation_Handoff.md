# iMuse Recording Investigation — Handoff
**Date:** 2 November 2026  
**Status:** Working baseline restored; flight-recorder instrumentation reverted; original iPhone background-capture defect unresolved.

## 1. Project and non-negotiable requirements

iMuse is a cross-platform progressive web app (PWA) whose Record function will eventually become the first tab of Memora. The recording system must be independent of Whisper/transcription. Its highest priorities are: (1) audio fidelity, (2) continuously preserving captured audio as IndexedDB chunks, (3) recovering recordings after browser/system interruption, and (4) robust finalization into a playable recording. Do not sacrifice recording stability to diagnostics, wake-word detection, voice responses, or other secondary features.

**Code workflow:** Before editing, request the user's *current* source files. Do not use a remembered or earlier version as the basis for a patch. Return only modified files in a ZIP, preserving their actual filenames (e.g. `recorder.js`, `audio-response-manager.js`) with no timestamp suffixes. Make small, controlled changes and remove temporary instrumentation once finished.

## 2. Two distinct problems: do not conflate

### A. Original iPhone background recording failure — still unresolved

In iMuse, when the user switches to another app on iPhone, the UI/MediaRecorder may remain in the **recording** state, yet actual audio capture/chunk production stops. This is **not** simply iMuse entering its Paused state. On returning to foreground, `MediaRecorder.state` can still say `recording`, and the audio track can report `live` and unmuted, without further chunks arriving.

A separate standalone `ForegroundRecoveryLab.html` successfully recorded while backgrounded (switching to Mail) on iPhone, both in Edge with a local file and Edge via GitHub Pages. Adding an iMuse-like Web Audio branch (`AudioContext → ScriptProcessorNode → gain=0 → destination`) to that lab did not reproduce the failure. The lab's AudioContext could become `interrupted` in the background while MediaRecorder continued recording. Therefore background capture is possible in the test environment; the cause appears specific to iMuse's full interaction of components or lifecycle.

The spoken “Recording interrupted” WAV warning was **added after the background failure had already been observed**. It cannot be the original cause, although it may deserve separate assessment.

### B. New recorder startup failures after diagnostic instrumentation — newly established

Two successive “audio flight recorder”/diagnostic code versions were introduced, involving `recorder.js` and `audio-response-manager.js`. The user reports:

- A recording **did succeed after the first flight-recorder change**, and a useful diagnostic JSON was exported.
- Later, a second diagnostic change was supplied; recording would not start.
- Reverting only the second change did **not** restore recording; the user had to revert **both flight-recorder versions** to restore functionality.
- **Latest decisive test:** after resolving browser caching, the user deliberately reloaded the **last** flight-recorder version into VS Code Live Server; it locked up. They then tested the **first** flight-recorder version in Live Server; it **also locked up**.
- The user has left the changed `audio-response-manager.js` in place, because it does not appear to cause the failure. They have reverted the flight-recorder changes to `recorder.js` to recover a working recorder.

**Interpretation:** Both instrumented `recorder.js` versions now reproduce a failure even on Live Server. This is stronger evidence of an instrumentation-related regression than the earlier GitHub Pages failures, but the exact mechanism is **not yet established**. Do not claim the cause is known. The fact that the first flight-recorder version once recorded successfully could indicate an intermittent failure, state dependency, or difference in test conditions. Determine exactly what “locked up” means and identify the first failing step/error before patching again.

## 3. Separate GitHub Pages/browser caching incident — apparently resolved

At one point, VS Code Live Server recorded correctly, but GitHub Pages failed to record on MacBook and iPhone even with `/?v=3`. On MacBook Chrome, recording **worked in Incognito**, and **worked with DevTools Network → Disable cache**. After refreshing, normal Chrome also worked. The user rebooted their iPhone and reinstalled the PWA; iPhone recording then worked again.

This strongly indicates a stale browser cache/deployment asset issue **in addition to** the instrumentation regression. Query strings on the top-level HTML (`/?v=3`) do not guarantee that imported JS modules are refreshed. **Do not clear Safari site data indiscriminately:** IndexedDB contains valuable recordings. Later, implement proper asset versioning/update strategy, separately from diagnosing recorder startup.

## 4. Concrete evidence from the background failure

Diagnostic session `b0ec0754-852a-43c5-9fc0-bb029be90131`, dated 2026-11-02 ~15:57:52 UTC:

- At **+6.947 s**, page became hidden; 6 chunks; MediaRecorder `recording`; mic track `live` and not muted.
- At **+6.96 s**, warning playback was accepted.
- Two further chunks appeared by roughly **+9 s**, then **no chunks for ~25 s**.
- At **+34.557 s**, page became visible; 8 chunks total; AudioContext `interrupted`; age of last chunk ~25.5 s.
- At **+35.56 s**, AudioContext `running`, analyser RMS **0.033745**, peak **0.121754** (nonzero signal); mic still `live` and unmuted; MediaRecorder still reported `recording`; **no new chunks**.
- At **+39.96 s**, mic track ended; MediaRecorder emitted unexpected stop (`UNEXPECTED-NO-STOP-REQUEST`).
- Session was incorrectly finalized as `completed` with 8 chunks and 205,654 bytes; user heard only ~6 seconds of recording.

**Implications:** `MediaRecorder.state`, `MediaStreamTrack.readyState`, and `muted` are insufficient indicators of actual ongoing audio capture. The nonzero analyser signal on return suggests the Web Audio branch could see mic input while the recorder remained stalled. The finalization state `completed` was misleading after an unexpected stop; this is a separate data-integrity/UX issue to address later.

## 5. Existing instrumentation already distinguishes received vs persisted chunks

In the previously inspected `recorder.js`:

- `current.sequence` increments synchronously in `recorder.ondataavailable`: **number of chunks received**.
- `current.metadata.chunkCount` updates only after `persistChunk()` successfully completes its IndexedDB transaction: **number of chunks committed**.
- `logCaptureSnapshot()` records `chunksReceived: current.sequence`.
- `logRecordingEvent()` includes `chunkCount: current.metadata?.chunkCount || 0` and `pendingBytes`.
- `current.pendingChunks.size` shows chunks still pending.

The **second diagnostic patch was redundant**: it added additional counters for callback receipts and IndexedDB commits even though existing fields already provided this distinction. Do not reintroduce those counters or another broad flight recorder without demonstrating a specific missing measurement. The added counters alone did not reveal an obvious static syntax error, but this does **not** exclude a runtime or state interaction.

## 6. Known implementation architecture (from earlier inspected source; re-verify against current files)

- `recorder.js` imports `playSpokenResponse`, `prepareSpokenResponses` from `audio-response-manager.js`, and microphone, settings, wake-word and command modules.
- IndexedDB database: `imuse-recording-breadboard`, version 2; object stores `sessions`, `chunks`, and `recordingEvents`.
- `createCompatibleRecorder(stream)` prefers `audio/mp4;codecs=mp4a.40.2` / M4A-AAC when supported; alternatives include WebM/Opus.
- Main `MediaRecorder` previously started with `recorder.start(250)`.
- `persistChunk(record, sequence, blob)` writes chunk and updated session metadata in a single IndexedDB transaction, then updates in-memory `record.metadata` after transaction completion.
- `setupSilenceMonitor()` creates an AudioContext, analyser, ScriptProcessor, and silent gain connected to destination; Web Audio is used for silence monitoring and wake-word samples.
- Silence detection can call `current.recorder.pause()`, but **the observed background failure does not show an actual pause**.
- `handleVisibilityChange()` logs transitions, requests wake lock on foreground, attempts to resume a suspended AudioContext, and plays an interruption-warning WAV when hidden.
- Foreground snapshots can log AudioContext state, recorder state, track state, last-chunk age, and analyser RMS/peak.
- `audio-response-manager.js` was also modified in the first diagnostic work; user has left that version in place because it appears compatible with the working recorder. **Do not revert it without a reason or a controlled comparison.**

## 7. Important file/version caveat

Earlier uploaded files included:

- `recorder(20261102-160810).js` — ~102,250 bytes; version **before** the second counter patch (but may already include the first flight recorder).
- `recorder(20261102-161251).js` — ~103,877 bytes; byte-for-byte identical to the second diagnostic patch.
- `recorder(20261102-161744).js` — later upload; do not assume it is the currently working version without confirmation.

The previous assistant compared the first two versions and found the second added counters and event fields. That comparison alone did not identify the startup regression. **The user has now reverted both flight-recorder changes.** The currently functioning local `recorder.js` is authoritative, but may not have been successfully uploaded to this conversation. Ask for it in the new conversation before any code changes.

The prior ZIP `iMuse_Chunk_Diagnostics.zip` contains the failed second patch and **must not be deployed**.

## 8. Recommended next investigation — minimal, controlled

1. **Preserve the now-working recorder** as a clean Git commit or tag. Confirm basic recording, stop, playback, and IndexedDB recovery without backgrounding.
2. **Do not immediately add logging.** Ask the user for the current known-working `recorder.js`, the first failing version, and (if available) the current `audio-response-manager.js`. If uploads remain unavailable, request Git commit hashes or GitHub file links in the new conversation.
3. **Diff working → first failing** and **first failing → second failing**. Pay particular attention to startup path, `prepareSpokenResponses()`, module imports/initialization, microphone acquisition, `AudioContext.resume()`, event logging, `recorder.start()`, and any promise awaited before start. Do not assume logging is passive simply because its intention was passive.
4. Characterize the “lockup” precisely: does the UI remain at idle, show “Preparing recording…”, disable Record, or show an error? In MacBook Live Server, inspect **DevTools Console** for the first exception or rejected promise. Use existing logs before changing code.
5. If needed, test one isolated instrumentation change at a time against the working baseline, with immediate start/stop smoke test. Avoid changing two modules simultaneously.
6. Only after startup reliability is restored, return to the **original iPhone background-chunk stall**, using the existing `chunksReceived` vs committed `chunkCount` and foreground snapshot data. Prefer comparing iMuse's behavior against the successful standalone lab and selectively disabling **one** iMuse subsystem at a time. Do not infer that silence auto-pause caused a failure when recorder state never became paused.
7. Independently plan safe cache-busting for GitHub Pages/PWA assets without deleting existing IndexedDB data.

## 9. What the next assistant must not do

- Do **not** conflate the GitHub Pages caching incident with the repeatable Live Server failure of instrumented `recorder.js`.
- Do **not** assert that the spoken warning caused the original background problem; it was added afterward.
- Do **not** assume `MediaRecorder.state === 'recording'` means audio is being captured.
- Do **not** introduce redundant chunk counters; received/committed counts are already available in the previously instrumented version.
- Do **not** clear browser website data or IndexedDB as a troubleshooting shortcut.
- Do **not** patch an old file. Request the current working file and provide changed files only in a ZIP with original filenames.

## 10. Suggested opening message in new conversation

> We are resuming the iMuse recording investigation. The attached handoff contains the tests and architecture. Current status: the baseline recorder works, both flight-recorder-instrumented `recorder.js` versions lock up even in Live Server, and the changed `audio-response-manager.js` remains installed. GitHub Pages caching was a separate issue, now apparently resolved. Please start by examining the difference between the working recorder and the first flight-recorder version; do not modify code until I supply the current files. The original iPhone background-capture stall remains unresolved.
