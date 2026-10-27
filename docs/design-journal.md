# iMuse Design Journal

---

# DJ001 — iMuse: From Concept to Working Voice Notebook Foundation

**Date:** 13 September 2026

**Status:** Accepted

---

## 1. Project Origin

iMuse began with a simple idea:

> **Turn your thoughts into text.**

The purpose is to create a personal voice notebook in which a person can speak freely, without having to formulate or type ideas while they are occurring.

The initial motivation is the recognition that spoken thought can be easier and more natural than written thought, particularly during the early stages of developing ideas for longer-form writing.

Rather than trying to produce polished prose while speaking, iMuse is intended to capture the user's thoughts first and make refinement possible later.

The fundamental workflow is therefore:

**Speak → Capture → Transcribe → Preserve → Revisit → Edit → Share**

The application is deliberately separate from larger AI-assistant projects. Its primary purpose is not conversation with an AI, but **faithful capture of the user's own thoughts**.

---

## 2. Product Philosophy

iMuse should be:

- Simple
- Calm
- Private
- Dependable
- Local
- Unobtrusive
- Easy to use repeatedly

The application should not introduce complexity merely because a technology makes something possible.

Features should be added when they solve a real problem demonstrated through actual use.

The central design principle is:

> **The technology should disappear behind the act of thinking.**

The user should be able to open iMuse, speak naturally, and trust that the recording and resulting words will be preserved.

---

## 3. Initial Technical Direction

The initial implementation was conceived as a browser-based application rather than a native application.

The reasons include:

- No installation required
- Easy access from desktop and mobile
- Ability to deploy through GitHub Pages
- Ability to operate entirely on the user's device
- Avoidance of recurring cloud transcription costs
- Greater privacy because recordings do not need to leave the device

The application is therefore being developed as a lightweight Progressive Web App.

The project does not require Node.js, npm, or a server backend at this stage.

---

## 4. Whisper as the Transcription Engine

Whisper was selected as the speech-to-text engine.

The application uses Transformers.js to run Whisper models locally in the browser.

The current model choices are:

| Model | Intended role |
|---|---|
| Tiny | Fastest |
| Base | Recommended |
| Small | Higher accuracy |

The application deliberately exposes the model choice rather than hiding it.

This allows real-world testing to determine the appropriate balance between:

- Accuracy
- Processing speed
- Memory use
- Device compatibility
- User experience

Early testing showed that Base provided very good accuracy while being substantially more practical than larger models.

Small also produced excellent results, but required considerably more computational effort.

Medium was investigated but ultimately abandoned for the current architecture because of its size and loading cost. The intended application must eventually work well on mobile hardware, including older iPhones, so a model that is impractical to load is not useful simply because it may offer higher theoretical accuracy.

---

## 5. Language Support

Two languages were added during the initial development:

- English
- Portuguese (Portugal)

The Portuguese option specifically represents European Portuguese rather than Brazilian Portuguese.

Whisper is instructed to perform transcription rather than translation.

Language selection is independent of model selection.

The language selector is presented in the same visual style as the model selector.

---

## 6. Initial Recording Architecture

The browser's MediaRecorder API is used to capture microphone audio.

The recording flow is intentionally simple:

1. User presses **Start Recording**.
2. iMuse requests microphone access.
3. Recording begins.
4. A short two-note chime indicates that recording is ready.
5. User speaks freely.
6. User presses **Stop Recording**.
7. The recording becomes available for transcription.
8. The **Transcribe** button becomes active.

The microphone stream is stopped when recording ends.

The original recording is retained in memory as an audio Blob.

At this stage, recordings are not yet permanently stored.

---

## 7. Recording Readiness Chime

A short two-note chime was introduced after testing showed that the user needed an unambiguous indication that the microphone was actually ready.

The chime occurs when the first recording data becomes available.

The status message changes to:

> **Ready — speak now.**

This provides a clear transition between:

**Preparing microphone**

and

**Actually recording.**

The chime is deliberately subtle so that it does not interfere with the user's speech.

---

