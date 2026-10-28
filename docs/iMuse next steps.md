# iMuse next steps

**Planning note — updated 28 October 2026**  
**Status:** Remaining work and verification plan. This document does not authorize code changes by itself.

## 1. Purpose and scope

The final product is one cross-platform web application, **iMuse**, published at:

<https://bcharash.github.io/iMuse/>

The application will use Memora as its technical foundation. The final tab order is:

1. **Record**
2. **Transcribe**
3. **Edit and Combine**
4. **Search**

Memora already has mature transcription, model management, file handling, transcript editing and combining, export, and lexical/semantic search. Those capabilities should be retained in the unified application rather than recreated in the standalone iMuse recorder.

**The current iMuse development scope is audio capture only.** Remove Whisper and transcription from the design for this phase. Do not build or maintain a competing transcription/model architecture in iMuse. The completed recording must be usable by the unified application's existing Transcribe workflow.

## Current status — 28 October 2026

The following behaviors are implemented in the current iMuse recording prototype. The completed tests below are specific observations, not a claim of exhaustive cross-browser acceptance.

- [x] Incremental IndexedDB audio persistence is in place.
- [x] Reloading during a recording containing three spoken segments separated by two pauses allowed all three segments to be recovered and played in order.
- [x] Repeated Pause/Resume preserved the tested segments in order.
- [x] Completed recordings remained available after reload.
- [x] The exported `.webm` audio file was accepted by Memora's file-open/import workflow.
- [x] A save/download action is available for recordings.
- [x] Automatic pause after approximately 5 seconds without detected speech has been implemented.
- [x] A periodic beep indicates the paused state.
- [x] Browser-aware format selection prefers M4A/MP4 with AAC when supported and falls back to a browser-supported format.
- [x] A standalone wake-word test lab has been implemented using the Voicute browser detector, alongside the earlier Heed experiment.
- [x] Desktop Chrome headset controls work on the MacBook after activation: the headset pause button starts recording when idle, pause/resume controls the active recording, and next-track finalizes/saves.
- [x] The web-device-test URL and JavaScript have been identified and reviewed; this is no longer a task to obtain the source.
- [ ] iPhone headset routing remains unresolved. Edge on iPhone has not reliably delivered repeated button presses to the registered Media Session handlers; the separate audible-tone test's first-press response remains a lead to explain.

The user has tested recording/playback on iPhone, and a multi-segment recording was recovered and played after reload in the documented test. Remaining work is verification, not rebuilding the already implemented persistence, pause/resume, auto-pause, beep, save/export, format-selection, or wake-word test-lab features. Still needed: Delete/reset and clean-session checks; systematic inactivity-pause tests; full saved-file/finalization validation; format checks across target browsers; wake-word false-trigger/missed-trigger measurements; and iPhone Safari/PWA headset testing if a plausible route emerges. Existing tests do not prove survival of uncommitted audio, storage eviction, locked-screen/background recording on iOS, or every error path.

The tested `.webm` export is suitable for Memora's current import workflow. M4A/AAC is a preference when supported, not a guarantee. Never rename WebM data to `.m4a`; an extension change is not media conversion.

## 2. Core requirements

### 2.1 Audio preservation is a prime function

Record must capture and preserve audio continuously, with recovery after browser crashes or unexpected shutdowns as close to guaranteed as browser technology permits.

Requirements:

- Persist captured audio incrementally to IndexedDB while recording.
- Keep durable session metadata and ordered chunk/segment records.
- Track successful persistence separately from audio merely received in a `dataavailable` event.
- Surface transaction failures, storage quota problems, and microphone errors.
- Identify interrupted, unfinished sessions on the next launch and offer recovery/finalization.
- Request persistent browser storage where supported, while recognizing that it does not eliminate every risk.
- Never delete the only recoverable source data before the final audio file is validated and safely persisted.
- Be candid about limitations: browser storage can be evicted, and abrupt failures can occur before an asynchronous write completes.

