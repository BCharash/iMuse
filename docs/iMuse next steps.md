# iMuse next steps

**Planning note — 27 October 2026**  
**Status:** Current implementation plan; no code changes are authorized by this document alone.

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

## Current status — 27 October 2026

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
- [x] A standalone wake-word test lab has been created to evaluate detector scores and thresholds.

The user has tested recording/playback on iPhone. Systematic testing is still needed for inactivity-pause accuracy, false pauses, all save/finalization paths, and format output across target browsers. These tests do not establish recovery of audio that had not yet been committed to IndexedDB, survival of storage eviction, locked-screen/background recording on iOS, or every error path.

The tested `.webm` export is suitable for the current Memora import workflow. M4A/AAC is a format preference when the browser supports it, not a guarantee. Never rename WebM data to `.m4a`; an extension change is not a media conversion.

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

## 7. Implementation sequence

Keep each step small, testable, and independently reviewable. Do not make a large multi-file change before the baseline is confirmed.

### Phase 1 — Verify the existing baseline

- Confirm the current working tree and last commit in GitHub Desktop.
- Obtain the latest versions of every file to be changed.
- Test one uninterrupted recording: start, stop, playback, a second recording, and Delete.
- Confirm the second recording contains no audio or stale UI state from the first.
- Record actual browser/MIME behavior.
- Preserve a known-working checkpoint.

### Phase 2 — Restore Delete/reset and clean session start

Implement and test Delete/reset independently of Pause/Resume. Ensure late `MediaRecorder` events cannot recreate deleted state. Clear stale transcript UI left over from the prototype, if present.

### Phase 3 — Implement IndexedDB persistence and recovery

Define the session/chunk schema, write captured chunks incrementally, track transaction completion, handle errors, and recover interrupted sessions. Test forced reloads and browser termination after audio has been captured. Do not proceed based solely on a successful ordinary Stop.

### Phase 4 — Implement the explicit session state machine

Define transitions and control behavior. Keep the session, current recorder run, chunks, segments, and final output as distinct concepts. Implement manual Pause/Resume and repeated segments without merging containers by concatenation.

### Phase 5 — Finalize one valid audio file

Choose and test the assembly strategy on target browsers. Preserve source segments until the final output is validated and persisted. Provide retry/recovery after finalization errors.

### Phase 6 — Validate inactivity Pause and periodic beep

Automatic pause after approximately five seconds without detected speech and a periodic paused-state beep have been implemented. Validate them with natural speech, thinking pauses, quiet speech, background noise, and repeated resume cycles. Confirm the beep stops immediately on resume or session end.

### Phase 7 — Investigate headset button control (current priority)

The user has confirmed that a separate web device test which plays an audible tone responds to the **first** Shokz button press. Identify and inspect that exact test before running more diagnostics. The goal is to discover what mechanism produces the response and whether it can control iMuse recording.