## 8. Audio Preparation

Browser recordings are not necessarily captured at the sample rate expected by Whisper.

The recorded audio is therefore decoded and converted to:

- Mono
- 16 kHz
- Float32 audio data

This conversion is handled by:

js/audio.js

The resulting audio is suitable for Whisper processing.

Testing showed that this conversion was important. Without proper audio preparation, short recordings could produce incorrect results such as Whisper interpreting speech as [Music].

---

## 9. Modularization

As functionality accumulated, the original single-file implementation was divided into separate responsibilities.

The current JavaScript structure is:

js/
├── app.js
├── audio.js
├── recorder.js
├── whisper.js
└── whisper-worker.js

### app.js

Handles application-level interactions such as:

- Transcribe button
- Model selection
- Resetting the current recording/transcript when the model changes

### recorder.js

Handles:

- Microphone access
- MediaRecorder
- Start/stop recording
- Recording-ready chime
- Creation of the audio Blob

### audio.js

Handles:

- Audio decoding
- Channel selection
- Resampling
- Preparation of audio for Whisper

### whisper.js

Acts as the interface between the main application and the Whisper Worker.

It handles:

- Model selection
- Language selection
- Worker creation
- Sending audio to the Worker
- Receiving the transcript
- Updating the interface

### whisper-worker.js

Handles the computationally intensive Whisper operations.

This separation was introduced incrementally rather than through a large framework or build system.

---

## 10. Long-Form Transcription

Initial Whisper testing revealed that recordings longer than approximately 30 seconds required special handling.

Whisper's normal processing window is approximately 30 seconds.

Longer recordings can otherwise produce:

- Missing words
- Repeated words
- Poor transitions between sections
- Boundary artifacts

The transcription pipeline was therefore changed to use long-form processing with:

chunk_length_s: 30
stride_length_s: 5

The 5-second overlap provides contextual continuity between adjacent chunks.

Testing with longer recordings showed that this approach successfully avoided the major repetition and omission problems encountered during earlier testing.

---

## 11. Initial Long-Form Testing

Base was tested with a relatively long natural spoken passage.

The result was generally strong:

- No significant repetitions
- No major missing sections
- Coherent transcription
- Reasonable punctuation
- Meaning largely preserved

Small was subsequently tested with another natural spoken passage.

Small produced excellent transcription quality, although there were some additional recognition errors in one test conducted at a more spontaneous speaking pace.

This reinforced the importance of testing transcription under natural conditions rather than judging models solely from short, carefully articulated passages.

---

## 12. Browser Responsiveness Problem

A significant problem appeared when testing the Small model.

During a long transcription, Chrome displayed a:

> **Page Unresponsive**

warning.

The transcription eventually completed successfully when the user chose **Wait**, but the behavior was unacceptable for the intended application.

A voice notebook should not appear to have frozen simply because it is processing a recording.

The problem demonstrated that Whisper inference was consuming too much of the browser's main execution thread.

---

## 13. Web Worker Decision

The solution was to move Whisper processing into a Web Worker.

The resulting architecture is:

                     iMuse
                       │
              ┌────────┴────────┐
              │                 │
        Main Application    Web Worker
              │                 │
        User interface        Whisper
        Recording             Model loading
        Controls              Transcription
        Audio preparation
              │                 │
              └──── messages ───┘
                       │
                       ▼
                  Transcript

The main browser thread remains responsible for the interface.

The Worker performs the computationally intensive Whisper operations.

---

## 14. Worker Implementation

The Worker receives messages from the main application.

For model loading:

load → model name

For transcription:

transcribe → audio data + language

The Worker returns messages for:

- Status
- Ready
- Transcription
- Error

The Worker retains the loaded Whisper model so that subsequent recordings can be processed without reloading the model.

---

## 15. Web Worker Result

The Worker architecture was tested with the Small model using a relatively long natural recording.

The result was significant:

**Before Worker:**

- Chrome displayed a Page Unresponsive warning.

**After Worker:**