Audio capture and preservation must not depend on Whisper, model downloads, inference, or a successful transcription.

### 2.2 One logical session must produce one final audio file

The current prototype has tested repeated `MediaRecorder.pause()` / `resume()` within the recording workflow, and the resulting saved recording preserved the tested spoken segments in order. Treat that as a tested result for this implementation, not as proof of uniform behavior across all target browsers.

If the implementation ever uses separate recorder runs or independently containerized files for one session, the final user-facing result must still be one valid, playable audio file containing all captured segments in the correct order. Do not assume that a `Blob` constructed from separate WebM/Opus or MP4/AAC recording Blobs is a valid merged media file. Media containers have headers, timing, and indexing structures; simple concatenation can produce missing audio, incorrect duration, or playback failures.

Investigate and test the available approaches if separate recorder runs are required:

- Format-aware media-container assembly.
- Decode segments to audio samples, join in order, and encode a valid output file.
- A different capture approach, if it demonstrably provides dependable pause/resume and finalization across target browsers.

Choose only after testing on desktop Chrome and iPhone Safari. Consider audio fidelity, validity, browser compatibility, memory use, processing time, and offline operation. Keep all source chunks and segments until the final output has been validated and persisted. If assembly fails, retain the source data and allow retry/recovery.

### 2.3 No competing transcription architecture

For this phase, iMuse Record must not load Whisper, initialize models, invoke Transformers.js, create a Whisper worker, or prepare audio specifically for Whisper.

The recording layer should provide a clear completed audio artifact and the metadata needed for later use. The unified application's existing Transcribe workflow will consume it.

Real-time or parallel transcription is a **nice-to-have**, not a core requirement. It is excluded from the present implementation. If reconsidered later, it must be optional and must never block, interrupt, corrupt, or prevent recovery of captured audio. When resources compete, capture wins.

## 3. Recording behavior

### 3.1 Session and segment terminology

Use these definitions consistently:

- **Session:** one user-facing recording, from Start through final Stop.
- **Segment:** one recorder run within a session. Pause ends a segment; Resume starts another.
- **Chunk:** a Blob emitted by a recorder run, often through periodic `dataavailable` events. A chunk is not necessarily an independently playable file.
- **Final audio file:** one validated audio file containing all segments in the session, in order.

Keep session state separate from the active `MediaRecorder`, the current segment's chunks, and the final audio file. Starting a new segment must not clear earlier segments. Starting a genuinely new session must create a fresh session identity and empty segment list.

### 3.2 Session actions and states

Define and implement an explicit state machine rather than relying on loosely related Boolean flags. Include states or equivalent explicit transitions for:

- Idle/ready
- Starting
- Recording
- Pausing
- Paused
- Resuming
- Finalizing
- Completed
- Interrupted/recoverable
- Error
- Deleting/abandoned, if needed to prevent late events from restoring deleted state

Required action meanings:

- **Start Recording** begins a new session.
- **Pause** ends the current segment but leaves the logical session open.
- **Resume Recording / Continue Recording** starts a new segment in the same session.
- **Stop/Finish** ends and finalizes the entire session, not merely the most recent segment.
- **Delete** abandons the session and clears its UI state, with appropriate deletion of persisted data after confirmation/defined behavior.

Specify which controls are enabled in each state. Handle microphone permission denial, device disconnection, failed recorder startup, failed persistence, finalization errors, and asynchronous events arriving after Pause, Stop, or Delete.

### 3.3 Manual Pause/Resume

Manual Pause/Resume is a core requirement.

Pause must close and retain the active segment without discarding it. Resume must start a new segment belonging to the same logical session. Repeated pauses and resumes must preserve all segments in order without loss or duplication.

The UI must distinguish recording, paused, finalizing, completed, interrupted, and error states. Do not confuse Pause with final Stop.

### 3.4 Inactivity-based Pause

iMuse should be able to pause automatically after a period of silence/inactivity. The initial discussion used approximately 5–10 seconds as a starting point, not an immutable value.