Known observations:
- Desktop Chrome on the MacBook works after the user activates headset controls: pause while idle starts recording, pause/resume controls MediaRecorder, and nexttrack finalizes/saves.
- Edge on iPhone 12 Pro Max / iOS 26.7.2 registered Media Session handlers, but headset presses did not reach those handlers in three tests: handler registration alone; silent media (the valid MP3's audio element paused but no Media Session action was logged); and microphone-only capture with `audioSession.type = "play-and-record"` (no action logs).
- The generated WAV used in the first silent-audio test was rejected by Edge on iPhone (`NotSupportedError`, media error code 4); this was a media-format test failure, not a successful event-routing test.
- The user normally uses Safari for iPhone browsing and PWA use. Edge is used to run standalone HTML diagnostics because those files do not work in Safari in the user's workflow.
- The separate audible-tone web device test's first-press response is an unresolved lead. Its exact name/URL/source and underlying event mechanism still need to be obtained.

Steps:
1. Obtain the web device test URL/name or source and inspect its event handling.
2. Determine whether the first-press response comes from a direct JavaScript event, a media element/Media Session pathway, or another mechanism.
3. Build a minimal diagnostic for that specific mechanism only; do not repeat the already-failed generic variants without a new hypothesis.
4. If a plausible browser-only route is found, test it in the environment where the original behavior was observed, then in the user's actual iPhone Safari/PWA environment.
5. Because standalone HTML cannot be opened in Safari in the user's current workflow, host any Safari-specific diagnostic on an accessible HTTPS page (for example, a temporary GitHub Pages page). Do not change production iMuse code to perform the test.
6. Keep desktop Chrome as a known working comparison and record exact events, device/browser, and results.
7. Make a stop/go decision based on evidence. If no alternative route can be demonstrated, state that clearly and discuss realistic options rather than repeating the same tests.

Do not claim that the iPhone's operating system blocks every web-based headset interaction: the separate audible-tone test's first-press response has not yet been explained.

### Phase 8 — Train and evaluate custom wake-word models

The standalone HTML lab currently tests an available detector model; it does not yet recognize custom iMuse phrases unless a model trained for them is supplied. Candidate phrases are **“iMuse,” “Hey iMuse,” and “Ready iMuse?”** Train or obtain separate custom ONNX models and compare true detections, missed detections, and false activations during ordinary speech. Test varied voices, distances, and volumes. Keep keyword resume optional, local where practical, and entirely subordinate to reliable capture and persistence.

### Phase 9 — Handoff to the unified iMuse

Document the tested Record behavior, storage schema, final-file format, recovery model, browser limitations, and acceptance results. Reproduce the feature in Memora's architecture using that handoff. The repository migration and Memora model-registry overhaul remain separate ordered stages in `iMuse migration.md`.

## 8. Acceptance checklist

### Capture integrity
- [ ] One uninterrupted recording plays from beginning to end.
- [x] Multiple segments retain all audio in the correct order (tested with three spoken segments separated by two pauses).
- [ ] Distinct phrases at the beginning, middle, and end are audible.
- [ ] Replaying a session repeatedly gives the same complete result.
- [ ] A new session contains no previous-session audio.
- [ ] Actual MIME types and browser formats are recorded and tested.

### Persistence and recovery
- [ ] Audio is written incrementally while recording.
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
- [ ] Desktop Chrome is tested.
- [ ] iPhone Safari/PWA is tested.
- [ ] Android Chrome is tested where available.
- [ ] Lock-screen/background behavior is recorded as an observed result, not assumed.
- [ ] Headset microphone behavior is tested on actual target devices.
- [ ] Any unsupported background or keyword behavior degrades gracefully.

### Scope discipline
- [ ] No Whisper/model-loading/inference path is required by Record.
- [x] The downloaded WebM file was accepted by Memora's existing file-open/import workflow.
- [ ] Custom wake-word detection has no effect on the core preservation guarantee (custom phrase models and integration are not yet complete).

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

1. **Investigate the web device test that responds to the first Shokz button press.** Obtain its exact URL/name or source and inspect how it detects or responds to the press. This is the most important unresolved lead; do not repeat the same generic Media Session tests.
2. Based on that inspection, run one focused diagnostic of the actual mechanism. If a browser-only route appears viable, validate it in the user's real iPhone Safari/PWA environment using a hosted HTTPS diagnostic page—not a local standalone HTML file.
3. Keep desktop Chrome on the MacBook as the known working comparison. Edge on iPhone has so far failed to deliver actions to Media Session handlers in the tested configurations, but those results do not establish Safari behavior.
4. Preserve and commit the current stable recording checkpoint before making unrelated code changes.
5. Audit Delete/reset and a clean second recording; then validate finalization, saved-file integrity, MIME type/extension, playback, and Memora import.
6. Continue systematic testing of the 5-second inactivity pause and paused beep.
7. Continue wake-word testing separately: verify the loaded public model, compare thresholds 0.85, 0.90, and 0.95 with both ordinary speech and genuine wake phrases, and investigate a custom iMuse phrase model. Do not integrate wake-word detection until its reliability and effect on capture safety are established.

Do not repeat the already-passed multi-pause/reload recovery test unless a later code change could affect it. Keep remaining acceptance items unchecked until tested.

**Guiding principle: Capture first. Preserve continuously. Hands-free controls must be evidence-led and must never jeopardize captured audio.**