- No Page Unresponsive warning occurred.
- Whisper continued processing successfully.
- The browser interface remained responsive.
- The transcription completed normally.

This validated the decision to move Whisper inference off the main thread.

The Worker architecture is therefore considered an accepted part of the iMuse design.

---

## 16. Transcription Activity Indicator

A numerical progress indicator was investigated.

The available Transformers.js progress callback did not provide sufficiently reliable progress information for the actual Whisper transcription operation.

Rather than display a potentially misleading percentage, iMuse uses an activity indicator.

During transcription, the status displays:

> **Transcribing…**

with a small rotating circle.

The indicator communicates that processing is active without pretending that iMuse knows the exact percentage completed.

When transcription finishes, the indicator disappears and the status changes to:

> **Transcription complete.**

This is considered preferable to displaying inaccurate progress.

---

## 17. User Interface

The visual design is intentionally calm.

The current design uses:

- Warm off-white background
- Muted typography
- Sage green as the primary accent
- Complementary muted blue for Transcribe
- Rounded controls
- Generous spacing
- Minimal visual clutter

The application title is:

**iMuse**

The primary tagline is:

> **Turn your thoughts into text**

The secondary line is:

> **Speak freely. iMuse listens.**

The tagline uses a decorative script font while the remainder of the interface uses a clean sans-serif font.

---

## 18. Record and Transcribe Controls

The two primary actions have deliberately different visual identities.

### Record

Uses the primary muted sage color.

It represents:

**Capture**

### Transcribe

Uses a complementary muted blue.

It represents:

**Process**

The Transcribe button is disabled until a recording has been completed.

When disabled, it is neutral gray.

When active, it becomes the muted blue.

This makes the button's state immediately apparent without requiring explanatory text.

---

## 19. Current Project Structure

The current application structure is:

iMuse/
├── index.html
├── manifest.json
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── audio.js
│   ├── recorder.js
│   ├── whisper.js
│   └── whisper-worker.js
├── icons/
│   ├── apple-touch-icon.png
│   ├── favicon-32.png
│   ├── favicon-32-v2.png
│   ├── favicon-16.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── iMuse2.png
├── favicon.ico
└── docs/

The project deliberately has no dependency on:

- Node.js
- npm
- package.json
- package-lock.json
- node_modules
- A server-side transcription service

Transformers.js is loaded from its CDN.

---

## 20. Privacy

Privacy is a central design consideration.

The intended transcription architecture is local:

**Microphone → Browser → Whisper → Transcript**

The audio does not need to be uploaded to an external transcription service.

This avoids:

- Cloud transcription charges
- Dependence on an external API
- Unnecessary transmission of private spoken thoughts
- API key management

The eventual storage system is also intended to remain local to the user's device unless the user explicitly chooses to share or export something.

---

## 21. iPhone and Safari Testing

iMuse was tested on iPhone.

Safari's microphone permission behavior revealed an important platform limitation.

When the iMuse website is used directly in Safari, a site-specific microphone permission can be granted and retained.

However, when iMuse is saved to the iPhone Home Screen and used as a standalone web app, the microphone permission currently has to be granted again when the web app is reopened.

Deleting and reinstalling the Home Screen web app did not change this behavior.

This appears to be an iOS/WebKit limitation involving persistent getUserMedia permissions for Home Screen web apps rather than a problem with iMuse's recording implementation.

No application-level workaround will be pursued unless the platform behavior changes.

For now, the preferred privacy-preserving configuration is:

**Safari microphone default: Ask**

and:

**iMuse website microphone permission: Allow**

This permits iMuse to use the microphone without granting microphone access universally to other websites.

---

## 22. Current Limitations

At this stage, iMuse is still a transcription tool rather than a complete voice notebook.

Recordings currently exist only for the current session.

There is no permanent local storage yet.

There is currently no:

- Recording library
- Search
- Playback history
- Persistent transcript storage
- Transcript export
- Audio export
- Sharing system
- Note organization
- Automatic silence detection
- Continuous transcription during recording

These are future features.

---

## 23. Design Direction for Storage