Implement this conservatively and test it with natural speech. The behavior must not discard earlier audio, and it must not treat every pause in thought as the end of a session. The session remains open and can be resumed.

The inactivity detector may use audio-level/voice-activity analysis; it does not require Whisper. Define how to avoid false pauses, how to handle noisy environments, and how the user can tell that automatic Pause occurred.

### 3.5 Periodic beep while paused

While the session is paused, provide a quiet periodic beep as an audible indication of paused state. Stop the periodic beep immediately when recording resumes or the session ends.

The beep is only a state cue. It must not be presented as evidence that the microphone is active or that data is being persisted. The interface should separately communicate capture and persistence status.

Choose a reasonable default interval and keep it configurable if that proves useful. Avoid a loud or frequent beep that interferes with thought or speech.

### 3.6 Hands-free and headset operation

The desired experience is to place the iPhone in a pocket and use a headset to interact with iMuse. A physical headset button would be useful if browser/OS event support allows it; spoken keyword resume is also desirable.

These are constrained by browser and operating-system behavior. A web app cannot force iOS to keep JavaScript and microphone capture active indefinitely when locked or backgrounded. Wake Lock can help prevent screen locking in supported contexts, but it is not a guarantee of background recording.

The product decision is to remain a cross-platform web app, not to switch to a native-only application. Therefore:

- Test actual iPhone Safari/PWA behavior early.
- Test desktop Chrome and Android Chrome as relevant.
- Do not promise uninterrupted locked-screen capture without successful real-device tests.
- Preserve everything already persisted and recover interrupted sessions when the browser stops or suspends capture.
- Report capture interruption honestly rather than continuing to imply that recording is active.

### 3.7 Spoken resume keyword: optional research

Investigate whether a spoken keyword can resume recording without Whisper. Candidate approaches include browser speech recognition or a small, local keyword-spotting detector.

Prefer a detector that analyzes the existing microphone stream instead of requesting a second microphone stream, if technically viable. A Web Audio `AudioWorklet` can process audio blocks but is not itself a speech recognizer; keyword recognition still requires a recognition service or suitable detector.

Do not assume that speech recognition and MediaRecorder can coexist reliably on every iPhone Safari version. Browser implementations may behave differently, and speech recognition may use remote services. A candidate approach must be tested for microphone conflicts, interruption behavior, false activations, privacy, CPU/battery cost, and background behavior.

Voice resume must remain optional. Manual Continue Recording must always be available whenever the browser is able to run the app. Do not introduce a keyword detector until the capture, persistence, recovery, and finalization foundation is dependable.

## 4. Persistence and recovery design

### 4.1 IndexedDB model

Design a durable schema with, at minimum:

**Session record**
- Unique session ID.
- Creation and last-update timestamps.
- Explicit lifecycle state.
- Ordered segment references.
- Persistence and finalization status.
- Schema/version information.
- Relevant capture format and metadata.

**Chunk/segment records**
- Session ID and segment ID.
- Sequence number and chunk order.
- Audio Blob/data.
- MIME type.
- Timing/duration metadata where available.
- Persistence/write status.
- Enough metadata to reconstruct the intended sequence.

Avoid relying on in-memory arrays as the only copy of completed segments. The session metadata and audio records must be written so recovery can identify which data belongs to which session and in what order.

### 4.2 Transaction and storage behavior

- Persist chunks as they arrive.
- Wait for the relevant IndexedDB transaction to complete before marking data durable.
- Handle quota errors and transaction failures explicitly.
- Minimize the interval between capture and persistence.
- Request persistent storage when supported, but do not treat that request as an absolute guarantee.
- Avoid deleting the only recoverable data while a write or finalization operation is pending.
- Keep storage operations independent from UI rendering and any optional audio analysis.

### 4.3 Recovery

On startup, find sessions that were recording, paused, or finalizing when the previous application instance ended. Mark them interrupted/recoverable as appropriate and offer a clear recovery path.

