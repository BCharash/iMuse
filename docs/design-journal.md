# iMuse Design Journal

---

## DJ001 — iMuse: From Concept to Working Voice Notebook Foundation

**Date:** 13 September 2026  
**Status:** Historical milestone; retained for design history

### 1. Project origin

iMuse began with a simple idea:

> **Turn your thoughts into text.**

The original purpose was a personal voice notebook in which a person could speak freely without having to formulate or type ideas while they are occurring. The aim was to capture spoken thought first and make refinement possible later.

The initial workflow was:

**Speak → Capture → Transcribe → Preserve → Revisit → Edit → Share**

The fundamental product philosophy remains relevant: iMuse should preserve the user's own thoughts and allow technology to recede behind the act of thinking.

### 2. Initial product philosophy

The original design goals were simplicity, calmness, privacy, dependability, local operation, unobtrusiveness, and ease of repeated use.

The guiding principle was:

> **The technology should disappear behind the act of thinking.**

That principle remains current. The technical allocation of responsibilities has since changed: reliable audio capture and preservation are now the immediate core of iMuse, while transcription is provided by the unified application's Transcribe workflow.

### 3. Initial technical direction: browser-based application

iMuse was conceived as a lightweight Progressive Web App rather than a native application. The reasons included cross-platform access, simple deployment through GitHub Pages, local processing, privacy, and avoidance of recurring cloud transcription costs.

The project intentionally avoided a build system or server-side backend. This remains the preferred product direction: iMuse is to remain a cross-platform web app. The limitations of browser lifecycle and background microphone access, especially on iOS, must be handled honestly rather than assuming that a web app can keep running indefinitely.

### 4. Historical Whisper implementation

The original iMuse implementation used Transformers.js to run Whisper models locally in the browser. It offered Tiny, Base, and Small, with English and European Portuguese language selection. Audio was decoded and prepared as mono 16 kHz Float32 data for Whisper. Long-form processing was introduced for recordings longer than Whisper's ordinary processing window.

The original application was modularized into:

- `js/app.js` — application-level interactions and controls.
- `js/recorder.js` — microphone access, MediaRecorder, recording controls, readiness chime, and Blob creation.
- `js/audio.js` — decoding, channel handling, resampling, and Whisper audio preparation.
- `js/whisper.js` — interface to the Whisper worker.
- `js/whisper-worker.js` — model loading and transcription.

A Web Worker was introduced after long transcription caused Chrome's main thread to appear unresponsive. Testing showed that moving inference into a worker kept the interface responsive.

These are historical decisions, not a specification for the new capture-only iMuse. The separate Memora project subsequently developed mature transcription, model-management, file-processing, editing, combining, and search capabilities. The agreed migration plan is to make Memora's mature application the technical foundation of the unified iMuse. The new Record tab should not introduce a competing Whisper implementation.

### 5. Historical recording foundation

The initial recorder used the browser's MediaRecorder API. It requested microphone permission, captured audio, played a subtle two-note readiness chime when recording data became available, and made a Blob available for transcription.

At that stage, the recording existed in memory only. It was not durably stored, and there was no reliable recording library or crash-recovery mechanism.

This early implementation established that browser-based capture was practical, but it did not meet the later requirement that preservation and recovery be primary functions.

### 6. Historical user interface

The original visual design used a warm off-white background, muted typography, sage green for Record, muted blue for Transcribe, rounded controls, generous spacing, and minimal visual clutter.

The original title and taglines were:

**iMuse**

> Turn your thoughts into text

> Speak freely. iMuse listens.

The calm and unobtrusive visual philosophy remains useful. The final application will have four tabs, with Record first, followed by Transcribe, Edit and Combine, and Search. Memora's mature tab functionality and styling should be preserved except where integration requires a change.

### 7. Historical privacy and platform observations

The original transcription design processed audio locally in the browser. The future storage design was intended to remain local unless the user explicitly chose to share or export data.

iPhone testing revealed that Home Screen web-app microphone permissions and lifecycle behavior can differ from ordinary Safari behavior. These observations are historical evidence of platform-specific constraints, not a promise that microphone access or recording can persist through every lock-screen, background, or operating-system interruption.

The product remains a web app for cross-platform use. Its design must account for browser interruptions and recover persisted audio wherever possible. A web app cannot guarantee uninterrupted execution or microphone capture under every operating-system condition.

---

## DJ002 — Audio-first Record and the unified iMuse direction

**Date:** 27 October 2026  
**Status:** Current design direction

### 1. Product direction

The final product is one application, **iMuse**, maintained in the existing iMuse repository and published at:

<https://bcharash.github.io/iMuse/>

Memora is the technical foundation for the unified application because its transcription, model-management, file-handling, editing, combining, export, and search capabilities are substantially more developed. Memora will no longer be maintained as a separate production application after the unified iMuse is verified.

The intended tab order is:

1. **Record**
2. **Transcribe**
3. **Edit and Combine**
4. **Search**

The migration plan in `iMuse migration.md` records the repository-replacement strategy, deployment requirements, clean-start requirement, model-registry work, and acceptance expectations. This journal describes the design rationale; the migration plan remains the reference for the larger repository migration.

### 2. Record is an independent capture system

The Record tab's prime responsibility is to capture and preserve audio so that a session can be recovered after a browser or system interruption, to the extent browser storage and platform behavior permit.