The next major architectural feature will be persistent local storage.

IndexedDB is the preferred technology because browser localStorage is inappropriate for potentially large audio recordings.

The conceptual iMuse note should contain:

Note
├── id
├── created
├── duration
├── language
├── model
├── transcript
└── audio

Audio and transcript should be independently manageable.

Creating a transcript should **not** automatically delete the original recording.

The user should eventually be able to verify the transcript before deciding whether to retain or delete the audio.

The underlying principle is:

> **Never destroy the original thought merely because a transcription has been created.**

---

## 24. Future Sharing and Export

Sharing and exporting are considered separate concepts.

Future functionality should allow the user to work with:

### Transcript

Possible formats:

- Plain text
- Markdown
- Other appropriate text formats

### Audio

The original recorded audio should remain available for:

- Playback
- Sharing
- Export

### Combined

The application may eventually allow the user to export both:

- Original audio
- Transcript

as a combined package.

The exact implementation will be determined after the storage architecture is established.

---

## 25. Future Recording Behavior

Several future recording improvements have been identified.

### Extended silence detection

iMuse should eventually recognize prolonged silence and temporarily pause recording or otherwise intelligently manage the recording session.

The tentative concept is approximately 5–10 seconds of extended silence.

This should be implemented conservatively so that normal pauses in thought are not mistaken for the end of a recording.

### Continuous transcription

The eventual ideal workflow is:

Speak
  ↓
Capture
  ↓
Transcribe during recording
  ↓
Continue speaking
  ↓
Pause intelligently
  ↓
Continue
  ↓
Save complete note

If true continuous transcription proves too computationally expensive, iMuse may instead transcribe during natural pauses or immediately after recording segments.

The user should not be required to manually manage technical chunks.

---

## 26. Model Strategy

The current model strategy is intentionally conservative.

The application currently offers:

- Tiny
- Base
- Small

The working assumption is:

**Base = default recommendation**

because it provides an excellent balance between accuracy and computational cost.

**Small = higher-accuracy option**

for users who are willing to wait longer and use more device resources.

**Tiny = speed option**

for situations where rapid processing is more important than maximum accuracy.

This remains an empirical decision and may change after broader testing on:

- Natural speech
- Rapid speech
- Long recordings
- English
- European Portuguese
- Desktop hardware
- iPhone hardware

---

## 27. Architectural Principle

The project has deliberately evolved through small, testable changes.

Each significant architectural change should answer a demonstrated problem.

Examples:

- Audio conversion was added after raw browser audio produced poor Whisper results.
- Long-form processing was added after recordings exceeded Whisper's normal processing window.
- The Web Worker was added after Chrome demonstrated that the main thread was becoming unresponsive.
- The activity spinner was chosen after reliable transcription percentage reporting proved unavailable.

This incremental approach is intentional.

> **Test first. Add complexity only when the evidence requires it.**

---

## 28. Current Milestone

As of 13 September 2026, the following foundation is considered working:

- Browser-based iMuse application
- Responsive visual interface
- English transcription
- European Portuguese transcription
- Tiny model
- Base model
- Small model
- Model selection
- Language selection
- Microphone recording
- Recording-ready chime
- Audio decoding and 16-kHz preparation
- Long-form transcription
- Whisper Web Worker
- Responsive browser interface during transcription
- Animated transcription activity indicator
- Distinct Record and Transcribe controls
- Local browser-based transcription architecture

The application has therefore progressed from a basic Whisper demonstration into a functioning foundation for the intended voice notebook.

---

## 29. Next Development Phase

The next major phase is:

# Persistent Local Notes

The immediate objective is to create a reliable IndexedDB-based storage layer.

The first version should establish the ability to:

1. Save a completed recording.
2. Save its transcript.
3. Associate the recording and transcript with metadata.
4. Retrieve saved notes after the page is reloaded.
5. Preserve the original audio.
6. Display stored notes.

Only after this foundation works should we add:

- Search
- Playback
- Delete
- Export
- Share
- Additional organization

The development process should continue to use small, independently testable changes.