Recovery should be able to reconstruct the ordered segments from persisted records and either retry finalization or retain the session as recoverable if a final file cannot yet be produced.

Distinguish:
- Audio known to have been persisted.
- Audio received but whose write did not complete.
- Final file successfully validated and persisted.
- Session whose finalization failed.

Do not claim that every last sample can survive every crash. The objective is to make the vulnerable interval as small as practical and recover all successfully persisted audio.

## 5. Final audio-file assembly

The final output must be one valid audio file that Memora's existing Transcribe workflow can consume.

Before selecting an assembly strategy:

1. Record and preserve known test phrases at the beginning and end of each segment.
2. Inspect the actual MIME types and media formats produced by desktop Chrome and iPhone Safari.
3. Compare format-aware assembly with decode/join/encode.
4. Verify ordering, audible continuity, duration, playback, and compatibility.
5. Check memory use for long recordings and repeated pauses/resumes.
6. Confirm behavior when finalization is interrupted or fails.
7. Ensure source chunks remain recoverable until the final file is validated and persisted.

A browser's displayed duration or the fact that a Blob exists is not proof that the file is valid. Repeated playback and distinct phrases across every segment should demonstrate that no audio is missing or duplicated.

The exact final file format and implementation remain to be established by testing; do not assume a solution based only on code inspection.

## 6. Delete/reset and single-segment baseline

Before implementing the new Pause/Resume architecture, restore and test the basic one-segment workflow.

Delete/reset must:
- Stop active capture safely, if possible.
- Prevent late asynchronous recorder events from restoring deleted UI or data.
- Stop and release microphone tracks when appropriate.
- Clear current in-memory session/segment/chunk state.
- Pause/unload the audio player.
- Revoke any object URL.
- Clear transcript-related UI inherited from the old prototype, if that UI remains.
- Restore controls and status to a clean ready state.
- Apply a clear and consistent policy to persisted data for a deleted session.

Starting a new session must not display or reuse audio from the previous session. Since transcription is out of scope for this phase, remove obsolete Whisper-specific controls and code as part of a deliberate, reviewed change rather than leaving misleading buttons or unused code behind.

## 7. Remaining work — in priority order

The core prototype features listed above are already implemented. Do not repeat implementation work or the successful multi-pause/reload test without a specific reason. Focus on the following unresolved items.

### Priority 1 — Explain and test iPhone headset-button routing

The headset-control implementation works in desktop Chrome on the MacBook after activation. Preserve that path as the known-working comparison; do not destabilize it while investigating iPhone behavior.

The reference web device test has already been identified and its JavaScript supplied and reviewed:
<https://webdevicetest.com/en/tools/media-session-key-test?utm_source=chatgpt.com>

Known observations:
- The separate audible-tone test responds to the first Shokz button press.
- Edge on iPhone 12 Pro Max / iOS 26.7.2 registered Media Session handlers, but repeated presses did not reliably reach those handlers in the tested variants.
- The tested variants included handler registration alone, valid silent MP3 playback, microphone-only capture, and microphone capture with `audioSession.type = "play-and-record"`.
- An earlier generated silent WAV was rejected as unsupported; that was a failed media test, not evidence about event routing.
- These Edge results do not establish what Safari will do.

Next diagnostic:
1. In the standalone diagnostic only, keep `navigator.mediaSession.playbackState` synchronized with the media element: set it to `"playing"` only after `audio.play()` resolves; set it to `"paused"` in the pause handler; and set it back to `"playing"` after a successful resume.
2. Log the action and resulting element/playback states. Keep handlers and the session alive through at least three consecutive button presses; do not tear down or recreate the session on ordinary pause.
3. If repeated actions work in Edge, serve the diagnostic over HTTPS and test in the user's actual iPhone Safari/PWA environment. Do not ask the user to open a local HTML file in Safari.
4. If this test fails, compare the reference page's lifecycle and state handling against the diagnostic before proposing a materially different experiment. Do not repeat generic variants already tested.
5. Do not change production iMuse code until a route is demonstrated. If no route can be demonstrated, record that conclusion and discuss realistic alternatives.