Record must not depend on Whisper. It must work even when no transcription model has been loaded, when model initialization fails, or when transcription is never requested.

The responsibilities are:

- Capture microphone audio.
- Persist captured audio incrementally to IndexedDB.
- Preserve chunk ordering and segment boundaries.
- Manage session state and Pause/Resume.
- Identify and recover interrupted sessions.
- Finalize a session into one valid, playable audio file.
- Preserve source segments until the final file has been validated and safely persisted.
- Provide playback and clear Delete/reset behavior.
- Make the completed audio available to the unified application's Transcribe workflow.

Transcription is a downstream consumer of the recording, not part of the critical capture path.

### 3. One session, multiple segments, one final file

A user-facing recording is one logical session. Manual Pause, inactivity Pause, and subsequent Resume may cause the browser to create multiple recorder segments. Each segment and its chunks must retain their order and metadata.

A segment is not the same as a chunk. `MediaRecorder` may emit multiple `dataavailable` chunks during one recorder run; those chunks are not necessarily independent media files. Stopping and restarting the recorder may create separate media containers.

Simply concatenating independently recorded WebM/Opus or MP4/AAC containers into a new Blob is not a reliable media-assembly method. Finalization must use a tested, format-aware method or decode, join, and encode the audio appropriately. The choice must be made from evidence gathered on target browsers.

The completed deliverable must be one valid audio file containing all captured segments in the correct order. Original recoverable data must not be deleted until that file has been validated and persisted.

### 4. Crash recovery and honest durability

Audio preservation is a core function, not an enhancement to add later. Captured audio should be written incrementally to IndexedDB throughout the session.

The storage model should include a durable session identifier, session timestamps and state, ordered chunks and segments, MIME type and timing metadata where available, schema version, and explicit persistence/finalization status. The application must wait for IndexedDB transaction completion before claiming that a chunk is stored.

Recovery must identify sessions that were interrupted before finalization and provide a way to recover or finalize them. Write errors, quota limits, and failed transactions must be surfaced. Browser storage can be evicted, and an abrupt failure may occur before a write completes; the system should minimize the vulnerable interval without promising impossible guarantees.

### 5. Pause, inactivity, and hands-free use

Pause can be initiated manually or after a configured period of inactivity. The inactivity behavior must be conservative: a natural pause in thought should not accidentally cause loss of audio. The initial target discussed was approximately 5–10 seconds of silence, subject to real-world testing and user control.

While paused, iMuse should provide a quiet periodic beep to indicate the paused state. The interface should separately communicate whether audio is recording and whether captured data has been persisted; a beep is not proof of successful storage.

Resume should be available through a button. A spoken keyword is a desirable optional enhancement, not a core dependency. It may be investigated using a lightweight keyword detector or another browser-supported approach, but it must not introduce a competing Whisper pathway or compromise capture reliability.

The desired use includes putting an iPhone in a pocket and operating iMuse through a headset. This is an aspiration to test, not a capability to assume. Browser support for locked-screen/background recording, microphone continuity, and speech detection varies by platform. A cross-platform web app remains the product choice, with honest status reporting and recovery when the browser interrupts capture.

### 6. Optional real-time transcription

Real-time or parallel Whisper transcription is not part of the current Record scope. The mature transcription system already exists in Memora and will be retained in the unified application's Transcribe workflow.

If real-time transcription is reconsidered in the future, it must remain optional and must not block, interrupt, corrupt, or prevent recovery of audio capture. If resources compete, transcription yields first. No real-time feature should be introduced before capture, persistence, recovery, and final-file creation have been demonstrated to be dependable.

### 7. Architectural working principles

- Treat original captured audio as the primary artifact; transcripts are derived data.
- Keep recording/session management separate from transcription, editing, combining, and search.
- Do not duplicate Memora's mature capabilities without a demonstrated integration need.
- Preserve source audio until finalization is verified.
- Do not claim durability, browser compatibility, model behavior, or cleanup without evidence.
- Prefer small, testable changes and preserve known-working behavior until a replacement is verified.
- Test on real desktop and mobile browsers, especially desktop Chrome and iPhone Safari/PWA.
- Keep the application a cross-platform web app; design around platform limitations rather than assuming native-app guarantees.
- Obtain current versions of files before changing them. The latest user-supplied file is authoritative.
- When updating code, supply a ZIP containing changed files under their original filenames, without version suffixes.

### 8. Current priorities

The current engineering priorities are:

1. Verify and stabilize the existing single-segment capture baseline.
2. Restore reliable Delete/reset behavior and clear stale transcript/UI state when starting a new session.
3. Design and implement IndexedDB session/chunk persistence and recovery.
4. Define explicit session state transitions and implement manual Pause/Resume.
5. Add inactivity-based Pause conservatively, with periodic pause beeps.
6. Develop robust final-file assembly and validation.
7. Test interruption, recovery, and cross-browser behavior.
8. Investigate spoken keyword resume only after the capture foundation is stable.
9. Integrate the tested Record functionality into the Memora-based unified iMuse as part of the migration plan.

### 9. Guiding principle

The ultimate purpose of iMuse is not to demonstrate a speech-recognition model. It is to provide a quiet place for thought and to preserve what the user says.

> **Capture first. Preserve continuously. Transcribe when requested.**