---

## 30. Guiding Principle

The ultimate purpose of iMuse is not to demonstrate Whisper.

It is to create a **quiet place for thought**.

The user should be able to speak without worrying about formatting, typing, organizing, or polishing.

iMuse's job is to preserve the thought faithfully.

Everything else comes afterward.

> **Speak freely. iMuse listens.**


---

# DJ002 — Recording Persistence, Recovery, Pause/Resume, and Audio Export

**Date:** 27 October 2026  
**Status:** Prototype milestone — tested behaviors recorded below

## 31. Scope reset: Record is independent of transcription

The current iMuse prototype is now being used as a focused recording breadboard. Whisper and transcription are out of scope for this phase. The Record function must not depend on model downloads, model initialization, inference, or successful transcription.

The longer-term product is one unified iMuse application, using Memora as its technical foundation. Its intended tab order is **Record → Transcribe → Edit and Combine → Search**. The prototype is used to test recording behavior and produce a reliable design handoff; it is not intended to grow a competing transcription architecture.

## 32. Incremental audio persistence and recovery

The prototype now writes captured audio chunks incrementally to IndexedDB and stores session information that allows the application to identify saved and interrupted recordings.

**Tested result:** a recording containing three spoken segments separated by two pauses was reloaded while recording was still in progress. After reload, all three segments were recoverable and playable in the correct order. This is evidence that the chunks already persisted to IndexedDB can be recovered after a page reload.

Completed recordings also remain listed after reload.

This test does not prove that every sample survives every possible crash. Audio received by the browser but not yet committed to IndexedDB remains vulnerable, and browser storage can still be cleared or evicted. The implementation must distinguish data received from data whose persistence transaction has completed.

## 33. Pause and resume

Manual Pause/Resume has been tested with repeated pauses. The three spoken segments remained present and playable in the correct order.

Pause and Resume must preserve one user-facing recording session. A pause is not the same as final Stop, and resuming must not discard earlier audio. The prototype's current implementation uses the recorder's pause/resume behavior; do not assume this proves every browser will behave identically.

## 34. Audio-file export and compatibility

The prototype now offers a **Download audio file** action for saved recordings and for the currently loaded recording. The exported file in the tested browser was a `.webm` file, consistent with the WebM recording format reported by the prototype.

**Tested result:** the downloaded WebM file was accepted by Memora's file-open/import workflow. The user confirmed that Memora accepted it without a problem. Therefore, the current export format is usable by the existing Transcribe workflow and does not need to be converted to M4A merely to satisfy Memora.

This verifies import acceptance, not every possible external player's compatibility or every browser/container combination. Keep the actual MIME type and extension aligned; never rename WebM data to `.m4a` without a real conversion.

## 35. Current verified milestone

The following prototype behaviors have been tested successfully:

- Audio chunks are persisted incrementally to IndexedDB.
- A page reload during a multi-segment recording allowed recovery of the three previously captured segments.
- Repeated Pause/Resume preserved the tested segments in order.
- Completed recordings remained available after reload.
- A saved recording could be downloaded as WebM and accepted by Memora.

These results establish a useful recording-and-recovery foundation. They do **not** yet establish guaranteed recovery from every crash, successful capture while iOS is locked or backgrounded, exhaustive browser compatibility, or a complete acceptance pass for Delete/reset and every error path.

## 36. Next work

Proceed with small, testable changes. First commit this stable persistence/recovery/export checkpoint. Then review and test the current Delete/reset behavior and clean start of a second session. After that, continue with the remaining recording requirements: explicit and race-safe lifecycle states, finalization validation, and—only after the core is dependable—inactivity Pause and the paused-state beep. Test iPhone Safari/PWA behavior on the actual device before making claims about background capture or headset controls.

> **Capture first. Preserve continuously. Transcribe when requested.**


---

# DJ003 — Inactivity Pause, Saving, Browser Audio Formats, and Wake-Word Direction

**Date:** 27 October 2026  
**Status:** Implemented prototype capabilities and agreed research direction; see verification caveats below