The playback-state mismatch is a hypothesis worth testing, not an established explanation.

### Priority 2 — Verify recording integrity and recovery edge cases

The following are implemented and have passed specific tests: incremental IndexedDB persistence, recovery/playback of three spoken segments after reload, repeated Pause/Resume, save/download, and WebM import into Memora. The remaining tests are:

- Audit Delete/reset and then record a clean second session. Confirm late asynchronous events cannot restore deleted state, and that old audio, playback, metadata, and UI do not leak into the new session.
- Verify the final saved file from beginning to end, including distinct phrases across segments, ordering, repeat playback, actual MIME type and matching extension, and Memora import.
- Exercise finalization failure and recovery. Confirm source data remains available until the final output is validated and persisted.
- Check that persistence errors and quota failures are surfaced and that data is only described as durable after the IndexedDB transaction completes.
- Avoid repeating the already-passed multi-segment reload scenario unless a code change affects that path.

### Priority 3 — Validate inactivity pause and paused beep

Automatic pause after approximately five seconds without detected speech and the periodic paused-state beep are implemented. Test with natural thinking pauses, quiet speech, typical background noise, and repeated resume cycles. Confirm the beep only occurs while paused and stops immediately on resume or session end. Tune behavior only in response to observed failures.

### Priority 4 — Evaluate the implemented wake-word test lab

The standalone Heed and Voicute experiments exist; the Voicute page implements the auto-pause/beep/listen/resume loop using a public demo model. Do not treat the public demo phrase as the final iMuse wake phrase, and do not describe the detector as integrated into production iMuse.

- Confirm the exact model and phrase displayed by the test page for each run.
- Compare thresholds 0.85, 0.90, and 0.95 using both ordinary-speech trials and genuine wake-phrase attempts, recording false activations and missed detections.
- Keep model, microphone, environment, and filters unchanged while comparing thresholds.
- Decide later whether to train or obtain a custom iMuse phrase model. The final phrase has not been selected; “Go iMuse” appears in the Voicute notes, while the design journal also lists “iMuse,” “Hey iMuse,” and “Ready iMuse?” as candidates.
- Do not integrate wake-word detection until accuracy, device behavior, and its effect on audio preservation have been evaluated.

### Priority 5 — Document the handoff before integration

When the recording prototype's remaining acceptance tests are complete, document its verified behavior, storage/recovery model, final audio format, browser limitations, and test results. The later unified iMuse integration, repository migration, and Memora model-registry overhaul remain separate stages.

## 8. Acceptance checklist

### Capture integrity
- [ ] One uninterrupted recording plays from beginning to end.
- [x] Multiple segments retain all audio in the correct order (tested with three spoken segments separated by two pauses).
- [ ] Distinct phrases at the beginning, middle, and end are audible.
- [ ] Replaying a session repeatedly gives the same complete result.
- [ ] A new session contains no previous-session audio.
- [ ] Actual MIME types and browser formats are recorded and tested.

### Persistence and recovery
- [x] Audio is written incrementally while recording.
- [ ] A chunk is marked persisted only after transaction completion.
- [ ] Storage errors and quota problems are surfaced.
- [x] Reloading during a recording allowed recovery of the audio already persisted to IndexedDB (one tested scenario; not every crash mode).
- [x] Interrupted sessions are identified on the next launch in the tested reload scenario.
- [ ] Recovery can retry finalization without discarding source segments.
- [ ] The app does not claim that unpersisted data is safe.

### Pause/resume and inactivity
- [x] Pause preserved audio in the tested repeated Pause/Resume scenario.
- [x] Resume continued the same logical recording in the tested repeated Pause/Resume scenario.
- [x] Repeated pauses/resumes preserved the tested segments in order.
- [ ] Final Stop finalizes the whole session.
- [x] Inactivity Pause after approximately 5 seconds without detected speech is implemented; conservative behavior still requires systematic validation.
- [x] A periodic beep is implemented for the paused state; verify it occurs only while paused and stops on resume/end.
- [ ] UI status accurately represents recording, pause, persistence, and errors.