## 37. Recording controls and inactivity pause

The recording prototype now includes manual Pause/Resume and automatic pause after approximately **5 seconds without detected speech**. The intent is to let the user think naturally without recording extended silence, while keeping the same logical session open so recording can continue.

A quiet repeating beep indicates that the session is paused. It is a state cue only; it must not be interpreted as proof that the microphone is active or that every captured sample has been persisted.

The inactivity detector is audio-level based and does not depend on Whisper. It should remain conservative: natural pauses, quiet speech, microphone differences, and background noise can affect detection. Further real-use testing should check false pauses and whether speech is reliably detected again when the user resumes.

## 38. Saving and recovery after reopening iMuse

The prototype now provides a way to save/download the recording, and it uses IndexedDB to preserve audio incrementally during capture. The recovery workflow can find and recover an interrupted recording after iMuse is restarted or reloaded, using the audio that was successfully persisted.

This extends the earlier DJ002 reload test. The important distinction remains that recovery protects audio already committed to IndexedDB; it cannot guarantee preservation of audio still awaiting a write, storage that the browser later evicts, or recording that the operating system prevents the page from capturing.

The saved/exported audio must remain a genuine media file with a format and extension matching its actual contents. Do not change a filename extension as a substitute for converting the media.

## 39. Browser-supported recording formats, with M4A/AAC preferred

The recorder now checks the browser's supported recording formats and prioritizes **M4A/MP4 with AAC** when the browser reports support for the relevant format. Where it is not supported, the recorder must fall back to a format the current browser can actually record, rather than assuming that every browser supports M4A.

This is a preference, not a promise that all browsers will produce M4A. The tested WebM export remains known to be accepted by Memora's current file-open/import workflow. Format selection and actual output should be checked on each target browser/device, and the resulting MIME type and file extension must stay aligned.

## 40. Wake-word research direction: “iMuse”

Hands-free interaction is now a research direction, not a completed recorder feature. Candidate phrases are:

- **“iMuse”** — shortest, but potentially less distinct from ordinary speech.
- **“Hey iMuse”** — natural to say and adds a distinguishing word.
- **“Ready iMuse?”** — longer, potentially more distinctive.

The current exploration uses the open-source Heed Wake Word project and a standalone HTML test lab. The lab is useful for evaluating a supplied detector model, scores, thresholds, and triggering behavior; the demo model is not itself a model trained to recognize the custom iMuse phrases.

The next meaningful step is to train or obtain a separate custom ONNX wake-word model for each candidate phrase, then compare them in the lab. Evaluation should include both successful detections and false activations during ordinary speech, across varied speaking distances, volumes, and voices. A high score on a few successful attempts is not enough to select a phrase or threshold.

The eventual detector should run locally where practical, avoid sending private speech to a remote recognition service, and must never compromise recording preservation. iPhone Safari/PWA lifecycle, microphone access, CPU/battery cost, false triggers, and behavior when the screen is locked or the app is backgrounded all require real-device testing. Do not promise always-on or lock-screen wake-word behavior based on the standalone lab.

## 41. Updated milestone summary

The recording prototype has now progressed beyond the earlier DJ002 checkpoint:

- Incremental IndexedDB persistence and recovery of persisted audio after app reload/restart.
- Manual Pause/Resume within one logical session.
- Automatic pause after approximately five seconds without detected speech.
- Periodic audible cue while paused.
- Saving/downloading a recording.
- Browser-aware recording format selection, preferring M4A/AAC when supported and falling back to a supported format.
- A standalone wake-word test lab and an agreed plan to evaluate custom “iMuse,” “Hey iMuse,” and “Ready iMuse?” models.

The implementation of these features should not be confused with exhaustive acceptance testing. Remaining work includes systematic testing of inactivity detection, save/finalization failure paths, repeated resume behavior, MIME type and output validity across browsers, and false-positive/false-negative rates for custom wake-word models.

> **Capture first. Preserve continuously. Transcribe when requested. Wake words must never put captured audio at risk.**