### Finalization
- [ ] The completed output is one valid, playable audio file, with the full recording verified from beginning to end.
- [ ] All source segments are represented in the output, in order.
- [ ] Duration and playback are verified, not merely inferred from Blob existence.
- [ ] The output is safely persisted before source data is eligible for cleanup.
- [ ] Failed finalization leaves the source audio recoverable.

### Delete/reset
- [ ] Delete stops capture safely and prevents late events from restoring content.
- [ ] The player is cleared and any object URL revoked.
- [ ] Session state and UI return to a clean ready state.
- [ ] The persisted-data deletion policy is consistent and tested.

### Cross-platform behavior
- [x] Desktop Chrome headset controls have been tested successfully; broader recording acceptance remains open.
- [ ] iPhone Safari/PWA is tested.
- [ ] Android Chrome is tested where available.
- [ ] Lock-screen/background behavior is recorded as an observed result, not assumed.
- [ ] Headset microphone behavior is tested on actual target devices.
- [ ] Any unsupported background or keyword behavior degrades gracefully.

### Headset controls and wake-word research
- [x] Desktop Chrome headset controls work after activation: start while idle, pause/resume during recording, and next-track finalize/save.
- [ ] A repeated iPhone headset-button action reliably reaches the page's handlers.
- [ ] A candidate headset route is tested in the user's actual iPhone Safari/PWA environment.
- [x] Standalone Voicute wake-word test lab and the earlier Heed experiment exist.
- [ ] Threshold trials record false activations and genuine detections.
- [ ] A custom iMuse phrase model is selected, trained/obtained, and evaluated; no final phrase/model is currently validated.
- [ ] Wake-word detection is shown not to compromise the core preservation guarantee before any production integration.

### Scope discipline
- [ ] Confirm that Record has no required Whisper/model-loading/inference path in the current code.
- [x] The downloaded WebM file was accepted by Memora's existing file-open/import workflow.

## 9. Working method

- Audit before editing.
- Obtain the current version of each file that will change; do not rely on an earlier ZIP or conversation copy.
- Use the latest user-supplied file as authoritative.
- Make one focused change at a time and test it before proceeding.
- For a one-line edit, provide the exact location and surrounding code. For multiple changes in one file, provide a complete replacement. When code files are updated, provide a ZIP with the original filenames and no appended version numbers.
- Keep the source filenames intact inside ZIP archives.
- Remove temporary diagnostic UI/logging when no longer needed.
- Commit at stable checkpoints.
- Distinguish real-device testing from code inspection, simulation, or hypothesis.
- Do not claim a feature is verified unless the relevant test was run.
- Keep the Record work, model-registry overhaul, and final repository replacement as distinct stages.
- This plan does not authorize code changes by itself; confirm the current repository and immediate next action before implementation.

## 10. Immediate next action

1. Run the focused standalone playback-state synchronization experiment described under Priority 1. The reference URL and JavaScript are already known; do not spend time obtaining them again.
2. Test at least three consecutive Shokz button presses while keeping the media session and handlers alive. Record each action, `audio.paused`, and `navigator.mediaSession.playbackState`.
3. If repeated actions work in Edge, host the isolated diagnostic over HTTPS and test actual iPhone Safari/PWA behavior. If they do not, inspect lifecycle differences from the reference before choosing another hypothesis.
4. Keep production iMuse unchanged until the iPhone route is demonstrated.
5. In parallel, the next recording-validation work is Delete/reset plus a clean second session, followed by full-file integrity/finalization checks and systematic inactivity-pause/beep tests.
6. Continue wake-word threshold evaluation separately; the standalone test lab is implemented, but the custom phrase, reliability measurements, and production integration are not complete.

**Guiding principle: Capture first. Preserve continuously. Hands-free controls must be evidence-led and must never jeopardize captured audio.**
