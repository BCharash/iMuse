# iMuse Design Journal

Current navigation: [documentation index](README.md), [recording investigation](recording-investigation.md), and [active roadmap](iMuse%20next%20steps.md). Entries are dated snapshots. DJ012 records the installed failure; DJ013 records preservation; DJ014–DJ016 record library/store/recovery extractions. DJ025 records the earlier roadmap/transcription priority; DJ026 records the accepted wake refactor, build identity and latest documentation cleanup. Older proposals, test counts and labels are historical, not current instructions.

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


---

# DJ004 — Headset Button Controls and Voicute Wake-Word Findings

**Date:** 28 October 2026  
**Status:** Recording/wake-word prototype findings recorded; iPhone headset-control route remains unresolved

## 42. Scope and working method

Today's work focused on two hands-free recording mechanisms: the standalone Voicute wake-word experiment and physical Bluetooth headset-button controls. The wake-word implementation notes dated 27 October have been incorporated into this journal so that the design history and next steps can be followed from one place.

The production recording code has **not** been changed as part of the headset investigation. Diagnostic experiments are evidence-gathering only. Do not repeat a test already listed below unless a code change or a clearly different hypothesis justifies it.

The target product remains a cross-platform browser-based iMuse PWA. A native iOS application with a rebuild/reinstall workflow is not the preferred solution.

## 43. Voicute wake-word prototype — implementation and evidence

A standalone HTML prototype, `iMuse-voicute-auto-pause-wake-word-test.html`, was created to explore automatic pause and spoken wake-word resume. It is a proof of concept, not a production feature integrated into iMuse.

The prototype uses a browser-side ONNX runtime and the Voicute wake-word engine, with model/runtime assets obtained from external CDN/GitHub-hosted resources. Initial loading therefore requires network access. The inference is intended to run locally in the browser; the page is not intended to send microphone audio to a remote wake-word inference service.

The prototype uses one microphone stream for both MediaRecorder and a separate Web Audio processing branch. It estimates input level for inactivity detection and feeds recent audio to the detector. Wake-word inference is intended to run **only while recording is paused**, not while the recorder is actively capturing the user's speech.

The intended loop is:

1. Record and monitor audio level.
2. After approximately five seconds below the current silence threshold, pause the recorder and play a short beep.
3. Enable wake-word detection while paused.
4. When a wake phrase is accepted, resume recording, disable detection, and reset the silence timer.
5. Repeat until the user stops the session.

The current inactivity settings in the lab are a 5,000 ms silence interval and an RMS threshold of 0.012 normalized amplitude (approximately −38 dBFS). These are experimental settings, not universally validated values.

### Model and threshold findings

The current public demo model is a stand-in phrase model, usually “Hey Friday” when that model loads, with a possible fallback such as “Hey Jarvis.” The exact phrase/model shown by the page must be checked for each run. These are **not** custom models trained for iMuse phrases.

Ordinary speech was observed to trigger false wake detections. A threshold of 0.8 was not selective enough in the user's test conditions. The user described 0.9 as “pretty good,” but this is an informal observation, not a measured false-accept rate. Options 0.85 and 0.95 were added; their comparative results remain unreported. A higher threshold may reduce false triggers but can also miss genuine wake phrases.

The Heed experiment that preceded Voicute showed that a browser-based auto-pause/beep/listen/resume loop was plausible, though detection while sharing the microphone stream was not perfectly reliable. The Voicute test initially had a syntax issue affecting the five-second auto-pause; this was corrected, and the page was subsequently reported to work. Re-test that loop if later changes affect it.

### Product phrase and integration status

Candidate product phrases under consideration are **“iMuse,” “Hey iMuse,” and “Ready iMuse?”** An earlier implementation note also mentioned “Go iMuse”; no final phrase has been selected or validated. No custom iMuse phrase model has yet been demonstrated.

The next wake-word work should compare a custom model or suitable alternatives using repeatable positive and negative trials, not simply select a phrase from a few successful detections. Measure false activations during ordinary speech and missed genuine activations at different distances, volumes, voices, and noise conditions. Keep the feature optional and subordinate to recording integrity. Do not integrate the detector into production until microphone coexistence, resource use, privacy/network behavior, false-activation rates, and failure fallback have been evaluated.

## 44. Headset controls — successful desktop result

On **Chrome running on the MacBook**, the headset-control experiment worked after the user clicked **Activate headset controls**:

- A headset pause action while idle started a recording.
- Pause/resume actions controlled the active MediaRecorder session.
- A next-track action finalized and saved the recording.

This is a successful observed result for that desktop Chrome environment. It does not establish that the same event routing works on iOS browsers.

## 45. iPhone headset investigation — tests and failures

The iPhone under test is an iPhone 12 Pro Max running iOS 26.7.2. The user normally uses **Safari** for browsing and PWA use. **Edge is used specifically for standalone HTML diagnostics**, because it can run those files in the user's workflow. Do not treat Edge as the user's normal iMuse browser.

The following diagnostic results have been observed:

### 45.1 Media Session registration alone

In Edge on iPhone, `navigator.mediaSession` was available and handlers for `play`, `pause`, `stop`, `nexttrack`, and `previoustrack` registered successfully. Registering handlers did not, by itself, cause headset button presses to reach JavaScript.

### 45.2 Silent audio experiment — initial WAV failed

The first silent-audio diagnostic used a generated WAV file. Edge on iPhone rejected it with `NotSupportedError` / media error code 4. This was a test-media compatibility failure, so that result alone did not test headset event routing.

### 45.3 Silent audio experiment — valid silent MP3

The diagnostic was changed to use a valid silent MP3. Playback started successfully (`play()` resolved and the media element reached readyState 4). When the Shokz button was pressed, the audio element emitted a `pause` event, but **no `MediaSession` action handler was logged**. Across presses, the button could start or control the system music player. This did not provide reliable JavaScript control of iMuse.

### 45.4 Microphone-only test

A separate test used microphone capture and MediaRecorder without a silent audio element. Microphone permission, recording, and audio chunk generation worked. The five Media Session handlers registered and `mediaSession.playbackState` was set to `playing`, but headset presses produced no action logs. The final snapshot was inactive because the user stopped the test; the recorded event history showed that capture had been active.

### 45.5 Audio Session API test

The latest test set `navigator.audioSession.type` to `play-and-record` before microphone capture, then recorded with no audio element playing. The browser accepted the setting, microphone capture succeeded, and 14 audio chunks totalling 178,412 bytes were received over approximately 22 seconds. All five Media Session handlers were registered. The Shokz button appeared to do nothing: no audible response, no music app, and no Media Session action events. The test restored the audio-session type to `auto` when stopped.

The `audioSession.state` field was reported as unavailable/undefined in this environment. Changing the audio-session type therefore did **not** solve headset-button routing.

### 45.6 Important independent clue: web device test

The user has separately observed that a **web device test which plays an audible tone does respond to the first Shokz button press**. The exact reference is https://webdevicetest.com/en/tools/media-session-key-test?utm_source=chatgpt.com, and the user has already supplied its JavaScript for review. The reference page registers Media Session handlers, plays a looping two-second tone, and sets `navigator.mediaSession.playbackState` to `playing` after `audio.play()` resolves. Its underlying reason for responding to the first press while later presses fail to reach the test reliably remains unresolved.

Do not ask the user to provide the URL or source again. Do not repeat the generic silent-audio, microphone-only, or `play-and-record` tests without a new hypothesis. The next diagnostic is to synchronize the diagnostic's playback state with the audio element: set `playbackState` to `paused` in the pause handler and back to `playing` only after successful playback/resume. Log each action and state, and test at least three consecutive presses without tearing down or recreating the media session on ordinary pause. This state mismatch is a concrete testable hypothesis, not a proven cause.

## 46. Current interpretation

The evidence does **not** prove that iOS blocks all web-based headset interaction. The audible-tone web device test's first-press response is counterevidence to that broad conclusion. It also does not yet prove that the test exposes a reusable event route suitable for controlling recording.

The evidence currently supports these narrower conclusions:

- Desktop Chrome on the MacBook can route headset media actions to the tested iMuse control logic after activation.
- Edge on iPhone registers Media Session handlers, but the three tested approaches (handlers alone, silent media, and microphone capture with `play-and-record`) have not reliably delivered Shokz actions to those handlers.
- The reference web device test URL and JavaScript have been identified and reviewed. Its first-press response remains a lead, but the reason later presses fail is still unknown.
- Safari is the user's normal iPhone browser and PWA environment. The Edge diagnostic findings must not be presented as a direct Safari test result.
- Standalone HTML files are not usable by the user in iPhone Safari in their current workflow. A Safari diagnostic would need to be served from an accessible HTTPS page, for example a temporary GitHub Pages page, rather than asking the user to open a local standalone HTML file in Safari.
- No production change should be made until a new route is identified and demonstrated in a small diagnostic.

## 47. Updated next steps

### Priority 1 — Test the playback-state synchronization hypothesis

1. Use the already-reviewed reference page and supplied JavaScript; do not spend time obtaining them again.
2. In a standalone diagnostic, set `navigator.mediaSession.playbackState` to `playing` only after `audio.play()` resolves, set it to `paused` in the pause handler, and set it back to `playing` only after successful resume.
3. Log each action, `audio.paused`, and `playbackState`; keep handlers/session alive through at least three consecutive presses without tearing down the session on ordinary pause.
4. If repeated actions work in Edge, host the diagnostic over HTTPS and test the user's actual iPhone Safari/PWA environment. Do not ask the user to open a local HTML file in Safari.
5. If the experiment fails, compare lifecycle details against the reference source before proposing a materially different test. Avoid re-running generic variants already tested.

### Priority 2 — Validate a real browser-only route

6. Keep desktop Chrome on the MacBook as a known working comparison.
7. If a repeated-action route is demonstrated in Edge, test the same isolated diagnostic in the user's actual iPhone Safari/PWA environment via HTTPS.
8. Define a clear stop/go decision: if no new route can be demonstrated, report that honestly and discuss practical alternatives rather than cycling through the same Media Session tests.

### Priority 3 — Finish other recording requirements

9. Preserve and commit the current stable checkpoint before unrelated code changes.
10. Audit Delete/reset behavior and test a clean second recording, ensuring late asynchronous events cannot restore deleted state or leak old audio/playback/metadata.
11. Validate finalization and saved-file integrity, including all segments, actual MIME type/extension, playback, and Memora import.
12. Systematically test five-second inactivity pause and paused beep with natural pauses, quiet speech, and background noise.
13. Continue wake-word evaluation separately: confirm which public model is loaded, compare thresholds 0.85/0.90/0.95 with genuine and negative trials, and investigate a custom iMuse phrase model. Do not integrate the detector until false activations and capture-safety implications are adequately evaluated.
14. Test Safari/PWA lifecycle behavior on the actual iPhone before making claims about background, locked-screen, or always-on behavior.

**Guiding principle:** Capture first. Preserve continuously. Hands-free controls are valuable only if they are reliable and cannot put captured audio at risk.


---

# DJ005 — Record Stabilization, Headset Scope, Wake-Word Deferral, and Fidelity Screening

**Date:** 29 October 2026  
**Status:** Current decisions and observations; no production code change authorized by this entry.

## 48. Current product scope

The immediate objective is to stabilize iMuse's independent Record tab and prepare its eventual integration into Memora. Record must never depend on Whisper, a wake-word model, external services, or transcription succeeding. Capture integrity, incremental IndexedDB persistence, recovery, and one valid final audio file take precedence over convenience features. Memora supplies the unified application's Transcribe, Edit and Combine, Search, and model-management capabilities.

## 49. Wake-word state and deferred voice commands

The present intended workflow is: record speech; automatically pause after inactivity; provide a periodic paused-state beep; listen for the temporary Voicute wake phrase while paused; resume on a recognized phrase; stop wake inference when recording resumes. This does not require wake inference while recording is active. The public phrase is provisional, and detection quality and final custom phrase remain open. The pause-only pathway has been exercised in the user's current iMuse work; do not describe it solely as a standalone experiment without checking the latest code.

Full spoken command recognition (pause/resume/stop) is **deferred until after integration with Memora**. Proposed later design: a lightweight wake detector, then short on-demand Whisper tiny command recognition using Memora's shared model registry and resource manager; strict command validation; no continuous Whisper transcription; optional non-destructive exclusion of command audio. Continuous wake inference during active recording is also deferred. None of this may compromise original audio or storage reliability.

## 50. Preliminary Voicute-on recording-fidelity screen

A standalone spectrum A/B lab was used with Voicute off (A) and continuously listening (B). A lasted about 38.6 seconds; B about 48.7 seconds and logged 166 wake predictions, zero detections, and no reported inference errors. Both used the same microphone settings (48 kHz, mono, Opus, echo cancellation, noise suppression, automatic gain control). The broad spectral measurements differed, but the spoken material and duration were not identical, and the user's reading was relatively monotonic. **This is not evidence of acoustic equivalence or proof of zero dropouts.** It is an encouraging preliminary screen only. A controlled fidelity and transcription-accuracy experiment is postponed until continuous wake listening is needed for command recognition. No production change is justified by this lab alone.

## 51. Headset decision

Desktop MacBook Chrome headset control was demonstrated and a desktop-only opt-in pathway was subsequently implemented in the working iMuse prototype; the user reported that this seemed to work, although responsiveness can vary. Mobile headset control was deliberately removed/disabled after tests failed to establish dependable iPhone button routing during microphone capture; the user observed comparable limitations in Apple's Voice Memos. Earlier near-silent playback experiments demonstrated partial event delivery in Edge but did not establish a usable production route. Do **not** treat further iPhone headset experiments as the next development priority. If revisited, test independently without changing the stable desktop pathway or capture code.

## 52. Reasonable immediate development

1. Preserve a stable checkpoint and verify Delete/reset, including stale asynchronous callbacks, microphone release, playback object URL cleanup, and a clean subsequent session.
2. Audit completed-file finalization and IndexedDB recovery/error handling, including source preservation on failure and confirmation of durable transactions before success messages. Test only the unverified edge cases rather than repeating passed tests without cause.
3. Check quiet-speech behavior of the five-second auto-pause threshold and paused beep, because premature pause can omit material Whisper might otherwise recognize.
4. Write a precise Record-to-Transcribe handoff contract for the unified app: file/blob format and MIME type, session identity, duration, storage ownership, recovery status, and transfer without deleting the original audio. Keep model logic in Memora.
5. Once these are satisfactory, plan the repository integration; do not implement a second transcription stack.

## 53. Documentation policy

This journal is the chronological history and decision record. The separate **iMuse next steps.md** is the current actionable checklist and should remain. The specialized wake-word and headset reports preserve detailed experimental evidence; they may be archived rather than kept as active top-level planning documents. Their historical detail need not be duplicated verbatim here. Earlier DJ001–DJ004 entries are historical snapshots, not current implementation status: read DJ005 and the latest next-steps plan for current priorities.

---

# DJ006 — Recording Recovery Acceptance and Memora Integration Handoff

**Date:** 29 October 2026  
**Status:** User-confirmed acceptance decisions and integration direction; no source-code changes made.

## 54. Recovery is acceptable for the product's needs

The user intentionally reloaded the GitHub Pages iMuse recording page in the middle of speaking after exercising automatic silence pause and manual Pause/Resume. iMuse recovered a recording and the user supplied an exported `.m4a` file with audible speech from before the interruption, including speech after pause/resume. The user explicitly stated that losing a short period of speech immediately before a crash/reload is **not critical**. The acceptance objective is preservation of the already persisted recording and recovery of usable audio, not zero lost milliseconds at the moment of an abrupt interruption.

The assistant previously reported a successful technical media-file examination (AAC/M4A, about 21 seconds, no reported decode errors). **That report is a prior conversational assessment, not an independently reproduced verification in this document**; the receiving agent should verify the artifact directly if rigorous container certification becomes necessary. Do not claim universal media validity, zero loss, or guaranteed storage survival from this one example.

IndexedDB remains the chosen incremental storage mechanism. Do not migrate to OPFS or add a complex media-remuxing pipeline solely because theoretical failure cases exist. Revisit only when a demonstrated problem justifies the change. Browser origin data can still be cleared/evicted, and data not yet committed may be lost.

## 55. User-confirmed Delete and session semantics

The user confirmed that **Delete Saved Session deletes only the selected saved recording**, and **starting a new recording leaves existing saved recordings intact**. The Delete control is **hidden while a recording is in progress**. Therefore, a proposed user-interface test of pressing Delete during active recording was inapplicable; do not present it as an outstanding normal-UI requirement. This does not by itself prove all internal asynchronous cleanup paths, but those hypothetical cases should not block integration absent an observed failure or a specific code-review finding.

## 56. GitHub Pages microphone permission incident

On the MacBook, localhost microphone capture worked and the iPhone site worked, while the MacBook GitHub Pages deployment displayed `Microphone not ready: Permission denied. Press Start Recording to retry.` Changing Chrome's **site-specific microphone permission** restored functionality. There were no local Git changes. This was a browser-origin permission issue, **not evidence of a recorder regression**. The reason the permission changed was not established.

## 57. Integration decision

Proceed toward unifying iMuse Record with Memora. **Reuse Memora's existing desktop/mobile file-save and file-load pathways**, rather than building a competing file-management implementation inside Record. Keep Record independent of Whisper and Memora's model lifecycle. Transfer a completed or recovered audio artifact and its metadata non-destructively to Memora's Transcribe workflow. Do not delete the IndexedDB source merely because it was handed off or transcribed.

Treat earlier DJ005 and next-steps instructions to repeat broad Delete/reset, multi-segment recovery, or generic media-assembly tests as superseded where the user has already confirmed the intended behavior. A narrow review of the actual integration boundary remains appropriate. The companion `iMuse Memora integration handoff.md` is the current agent-facing brief; `iMuse next steps.md` is the current action list. Historical journal entries remain intact.

---

# DJ007 — Heed + TensorFlow Command Laboratory and Voice-Control Integration Decision

**Date:** 30 October 2026  
**Status:** Laboratory findings and accepted architecture; integration not yet implemented in production

## 58. Purpose and scope

The experiment investigated a small, local, two-stage spoken-control system for iMuse: a wake-word detector (Heed, temporarily recognizing **“Hey Doc”**) followed by TensorFlow.js Speech Commands recognition of the model's existing **“Go”** and **“Stop”** classes. The eventual wake phrase is **“Hey iMuse”**, contingent on obtaining and validating an appropriate custom wake model. No claim is made that the temporary model recognizes “Hey iMuse.”

This research replaces the earlier *proposed* Whisper-tiny command recognizer as the **current preferred design**. Whisper remains the independent Transcribe function in the unified Memora-based application; it must not be required for recording or commands. The older Voicute paused-state prototype remains historical evidence, not the current command architecture.

## 59. Laboratory implementation

The standalone `iMuseCmd.html` experiment used Heed to detect the wake phrase and TensorFlow Speech Commands (`speechCommands.create('BROWSER_FFT')`) for short commands. The observed implementation loaded the command model in advance, then enabled its listener following a recognized wake word, with an audible “Yes” acknowledgment. TensorFlow listened with `probabilityThreshold: 0` and `invokeCallbackOnNoiseAndUnknown: true`; the `overlapFactor` was made selectable to study callback cadence. The laboratory included spoken-event markers, scores, callback timing, and JSON diagnostic export.

The relevant test settings included approximately **Go 0.60**, **Stop 0.85**, and an adjustable Heed threshold. The wake threshold was varied extensively during one iPhone experiment; it is not a controlled optimum. These are laboratory settings, not universally validated production defaults. In the eventual app, thresholds should be configurable through Settings, with appropriate safeguards against accidental Stop.

## 60. Timing problem and overlap experiments

An earlier diagnostic showed a marked Go utterance at 16:16:30.793 UTC, a callback at 16:16:30.943 reporting very low Go probability, and the next logged callback at 16:16:35.639 reporting Go at approximately 99.25%. Recognition followed the marker by about 4.85 seconds, with no intervening callback in that log. This suggested a callback-cadence/scheduling problem, but the data cannot prove the late positive callback represented the first utterance rather than another sound.

Subsequent comparative observations reported in the conversation:

| Metric | MacBook overlap 0.50 | MacBook overlap 0.75 | iPhone overlap 0.75 | iPhone overlap 0.90 |
|---|---:|---:|---:|---:|
| Median TensorFlow callback interval | 643 ms | 257 ms | 540 ms | 104 ms |
| Longest callback gap | 2.09 s | 0.97 s | 6.64 s | 4.18 s |
| Callback gaps over 1 s | 5 | 0 | 19 | 30 |
| Go recognitions observed | 10 | 10 | 14 | 26 |
| Stop recognitions observed | — | — | 1 | 8 |

MacBook median marked-Go recognition delay improved from about **992 ms at 0.50** to **609 ms at 0.75**. iPhone at 0.75 had about **666 ms** median marked-Go delay. These are descriptive results from different runs, not a controlled latency study. Counts of gaps cannot be compared without normalizing for run duration, callback volume, and command-mode boundaries. Some measured intervals may span listener transitions. The user reported **MacBook 0.75 was perfect** in practice, and **iPhone 0.90 gave very good Go recognition**, with occasional missed wake words and more missed Stop commands. Thus the provisional integration configurations are **0.75 for MacBook/desktop and 0.90 for iPhone/mobile**, subject to actual-device testing and fallback. Do not generalize these settings to every desktop or phone.

In the iPhone 0.90 exploration, the log was described as containing **49 marked Hey Doc utterances and 34 wake recognitions**; because sensitivity was repeatedly changed (101 threshold-change events), that difference is **not** a measured false-negative rate. Stop had 12 marked utterances and 8 recognized commands; some unrecognized scores included about 0.835 and 0.722, below the then-used 0.85 threshold. Lowering Stop's threshold could increase accidental termination, so retain the conservative threshold pending in-app evaluation.

## 61. Architectural decision: wake phrase enters command mode

**Accepted by user:** “Hey Doc” (later “Hey iMuse”) is an *attention/wake phrase*, not an instruction to start, resume, or stop on its own. A recognized wake phrase while recording **immediately pauses** the recording, then enables TensorFlow recognition of **Go** or **Stop**. **Go** resumes the same recording; **Stop** finalizes it. When idle, optional enabled wake listening enters command mode without recording, and **Go starts a new recording**; Stop leaves the app idle. When already paused, wake recognition enters command mode and Go resumes the current session. Manual controls and inactivity pause continue to work independently.

Keep the recording lifecycle separate from the recognizer lifecycle. Heed is the normal listening detector; TensorFlow command inference runs **only in command mode**, not as a permanent second high-duty listener. A shared microphone stream/Web Audio fan-out is preferred if supported and shown safe; avoid opening competing microphone streams unnecessarily. Acknowledge commands only when the state transition actually succeeds. If command mode times out or fails, **remain paused** for an existing session and provide manual controls; do not silently resume or finalize. If idle, return to idle. Explicitly define how the user re-enters command mode while paused and how the listener returns to Heed after an unrecognized command. Avoid both recognizers competing for the same speech.

### State transition contract

| Recording state before wake | On recognized wake | Go in command mode | Stop in command mode | No valid command / timeout |
|---|---|---|---|---|
| Idle (voice start enabled) | Command mode; no recording yet | Start new recording | Return idle | Return idle |
| Recording | Pause capture safely, then command mode | Resume existing session | Finalize existing session | Remain paused |
| Paused (manual/auto/voice) | Command mode | Resume existing session | Finalize existing session | Remain paused |

Do not mistake *automatic silence pause* for final Stop. Ensure a late TensorFlow callback cannot start/resume/stop a different session; associate each command-listening episode with a session ID, state version, and listener-generation token. Suppress duplicate commands during transitions and finalization.

## 62. Important unresolved issue: wake words contaminating recordings

A recognized wake phrase while recording may already have been captured and committed to IndexedDB before Heed signals recognition. If the user repeats “Hey Doc” four times and only the fourth is detected, **the first three attempts are ordinary recorded audio**. Pausing on successful detection prevents subsequent Go/Stop speech from entering the recording but does **not** remove previously captured or missed wake attempts. Do not claim the voice-command scheme solves this automatically.

**Safety-first decision:** retain original captured chunks durably and unchanged. Consider a separate, reversible command-audio exclusion/cleanup layer later, using validated audio boundaries or optional post-processing. Do not erase fixed multi-second windows based on recognition timestamps, particularly when callbacks can be delayed. Do not remove audio solely because a classifier guessed a wake word; that risks deleting legitimate thought. Improving first-attempt wake detection reduces, but does not eliminate, this issue. It is an acknowledged product limitation at first integration, not a reason to delay integrating a safe control pathway.

## 63. Recording safety and coexistence requirements

1. Recording, chunk persistence, IndexedDB recovery, pause/resume, finalization, and manual controls must function **with voice control off, loading, or failed**.
2. No recognizer, audio processing branch, model load, or UI acknowledgment may block durable chunk writes or cause the application to claim capture continues when it has stopped.
3. Test microphone coexistence, audible fidelity, dropouts, latency, CPU load, and resource cleanup on actual MacBook Chrome and iPhone Safari/PWA; the standalone lab did not validate capture fidelity under the integrated load.
4. A pause triggered by Heed must use the recorder's existing supported transition, preserve the same session, and wait for the appropriate state acknowledgment before accepting Go/Stop.
5. Audio command prompts/beeps should not contaminate the saved recording; any necessary audio routing and timing must be tested, not assumed.
6. Microphone permission and iOS foreground/suspension limitations still apply. Idle voice-start is optional, enabled only by explicit user action and while the app can actually listen; no lock-screen/background guarantee.
7. Desktop-only opt-in headset controls remain a separate pathway. Mobile headset buttons remain disabled/deferred. Neither may interfere with voice control or recording persistence.

## 64. Source organization decision

**All TensorFlow command-recognition implementation and its supporting files must live in a dedicated subfolder**, provisionally `js/voice/tensorflow/` (or an equivalent self-contained subfolder agreed after inspecting current source). Keep the main application root uncluttered. A parallel `js/voice/wake/` folder may isolate the Heed adapter; a small `js/voice/` coordinator can implement the state machine. Avoid duplicate copies of TensorFlow or the model assets. The precise tree and URLs must be confirmed against the latest iMuse/Memora code, service-worker/cache policy, and hosting base path before editing. Model download/cache and offline behavior must be explicitly tested; CDN use is not automatically offline.

## 65. Integration recommendation and remaining targeted tests

**Proceed to source audit and incremental iMuse integration rather than another broad standalone overlap laboratory.** First preserve a working commit, obtain the latest current code, map the recorder and existing voice interfaces, and implement the isolated voice-control module behind an opt-in toggle. Integrate one transition at a time: paused-state wake → Go/Stop; active-recording wake → pause → Go/Stop; optional idle wake → Go starts recording. Run a narrow in-app regression suite after each step. Maintain the provisional platform-specific overlaps as configuration, not hardcoded assumptions about all devices.

Further tests are *targeted integration acceptance*, not open-ended research: missed/false wakes during natural recording, accidental Stop prevention, command timeout, listener teardown/restart, recording preservation and recovery with inference enabled, microphone interruptions, and a short actual-iPhone Safari/PWA trial. Train/obtain and separately validate “Hey iMuse” before changing the wake phrase in production. Do not reopen iPhone headset experiments or substitute Whisper tiny for TensorFlow without new evidence.

**Guiding principle:** Wake enters command mode; Go and Stop act on recording state. Capture and recoverability always win over hands-free convenience.

---

# DJ008 — Production Heed/Voicute + TensorFlow Integration, Audio-State Cues, and Stabilization

**Date:** 31 October 2026  
**Status:** Implementation documented from user-provided recorder/source and subsequent incremental ZIPs; MacBook observations reported by user. The latest solid-blue countdown patch passed reported JavaScript syntax checks but has not been independently browser-tested. This entry supersedes the *implementation status* in DJ007, not its experimental data.

## 66. Current implementation and separation of concerns

The production prototype now supports **two selectable wake-word engines** in Settings: Voicute (“Hey Friday”) and Heed (“Hey Doc”), each with its own adjustable threshold. They are alternatives, not simultaneously active recognizers. Both can trigger the same short TensorFlow.js Speech Commands **Go/Stop** window while a recording session is active or paused. User reported that both wake phrases worked well on MacBook during the latest tests; this is not a quantified field reliability study.

The wake adapters remain isolated under `js/voicute/` and `js/heed/`; TensorFlow command recognition remains under `js/tensorflow/`, with a standalone lab under `js/tensorflow/labs/`. `js/recorder.js` currently coordinates the recorder, wake events, command window, UI, silence detection, and persistence. The microphone manager (`js/microphone-manager.js`) and spoken-response manager (`js/audio-response-manager.js`) are separate modules. **A fully independent voice/recording state-controller module has not yet been extracted.** The recorder remains authoritative for capture and its IndexedDB writes; voice recognition must never be a prerequisite for preserving audio.

Settings include Audio commands on/off, wake engine and threshold, Go and Stop thresholds, command-window duration, and platform-sensitive TensorFlow overlap (provisional desktop 0.75, mobile 0.90). The Audio commands toggle is locked during an active session, including pause. Desktop headset control remains opt-in; mobile headset media-button control remains disabled/deferred. Microphone selection now includes System default and discovered inputs. The user reported **System default successfully selected the Shokz microphone on MacBook** in the latest test; earlier tests had selected the MacBook microphone, so do not claim universal or stable default-device behavior across browsers and reconnects.

## 67. Two-stage command contract (implemented for active/paused sessions)

1. Wake phrase detected **during recording** → request pause → after the recorder's pause event, say “Pause” → prepare TensorFlow → start the configured Go/Stop window.
2. Wake phrase detected **while already paused** → say “Yes?” → prepare TensorFlow → start the command window.
3. **Go** in the command window → resume the *same* paused recording, with “Recording” spoken on entry to recording state.
4. **Stop** in the command window → finalize the current session, with “Recording stopped” spoken on entry to the stopped state.
5. **Timeout or command failure** → remain paused, close TensorFlow listening, and re-arm the wake detector. A failed or missed command must not discard the recording.
6. **Automatic silence pause** (nominally five seconds), manual pause, and headset pause do **not** open TensorFlow. Only a successful wake event opens the command window.
7. **Idle wake → Go → first recording** remains explicitly **deferred**. No idle microphone/wake-listening lifecycle is yet claimed. The user will exercise the current build before adding this feature.

The source uses a command generation counter to reject some stale asynchronous callbacks, closes the command listener on state changes, and retains manual controls. The present implementation still warrants an audit of race conditions and ownership across wake inference, TensorFlow listener start/stop, and MediaRecorder transitions. In particular, the TensorFlow adapter's temporary `getUserMedia` override/stream cloning described in the stabilization review has not been shown to be fully eliminated; do not describe the microphone graph as conclusively unified.

## 68. Spoken responses now follow recorder state

Five WAV responses are mapped in `js/audio-response-manager.js`: `audio/pause.wav`, `audio/yes.wav`, `audio/recording.wav`, `audio/new-recording.wav`, and `audio/recording-stopped.wav`. The manager preloads and serializes playback using one shared Audio element, with error reporting and a timeout fallback. The latest recorder changes moved the state announcements to the corresponding MediaRecorder lifecycle events to avoid double-speaking when both a wake command and state transition occur.

| Confirmed transition or event | Intended response |
|---|---|
| New session enters recording | “New recording” (replaces the former recording-start tone) |
| Any transition into paused state | “Pause” |
| Resume existing session | “Recording” |
| Finalize/stop existing session | “Recording stopped” |
| Wake detected while already paused | “Yes?” |

**The periodic two-note paused reminder is essential and remains enabled** (approximately every 4.5 seconds). It continues while paused and stops on resume/stop. The user explicitly requested retaining it, even with spoken “Pause.” Audio playback restrictions and timing still require MacBook/iPhone testing; successful `play()` initiation does not guarantee a person heard the cue. The mic-readiness chime is a separate diagnostic/startup behavior and should not be conflated with the removed *new recording* beep.

## 69. Command countdown UI evolution

The initial textual countdown displayed tenths, then whole seconds. The user requested a small, less distracting analog display. It was first changed to an outlined circular progress ring, then to a **solid light-blue disk** that empties **counterclockwise from 12 o'clock**, with a thin dark radial boundary, approximately 28 px across. The latest change is confined to `js/recorder.js`, `index.html`, and `css/style.css`; the listening duration and recognition logic are intended to remain unchanged. This visual change is syntax-checked but not yet verified on MacBook and iPhone. The command countdown is distinct from the five-second **silence auto-pause** timer.

## 70. Stabilization work and evidence boundaries

- **Mic management:** `js/microphone-manager.js` was introduced for device choice and recorder acquisition/release; a system-default Shokz result was user-observed on MacBook. Verify actual selected track on reconnect, device switching, permissions, and idle release.
- **Spoken response manager:** centralized/preloaded/serialized WAV playback replaced creating a fresh Audio element for every cue; test audible delivery, command-start timing, and failure handling.
- **Recording/voice coordination:** state-based announcements and wake-only TensorFlow activation are the intended contract. A dedicated serialized controller remains a possible future improvement, not a completed architectural refactor.
- **Capture/recovery:** previously user-tested IndexedDB incremental recovery, pause/resume and saved-session isolation remain the baseline. These later changes have not independently re-certified crash recovery or media-container integrity; recheck targeted cases before merging into Memora.
- **Platforms:** user reported good MacBook wake recognition for both engines; do not infer iPhone equivalence. PWA microphone and audio output behavior may change with lock/background, Bluetooth routing, or browser gesture policies.

## 71. Next work — sequence and acceptance gates

**First: user field-test current build before further features.** Exercise repeated wake → Go/Stop, auto/manual/headset pause, timeout, double beeps, cue timing, analog countdown, Shokz vs built-in mic, and basic recovery after reload. Record reproducible failures rather than tuning thresholds from isolated misses. Confirm the spoken cues are not inadvertently recorded or causing wake/command feedback.

**Second: targeted architectural audit** after field feedback. Focus on microphone ownership and truthful idle status; global `getUserMedia` override in TensorFlow; stale callbacks/duplicate finalization; state transitions from manual and headset controls; cue queue delays; and reliable cleanup of audio tracks/listeners. Preserve IndexedDB chunk persistence and avoid a wholesale recorder rewrite.

**Third: implement optional idle wake listening** only after those gates pass. Define an explicit idle-listening microphone state, enable only with Audio commands permission, release when disabled, and support wake → “Yes?” → Go → start new session → “New recording”; Stop/timeout returns to idle listening. Test iPhone foreground constraints. Do not claim locked-screen/background idle listening.

**Fourth: non-destructive Memora integration** using the separate handoff contract: Record → Transcribe, preserving original audio, actual MIME/container, session identity, and recovery status. The native Swift plan remains a future, separate project.

## 72. Documentation maintenance decision

This chronological journal remains the **single history of experiments and accepted decisions**. The current `iMuse next steps.md` (dated 30 October) and `iMuse voice-control integration plan.md` still describe implementation as *not yet started* and must be **revised before being used as active instructions**; they should not override DJ008. `architecture-stabilization-review.md` remains a useful historical audit but its “Baseline: iMuse(7).zip” is not the latest implementation. Stage-1, stage-2, voice-command-stage, and root-cleanup checklists are installation snapshots, not current acceptance criteria. Keep the Memora handoff and Swift migration plan as distinct future-facing documents, updating obsolete voice-control descriptions when those plans are next acted on. Archive completed checklists rather than deleting experimental evidence; see the accompanying document-review recommendations.

---

# DJ009 — Headset Media-Button Controls Retired; Recently Deleted and Bulk Permanent Deletion

**Date:** 31 October 2026  
**Status:** Latest implementation decisions and code-delivery record; browser acceptance testing of the final bulk-delete patch remains outstanding. This entry supersedes DJ004, DJ005, DJ007, and DJ008 **only where they describe headset controls as currently enabled**. Their experimental findings and implementation history remain preserved.

## 73. Final headset-control decision: remove from active iMuse

The user established a critical difference between the **microphone selected for recording** and the **Bluetooth headset's media-button event routing**:

- On the MacBook, physical Shokz media buttons could control the earlier browser prototype when the **MacBook's built-in microphone** was selected.
- When the **Shokz Bluetooth microphone** was explicitly selected on the MacBook, headset-button control did not work reliably. Button presses could instead invoke system-level behavior such as Siri.
- On iPhone, physical Shokz headset-button control never provided dependable recording commands. The user suspected the iPhone's selection of the Shokz microphone was relevant, but this remains a hypothesis rather than an established browser or Bluetooth mechanism.
- The one working desktop combination defeated the practical purpose of using the headset for hands-free recording.

**Decision:** remove physical headset media-button controls from **both desktop and mobile** production iMuse, including the desktop opt-in Settings toggle. Do not maintain two partially functional pathways. This does **not** remove support for selecting and recording through the Shokz Bluetooth microphone; audio input and media-button control are separate concerns. Wake-word detection, TensorFlow Go/Stop voice commands, spoken responses, manual Pause/Resume, and paused-state double beeps remain independent features.

The removal patch changed `js/recorder.js`, `js/settings.js`, `index.html`, and `css/style.css`; `app.js` was not changed. It removed the Media Session action handlers, the silent-media playback workaround, the headset activation/teardown code, the toggle and its styling, and headset-specific event hooks. JavaScript syntax checks passed; this was **not** a full MacBook/iPhone regression test. The prior implementation is **retired, not rejected as impossible**: revisit only with a demonstrable Bluetooth/headset/browser workaround that operates while the headset microphone is actually in use.

## 74. Historical headset implementation — preserve for a future workaround

The earlier prototype's implementation strategy and successful partial experiment are retained here as a technical reconstruction guide, not instructions to re-enable it now:

1. In desktop Chrome, a user gesture activated a browser `MediaSession` with handlers for media transport actions. The experimental mapping used a headset pause/play-style action to start a recording while idle or pause/resume an active session, and a **next-track** action to finalize/save. The exact action mapping must be checked against the archived source before reuse.
2. A silent or near-silent HTML audio element was used to try to keep a media playback session eligible to receive headset button events. Playback had to be initiated by a permitted user gesture; the experiment also manipulated `navigator.mediaSession.playbackState` and registered action handlers. This could interfere with system audio focus or invoke system music/Siri instead of the page.
3. On iPhone Edge, a valid silent MP3 could play, but button presses did not reliably invoke the registered Media Session handlers. The `navigator.audioSession.type = 'play-and-record'` experiment also failed to route button actions despite successful microphone recording. A separate audible-tone web media-key test responded to an initial press, but did not establish a repeatable recording-control pathway.
4. The proposed uncompleted diagnostic was to synchronize `playbackState` with actual audio-element `play`/`pause` transitions, keep the media session alive across at least three presses, and, if successful in Edge, retest from an HTTPS-hosted Safari/PWA page. These were hypotheses, not established fixes.
5. Any revived design must test **Shokz microphone selected and actively capturing** on both MacBook and iPhone, including Bluetooth hands-free audio mode, OS media/Siri routing, repeated button presses, capture integrity, and microphone stream coexistence. A test with the built-in microphone alone is insufficient.

**Preservation policy:** keep DJ004's detailed test observations and this implementation description; do not erase them simply because the feature was removed. Historical code is not embedded verbatim in this journal. If the exact former JavaScript is required, retrieve the archived pre-removal repository commit or ZIP, rather than reconstructing potentially incorrect code from memory. The earlier `iMuse-headset-controls.zip` is one historical source artifact, but its presence outside the repository is not guaranteed long-term; preserve the relevant commit in version control. Do not reintroduce the old silent-audio workaround without a new demonstrated route.

## 75. Recently Deleted — recoverable deletion lifecycle

The recorder now distinguishes ordinary deletion from irreversible removal:

- Deleting a saved session moves **that selected recording** to **Recently Deleted**, rather than immediately destroying its saved audio.
- The Recently Deleted section displays retained deleted sessions and permits **Restore** or **Delete Permanently** per recording.
- A recording in Recently Deleted remains in browser storage until explicitly permanently deleted, subject to normal browser storage eviction/clearing. Recently Deleted is a recovery convenience, **not an independent backup**.
- A new recording does not delete other saved sessions. The ordinary Delete control is hidden while a recording is active, as previously confirmed in DJ006.
- Restore and permanent deletion must act on the intended session ID, not on whichever recording happens to be currently selected or playing. Playback and list state should be refreshed after deletion/restoration so stale UI or audio does not remain associated with a removed session.

This describes the current intended user-facing lifecycle. The implementation should not be interpreted as proof of survival after browser storage eviction or every crash race.

## 76. Bulk permanent deletion from Recently Deleted

The user identified that permanently deleting a long list was tedious because **each individual recording required a confirmation dialog**. The new implementation adds multi-selection to the Recently Deleted section:

1. A checkbox beside each deleted recording.
2. **Select all** for the currently displayed deleted-recording list.
3. A selected-item count and **Delete selected permanently** control.
4. **One confirmation dialog** covering the entire selected set, explicitly warning that the operation cannot be undone.
5. Per-recording deletion attempts, with a result message reporting how many succeeded and how many failed; failed items remain in Recently Deleted for later retry. The code rechecks that each target still has the `deleted` state before permanent removal.
6. Existing individual **Restore** and **Delete Permanently** actions remain available for single-recording workflows.

The bulk-delete patch was confined to `js/recorder.js` and delivered as a ZIP preserving the repository path. JavaScript syntax validation passed. The user has not yet reported a browser acceptance test of the new multi-select workflow. Recommended focused test: select two of several deleted recordings, cancel the first confirmation and verify no changes; repeat and confirm that only the two are permanently removed; verify Select all, Restore, empty-list behavior, and the remaining saved recordings. Permanent deletion is intentionally irreversible; do not treat the browser's Recently Deleted list as a second recycle bin after confirmation.

## 77. Current direction and superseded instructions

Physical headset **media-button controls are absent** from the active iMuse design. Do not follow older DJ008 references to testing headset pause as a required current feature, or older DJ005 instructions to preserve a desktop headset-control pathway. The historical test record is retained for a future Bluetooth-mode workaround. The Shokz microphone remains a supported input choice where the browser exposes it.

Recently Deleted and bulk permanent deletion are part of the recorder's local-storage management; they do not change the fundamental capture, incremental IndexedDB persistence, recovery, or voice-command contracts. Continue prioritizing durable audio preservation and verify deletion UI behavior separately from capture fidelity.

> **Retain the experimental knowledge; remove unreliable production controls. Deletion should be deliberate, recoverable until explicitly permanent, and efficient for multiple recordings.**

---

# DJ010 — Record Controls, Stop Confirmation, Bounded Audio Persistence, Diagnostics, and Recovery UI

**Date:** 1 November 2026  
**Status:** Changes reported implemented in the working iMuse prototype; selected MacBook tests successful. iPhone and long-recording acceptance remain outstanding. This entry updates current status without rewriting earlier historical decisions.

## 78. Record and Stop button redesign

The earlier plan for a large primary Record control and a separate Stop control has been implemented in the working prototype. The intended presentation follows recorder state: **New Recording** with Record available and Stop disabled; **Recording in progress** with Pause and enabled Stop; **Paused** with Resume/Record and enabled Stop; and a non-conflicting stopping/finalizing state. Manual and automatic pauses and voice-triggered state transitions must remain synchronized with the same recorder lifecycle. There is no New/Append capture mode; combining remains a separate post-recording operation.

The Record/Stop controls were redesigned for clearer, more prominent icon-based operation. This is a UI milestone, not evidence that every possible rapid-click or command race has been tested. The existing spoken cues, paused double beep, microphone choice, and wake/command behavior must not regress.

## 79. Stop confirmation — distinguish manual and spoken Stop

**Manual Stop** is intended to end and finalize the recording directly, **without a Yes/No confirmation**. **Spoken Stop** is the destructive-risk voice action and therefore requires explicit **Yes** confirmation; **No** or timeout must not finalize the recording. This distinction was an agreed design requirement and was exercised in the recent development sequence. Preserve it when modifying the new button/state logic. The user specifically requested that today's documentation include the Stop confirmation, which had not been adequately reflected in the latest journal.

Do not conflate the spoken Stop confirmation with the one-time confirmation for permanently deleting recordings from Recently Deleted.

## 80. Bounded RAM queue and incremental IndexedDB writes

The recording implementation was revised to avoid retaining an indefinitely growing array of unsaved MediaRecorder chunks in JavaScript memory. A **bounded pending-write queue** keeps audio pending IndexedDB persistence and releases the temporary in-memory reference after successful write completion. The configured pending-audio safety limit is **8 MB**; recording should transition safely on persistence failure or excessive backlog rather than silently discard audio or allow unbounded accumulation. Audio already committed in IndexedDB remains the recovery source.

This addresses the *capture-time pending queue*. It does **not** establish bounded total browser memory, and does not resolve the separate playback/export/finalization path that uses IndexedDB `getAll()` and assembles a Blob from retrieved parts. The latter remains an explicit scaling question for long recordings. Browser quota/eviction, pending final data, and crash timing remain residual risks.

## 81. Settings diagnostics and observed MacBook results

A Settings diagnostics section was added to show pending audio in RAM, peak pending audio, pending chunk count, the 8 MB limit, saved recordings/chunks/audio bytes, browser origin-wide storage usage and quota estimates, and JavaScript heap where the browser exposes it. Display units were refined to avoid needless decimal places and switch to GB above 500 MB, using approximately four significant figures. The storage estimate is **origin-wide**: on GitHub Pages, iMuse and Memora share an origin, so cached models and other site data can contribute; the estimate is not iMuse audio alone.

In early tests, pending audio and pending chunks were usually zero, with a brief pending flash. A peak of **8.986 KB** was observed. During a later **seven-minute MacBook recording**, peak pending audio reached approximately **27 KB**, then cleared on Stop in the earlier diagnostic behavior. Both peaks are far below the 8 MB queue limit and are encouraging evidence that IndexedDB writes kept up during these tests. They do not prove long-session stability or data durability under every failure condition.

The diagnostics were subsequently revised to **retain the final peak after Stop** (until a new recording or reload) and show **active recorded seconds alongside the saved chunk count**. Duration should be measured from active recording time, excluding pauses, rather than assuming each chunk represents exactly the nominal 250 ms timeslice. The displayed time is a progress indicator, not independent proof of playable media duration. JavaScript heap naturally rises and falls with allocation and garbage collection; a sustained rising baseline, rather than ordinary fluctuations, would be concerning. Syntax checks were reported for these code revisions; device acceptance remains distinct.

## 82. Interrupted recording recovery becomes an ordinary saved recording

The user verified that a recording interrupted by reloading the page can be recovered and that the resulting audio is **playable and downloadable**. Previously the list continued to show **Recover audio** because the persisted session remained marked `interrupted`, even after successful reconstruction. The recorder was updated so that **successful recovery transitions the session to completed**, while retaining metadata about the original interruption, and the control becomes **Play saved recording**. This completed state is intended to persist across subsequent reloads. On failed recovery, do not falsely mark the session complete or delete the recovery chunks.

The change was delivered and syntax-checked, but the follow-up test of recovering, reloading again, and verifying the persistent **Play saved recording** label has **not yet been reported**. Recovery cannot recreate the last samples that were never committed before a crash, and browser playback alone does not certify every container or codec edge case.

## 83. Next acceptance gates and priorities

1. **Focused recovery UI regression on MacBook:** interrupt a short active recording by reload; recover it; confirm playback and download; reload again and confirm **Play saved recording** persists. Verify the interrupted-history metadata is preserved and other saved recordings are unaffected.
2. **iPhone real-device test:** 10–15 minutes of recording with manual and silence-triggered pauses; Stop, playback, download, and inspect beginning/middle/end. Check the new Record/Stop UI, spoken Stop confirmation, and paused cues without revisiting already-settled headset media buttons.
3. **iPhone interruption test:** reload during active capture, recover, reload again, and verify normal saved-recording behavior and control label.
4. **Long-recording finalization:** 30 minutes on iPhone initially (and longer if needed), record Stop/finalization latency, memory behavior, successful playback/seek/export, and file integrity across pauses. The `getAll()`/Blob assembly approach should be reviewed in light of these results before introducing a more complex media pipeline.
5. **Targeted reliability audit:** storage failure/backpressure, pending final write completion, cleanup after Stop, and the boundary between recoverable chunks and completed output. Keep the original persisted chunks safe on any failure.
6. **After acceptance:** progress to durable finalized-recording lifecycle, UUID/metadata and validation work; then optional naming and separate Combine workflow, aligned with the Memora integration handoff. Do not make Whisper or voice recognition a dependency of capture.

**Documentation rule:** DJ001–DJ009 remain historical snapshots. This entry is the latest recording/memory/recovery checkpoint. The companion `iMuse next steps.md` has been revised to distinguish completed work from outstanding tests. Obtain the latest code from the user before further source changes.


---

# DJ011 — iPhone Standalone Capture Loss, Warning Playback, and Documentation Consolidation

**Date:** 2–3 November 2026; consolidated 3 November 2026.
**Status:** Device findings reported by the user, selected Safari-tab JSON logs reviewed, warning and temporary labs removed. Installed-iPhone workaround unresolved. This entry supersedes earlier assumptions that a successful iPhone browser lab establishes installed-PWA capability.

## 84. Browser and installed-host distinction

MacBook Chrome tab, Chrome installed app, and Safari Dock web app recorded in the background in reported tests. On iPhone, Safari-tab recording succeeds without the interruption warning, but installed iMuse loses background capture and produces an external equal-pitch double beep regardless of the warning setting. An installed iPhone lab reproduced that beep and capture loss. Reinstalling and rebooting did not resolve it. Therefore the successful earlier browser labs did not isolate iMuse's processing as the source of the original standalone failure. This is an iPhone standalone result, not a limitation established for every PWA/platform. The beep's exact origin remains unverified.

## 85. Separate warning-induced failure and removal

The spoken interruption warning was added after the original failure. Safari-tab comparisons found that playing it on visibility hidden could stall capture through either a shared or dedicated player; merely preparing a dedicated player did not. Warning off and mute-triggered warning profiles passed, without evidence that the mute-triggered warning actually played. Reviewed logs showed that AudioContext interruption can coexist with successful capture, and that context recovery alone may leave recorder output stalled. Received chunks were committed in the reviewed failures. A later silence pause was a consequence rather than the start of the shared-player stall.

The user requested complete warning removal. Playback/preparation/deduplication code, settings control and WAV were removed; normal state cues and visual lifecycle notices remain. The temporary background lab pages and dedicated script were removed at the user's request, leaving findings in the documentation. Production recordings and lab IndexedDB data were not cleared. Syntax and asset/reference checks passed; that does not constitute new device certification of the cleaned build.

## 86. Historical startup and cache incidents remain separate

Earlier flight-recorder instrumentation produced startup lockups and was reverted; the exact runtime mechanism was not established. A separate deployment/cache incident had misleadingly mixed old assets. Neither is proven to explain the installed-host failure. Avoid another broad diagnostic patch or clearing valuable browser storage. Existing received/committed chunk counts and snapshots already provide useful evidence.

## 87. Current decision and document ownership

The next proposed step is a bounded iPhone standalone audio-session investigation, with actual background speech as the success criterion and a stopping point if the host continues interrupting capture. An explicit Audio Session intent is an untested candidate, not a validated workaround. Recovery/truthful completion status is separate from uninterrupted capture; native recording is a conditional feasibility decision, not a migration already approved or begun.

The [documentation index](README.md) now names the authoritative current files. The [recording investigation](recording-investigation.md) consolidates the handoff, lab evidence and remaining architecture questions. The [active roadmap](iMuse%20next%20steps.md) owns priorities; Memora and Swift documents retain distinct integration/proposal roles. The old stabilization review, November 2 handoff and detailed November 1 roadmap moved into Archive. The redundant lab-design file was removed after its evidence was incorporated. Earlier entries remain intact as history, not instructions to repeat completed experiments or restore retired controls.


---

# DJ012 — Capture-Only Installed Lab Reproduces the Failure

**Date:** 3 November 2026. **Status:** User-reported minimal installed result; experiments reverted.

The separate direct-tap microphone declaration was accepted and cleared successfully but did not help installed-iPhone background capture; Safari-tab capture succeeded. The experiment was reverted. A subsequent minimal lab, authorized at lab.html with a distinct standalone manifest, removed production imports, Web Audio, playback, voice models, silence handling, wake lock, persistence writes and audio-session controls. It retained only microphone → MediaRecorder capture with RAM-held chunks and post-stop playback. The user reported the same double beep and microphone loss in background.

The minimal lab was reverted (`1cf3423`, revert `a739a57`); its exact source can be retrieved for a later iOS 27 comparison without retaining experimental files in the current app. No latest minimal JSON or new browser-control result was supplied with the report. The installed-host failure no longer requires any of the isolated iMuse subsystems. Its exact OS mechanism remains unresolved.

The user prefers continued web development before native migration, lacks a cable for connected-device logging, and may wait days for an iOS 27 volunteer. Pause speculative production patches, retain the negative results, and develop on the successful Safari-tab route. The related Safari 27 release fix is not proof of restored standalone capture. Current details and priorities remain in the investigation and roadmap.

---

# DJ013 — Recording Preservation and Interface Consolidation

**Date:** 3 November 2026. **Status:** Four separately approved implementation stages and interface cleanup completed; device acceptance remains bounded by reported results.

Emergency copies now survive starting another recording; serialized updates and writer ownership protect stored sessions; chunk checks and delayed-finalization handling retain honest interrupted/error outcomes; persistent browser storage is requested without blocking capture. The user reported Stage 2 and Stage 3 looked satisfactory and supplied different storage grants by browser/container. Those grants do not fix installed-iPhone background microphone capture.

The user requested a simpler interface: status-only storage protection, automatic checks on Settings opening, a compact saved-player control opening a separate dialog, an unchanged top in-memory player, shorter actions, compact diagnostics and KB sizes in saved/deleted lists. Unsaved audio notices and explicit permanent-deletion safeguards remain.

The five Python suites are retained regression coverage, with a shared harness and standard unittest discovery. They are development tools, not runtime requirements or device certification. The current recording brief owns behavior, evidence boundaries and one manual checklist; detailed stage history moved to Archive. The roadmap and Memora handoff now preserve interrupted status rather than instruct recovery-to-completed promotion.

Automatic retries for memory-only emergency tails, acquisition repair, long-file memory work and native development remain separate future decisions. No additional stage, deployment or storage migration is authorized by this cleanup.

---

# DJ014 — Extract the Recording Library Interface

**Date:** 3 November 2026. **Status:** First refactoring step approved and implemented; device regression remains separate.

Moved Saved/Recently Deleted rendering, selection/confirmation handlers and the saved-player dialog into `js/recording-library.js`. Its factory accepts callbacks for storage/recovery actions and current emergency/write-ownership state. It owns only its DOM and saved-playback URL; recorder.js retains capture, storage, emergency data and the top player. No database schema, capture policy or storage algorithm changed.

The five suites now run six test methods, including direct whole-module library coverage for protected active/emergency rows, playback/export/diagnostics delegation, soft delete, restore and cancelled/confirmed bulk deletion. Integration checks use the actual recorder wiring and preserve full emergency selection and top-player isolation. These controlled checks pass, but native controls/layout and real-browser recording still need focused device checks. Later storage/controller extractions require separate approval.

---

# DJ015 — Extract the Recording Store

**Date:** 3 November 2026. **Status:** First extraction reported working on device; second extraction approved and implemented, awaiting device verification.

Moved recording IndexedDB initialization, reads/writes, deletion/restore and event I/O into `js/recording-store.js`. The existing writer coordinator and idle guard are injected. Database name, schema version 2, keys/indexes, atomic chunk/counter commits and guarded deletion remain. The recorder retains pending audio and updates its own counters after commit; failure injection and completion decisions remain outside the store. An owned metadata method avoids re-queuing inside recovery/initialization operations already holding the coordinator.

Blocked initialization has an explicit late-success guard: an eventual unused connection is closed, and a failed open does not silently become ready. Settings' read-only storage diagnostics retain their existing path. No new durability mode, OPFS backend, file picker or schema migration was introduced.

Five suites/seven methods pass, including complete store-module schema/open-failure tests, real recorder wiring with simulated transactions/locks, diagnostic cleanup, existing fault-injection and emergency/finalization checks. Database/microphone device acceptance remains separate. Further extractions await approval after the focused checks in the recording brief.

---

# DJ016 — Extract Recovery and Finalization

**Date:** 3 November 2026. **Status:** Store extraction reported satisfactory; third extraction approved and implemented, pending device regression.

`js/recording-recovery.js` owns emergency assemblies, bounded reads, watchdog/recovery actions, assembly/validation, saved recovery/export and finalization classification. Existing integrity rules are reused. Capture and pending-write ownership, microphone cleanup, writer-lease release and the top player remain in the recorder; the recovery service calls explicit callbacks rather than taking ownership of those resources. Emergency copies remain independent of playback and survive subsequent recordings within the open page.

The existing failure, timeout, late-write, smaller-fallback and interrupted-status algorithms are preserved. Five suites/eight test methods pass with complete recovery-module evaluation, actual recorder wiring and a direct callback-level component test. No durability mode, schema, background-capture workaround or media format changed. The next checkpoint is focused device verification, with further extraction requiring approval.

**Follow-up correction approved during testing:** The simulated-failure row was confusing despite being playable, and its disabled Delete action lacked an explanation. The user approved an explicit interruption/memory-copy notice and confirmed **Discard…** action. Playback/export already uses the original format; no conversion was added. Discard moves the committed portion to Recently Deleted before releasing emergency memory and its matching player. Cancellation, storage-operation failure and active/finalizing ownership retain the copy. Tests cover cancellation, confirmation, failure retention and preservation of a different current recording. This is a deliberate UI/behavior correction alongside the otherwise mechanical extraction.

---

# DJ017 — Remove Unused Recorder Helpers

**Date:** 3 November 2026. **Status:** Approved lower-risk cleanup; voice extraction deferred.

The user confirmed the recovery/Discard changes worked in live view and on iPhone. The simulated failure retained about one additional word plus a fraction; this verifies access to a short pending tail rather than the size of a possible real-world stall.

After reviewing risks of moving voice control, the user selected unused-code cleanup. Removed the uncalled readiness probe, tone/readiness-chime helpers, unused context closer and test-only saved-playback alias. Updated test extraction boundaries and exercised the real recovery wrapper/service instead of that alias. No live recording, voice, silence, lifecycle or storage behavior changed, and no additional production module was created. Eight controlled regression tests pass. Export helpers and voice/diagnostic/test-UI extractions remain separate proposals, not authorized follow-up work.

---

# DJ018 — Observe Microphone Levels Before Changing Wake Detection

**Date:** 3 November 2026. **Status:** Refactoring stopped; passive meter implemented for evaluation.

The user reports frequent false activations with free Heed/Voicute phrases in a separate standalone experiment. Review confirmed iMuse's silence slider is active but wakeMinimumDb is saved only and does not gate detection. The user chose a live dBFS readout as the first lower-risk experiment. Both sliders now show the same RMS input level while recording/paused and the expanded Settings panel is visible. It reads the existing analyser into a separate buffer, does not open or resume audio, and stops polling when hidden.

Nine controlled checks pass. Actual input/device layout remains a manual check. No wake gate, recognition threshold change, streaming correction, engine replacement or voice refactor was performed. Candidate alternatives and model/integration issues require separate evaluation; level and confidence are different measures.

**Requested display refinement:** Consolidated the identical readings into one semicircular −70…0 dBFS needle dial with a numeric readout and reduced-motion support. Quiet-room and noisy-room Q/N markers are captured explicitly from the user's current measurements rather than assigned universal room bands. References are page-local and do not change detection thresholds. Existing passive sampling/visibility behavior remains; tests cover dial mapping, off-scale numbers and independent markers.

**Requested damping:** Added display-only exponential smoothing (0.25 per 200 ms reading) and a 240 ms needle transition. Readout and room markers match the damped value. Hidden/inactive/unavailable states reset smoothing, so reopening does not reuse old levels. Capture, silence and wake algorithms are untouched; all nine checks pass.

**Processing-report correction:** Preserved a per-stream copy of the actual successful microphone request, including the automatic headset fallback. The report now distinguishes iMuse requested, Browser reports and Browser control. Unsupported controls are Not exposed; failed support queries remain Unknown. Missing browser settings do not imply processing is off. Capture preferences and behavior remain unchanged. Ten controlled tests pass, including omitted iPhone fields, Chrome-reported false, immutable request snapshots and support-query failure. Device presentation remains a manual check.

---

# DJ019 — Retain Wake-Word Evaluation Audio

**Date:** 3 November 2026. **Status:** Standalone lab implemented; real-browser acceptance pending.

The user supplied a standalone Heed/Voicute comparison tool and requested audio around triggers/near triggers with replay and later classification. Its embedded Heed model and detector match production, but scheduling and processing defaults differ. The enhanced repository `lab.html` retains five seconds before/two after candidate events, groups nearby scores, and supports manually marked low-score misses. A separate IndexedDB store retains WAV clips, labels and notes across runs; an export/import archive includes the audio. Existing score exports remain separate. Trigger/near-trigger labels require review, and selected clips do not measure all missed phrases. Production capture/recognition and the Desktop original remain unchanged.

See [wake-word evaluation](wake-word-evaluation.md) for the comparison, workflow and limitations. All 13 controlled repository tests pass, including clip bounds, truncated history, WAV encoding, UI/storage wiring, archive round trips and write-failure retention. Actual microphone, playback, long-run and browser persistence checks remain manual.

**Requested compression and tuning data:** New review clips are encoded as mono 64 kbps MP3 in a worker using pinned lamejs 1.2.1. Existing WAV clips/archives remain readable; failed compression retains the WAV safety copy. Original inference scores/levels are measured before compression. Schema 2 adds completed run logs without clearing clips; version 2 archives include audio MIME types, clip score traces and complete stopped-run frames/events/marks, capture duration, settings/model information and inference/backlog measurements. This supports parameter comparisons but does not implement an optimizer or make MP3 a bit-exact training source. All 14 controlled tests pass, including mock worker success/failure, run-log persistence and legacy WAV import. Real MP3 encoding/playback remains a browser acceptance check.

**Shorter review clips:** At the user’s request, new lab clips now begin three seconds before the candidate event, retaining two seconds afterward. Existing saved clips are unchanged. Grouping can still extend a clip when nearby detections belong to one episode. Five seconds had allowed extra context and delayed manual miss marks; three seconds reduces review time while generally retaining a short wake phrase. The 30-second rolling history and inference behavior are unchanged. All 14 controlled tests pass with updated sample-boundary and archive-size expectations.

**Review clearing and noise investigation:** Added a display-only event-log clear and a confirmed, stopped-only lab-history clear. The latter waits for compression/writes and atomically clears clips/runs without touching iMuse storage; cancellation or transaction failure retains loaded reviews. Playback is blocked while monitoring to avoid re-capture. The three most recent original WAVs remain temporarily available for A/B playback against MP3, with pre-encoding RMS/peak and clipping/invalid-sample metadata. The reported quiet-room whine and false activations remain undiagnosed; no speculative filtering or threshold adjustment was made. All 14 controlled test methods pass, including the new original-playback, clear-ordering and failure checks. Actual noisy clips still need device comparison.

---

# DJ020 — Simple Recorder, Local Filenames and Speech-Gated Wake Detection

**Date:** 4 November 2026. **Status:** Implemented as an isolated lab; iPhone acceptance pending.

The user supplied a reviewed archive and authorized a new simple recorder with offline Whisper filename suggestions and speech-gated Heed/Voicute detection. The archive contains 12 actual triggers (2 labeled correct, 10 false), plus 74 near-trigger clips. Nine false positives are annotated as faint speech, so speech gating is not expected to eliminate that problem alone. Mac inference/backlog measurements do not show growing delay. Overlapping missed-phrase clips prevent a defensible miss-rate estimate.

The new `lab.html` records compressed browser audio, journals 250 ms chunks in its own database, preserves prior recordings and offers editable date/time-first filename suggestions after Stop. Silero v5 supplies recent speech evidence; wake action defaults to marking events and can explicitly toggle pause/resume. Live audio is continuously resampled with anti-aliasing; analysis backlog is bounded and reported. The prior comparison/review lab and instructions are archived, with their browser database preserved.

Pinned local model/runtime assets total about 79 MiB; the optional preparation step caches them and preloads Whisper tiny.en without API keys. License notices and an integrity manifest are included. Service-worker scopes are limited to lab.html and js/lab/ URL prefixes. Production source modules and recording storage are unchanged. See [current lab findings and instructions](wake-word-evaluation.md) for limitations and device checks.

**Validation:** All 18 controlled regression tests pass. Isolated headless Chrome tests with a synthetic microphone and a locally decoded labeled speech clip exercised native recording, pause/resume, a saved date/time-first filename suggestion, actual Heed/Voicute/Silero inference, accepted/rejected gate decisions at a test-only sensitivity, deletion, and fresh offline model initialization. The run caught and corrected wake-event type overriding and module-worker offline scope; final browser errors were empty. These checks establish functional paths, not accuracy/latency certification on iPhone or resolution of the reported whine.

**Safari startup follow-up:** The user reported MacBook Safari rejecting MediaRecorder.start and an unhandled attempt to close an already-closed AudioContext. The lab had preferred advertised WebM/Opus. Startup now lets the browser choose its default and tests alternate supported encoders on actual synchronous start failure, only before capture/data exists. The successful recorder and MIME remain authoritative for chunks and analysis state. Failed attempts retain format/track diagnostics and are not labeled completed recordings. Cleanup has one owner and shares an idempotent close promise. The ScriptProcessor deprecation warning is separate; this patch does not claim a confirmed root cause for Safari’s encoder rejection. Added regression coverage for real-start failure, fallback-tail retention, all-encoder failure and concurrent/repeated cleanup.

**Startup validation:** All 20 controlled tests pass. A real Chrome fault-injection run forced the default encoder to reject start, then successfully recorded AAC/MP4 through fallback. A separate all-formats-fail case produced a failed attempt without losing the earlier recording, left Record available for retry, and closed no context twice. Retry succeeded; browser runtime exceptions were empty. This simulates the reported failure path and does not substitute for the user’s MacBook Safari retest.

**Microphone-ended follow-up:** The user's next MacBook Safari run reported that the track had ended before MediaRecorder startup, with no console exceptions. The lab had held the microphone through model initialization and opened its analysis context before native recording. Startup now prepares models without either resource, acquires a fresh microphone afterward, starts MediaRecorder, then attaches analysis. A configure-rate worker message supplies the actual analysis rate after initialization. An analysis failure does not stop native recording. Added a regression test for acquisition ordering, pre-acquisition cancellation and releasing a late permission result. Native Safari retesting remains necessary.

**Acquisition-order validation:** All 21 controlled tests pass. An isolated Chrome check delayed model readiness and simulated an idle microphone expiring unless recording started promptly. Observed order was models-ready → microphone → native recorder start → analysis context. Cancellation made zero microphone requests. Injecting an analysis-context failure left the native recorder active and produced a saved recording. No runtime exceptions were reported. This validates the changed sequence and isolation, not native Safari behavior.

**Confirmed microphone-ended report / worklet comparison:** The user clarified the latest row as interrupted, 0 KB, Microphone ended; an earlier encoder-error row was from another run. The 404 was confirmed as the favicon. Added build 2026-11-04.4, an inline icon, newest-first library order and explicit empty/interruption wording. An unchecked Live speech/wake analysis option now gives a native-recorder baseline without a detector worker or analysis context, with manual titles. Active analysis now uses AudioWorklet, silent output and the microphone-reported context rate. Stage/rate and track-ended diagnostics support comparison; the Safari root cause is still unproven.

A real preservation race was also found and corrected: a started recorder already inactive at track-ended time was finalized before its queued final data. It now awaits data/stop or the existing watchdog, retaining late audio. Regression coverage includes this ordering and worklet packet/silent-output behavior.

**Worklet/baseline validation:** All 23 controlled tests pass. Isolated Chrome recorded baseline audio with zero analysis contexts/detector workers, then recorded with a real AudioWorklet and live VAD measurements. A simulated microphone end with the recorder already inactive retained a nonempty final file (16,631 bytes) and the Microphone ended/running-stage reason; older files remained intact. Browser runtime exceptions were empty. Safari still requires the two-mode comparison.

**Recorder-only failure / format comparison:** The user reports microphone-ended with zero captured bytes even in the subsequent recorder-only comparison, after about nine seconds, with no other microphone user. The analysis branch therefore cannot explain both reports alone. Build 2026-11-04.5 changes the preferred format from browser default (reported WebM) to AAC/M4A, matching production iMuse, and adds a preferred-format selector for controlled comparisons. Unsupported formats and synchronous start errors still fall back; no encoder switch or reacquisition occurs after capture starts. Requested preference and actual format attempts are exported. This is a diagnostic change, not a confirmed Safari fix. Production source and storage are unchanged.

**Format validation:** All 23 repository tests pass, including preference ordering, unsupported-format fallback and actual start-failure retention. Isolated Chrome with a fake microphone saved 15 seconds of AAC audio (245,551 bytes) without analysis, then browser-default audio, AAC with live AudioWorklet analysis, and a nonempty interrupted AAC recording after a simulated track end. All four recordings remained saved; browser runtime exceptions were empty. Native Safari acceptance remains pending.

**Whisper wake-verification experiment (build 2026-11-04.10):** The user approved extending the lab before production integration, and specified whole-file, post-recording timestamp-based cleanup as the preferred future approach. Added an optional shadow verifier using immediate three-second pre-roll copies from the existing review buffer. Tiny warms before microphone acquisition, runs in the existing separate Whisper worker, and reports strict expected-phrase matches without changing wake actions. One request owns the lane; busy samples are skipped, deadlines remain explicit, and results persist with review labels/clips, including after Stop. Added-delay timing and worker inference time are distinct; no phrase-end latency or exact audio-cut boundary claim is made. Production iMuse is unchanged; whole-file cleanup remains planned.

**Validation:** All 28 repository tests pass, including strict phrase boundaries, busy/deadline/error behavior, warm-up reuse, separate naming/verification token limits and immediate pre-roll dispatch before post-roll. Initial real-model headless Chrome validation used a disposable profile and synthetic microphone input: one microphone acquisition, actual Whisper completion at about 2.4 seconds (exceeding the proposed 500 ms target), and persisted review audio/results after reload. A follow-up repeated the real inference at about 2.5 seconds and confirmed that a second result arriving after Stop also saved and reloaded with its clip; browser runtime exceptions were empty. This is functional evidence, not a wake-accuracy or iPhone benchmark. See the current lab guide for the focused device comparison.

---

# DJ021 — Voice-control characterization before extraction

**Date:** 4 November 2026. **Status:** Tests/documentation complete; production changes not started.

The user approved tests and documentation first and requested notice before any production code change. Added nine characterization test methods executing existing recorder command functions, pause/manual handlers and the TensorFlow adapter with controlled dependencies. Coverage includes prompt/listener ordering, manual versus wake/silence behavior, confirmation Yes/No/timeout, command thresholds, pending startup/Resume cancellation, late callbacks across sessions, subsystem failure and cloned-track/global-override cleanup. All 37 repository methods pass. No application source, models, storage schema or deployment files changed. These checks do not certify real model accuracy or native browser audio behavior.

The [voice-control stabilization plan](voice-control-refactor.md) owns the current extraction contract and sequence: command coordinator first, wake detection separately, coherent production build identification, and only then optional analysis ownership changes. Existing recording/preservation owners stay in place. Production changes await a separate user checkpoint; the tests/documentation addition requires no new device acceptance.

---

# DJ022 — Command-controller extraction

**Date:** 4 November 2026. **Status:** Implemented; device acceptance pending.

After reviewing the proposed scope, the user approved extracting command coordination. `js/voice-controller.js` now owns command state/generation, model preload, countdown presentation and Go/Stop/Yes/No prompt/listener sequencing. Recorder capture, original microphone lifetime, wake/silence processing, paused reminder implementation, spoken-response playback and finalization stay recorder-owned. Stable session capabilities expose only the borrowed state/stream and specific operations; storage metadata and the MediaRecorder object are not passed to the controller. Model versions/thresholds, prompt files, listener deadline semantics and the TensorFlow clone/override adapter are unchanged.

The prior characterization assertions now run the complete controller with actual recorder bridges and entry points. Added two methods for session-capability boundaries and the existing deadline distinction. All 39 repository test methods pass. Isolated Chrome loaded the production module and used a synthetic microphone for manual Record/pause/resume/Stop and another recording; both sessions completed with nonempty stored audio and no runtime exceptions. CDN model downloads were blocked for that check, so it does not certify real voice recognition. Follow the [voice-control device checklist](voice-control-refactor.md#acceptance-after-a-production-extraction) before further extraction; no wake-detector or audio-graph redesign is included.

---

# DJ023 — Opt-in voice-command diagnostics

**Date:** 4 November 2026. **Status:** Implemented; field evidence pending.

The user reported more unsolicited Stop confirmations late in the listening window, including on iPhone, after command-controller extraction. Source comparison and injected late-window score comparisons found equivalent old/new acceptance rules, but do not rule out a real acoustic/timing regression. Short clean tests cannot establish absence of an intermittent problem. The user approved passive diagnostics behind a collapsed Advanced disclosure and a contextual incident marker; further refactoring is paused.

Added a page-memory-only 4,000-event ring, default off, with export/clear and explicit truncation. Observations include effective thresholds, command scores/winner, elapsed time, session/window/generation IDs, prompts and listener lifecycle. The adapter exposes the winning score it already computed. No new model, recording, audio connection, raw audio or persistent browser storage is introduced. Incident markers identify the original accepted Stop even during subsequent Yes/No confirmation and do not cancel it. Reload clears collection and opt-in state. Action rules, thresholds and deadline semantics are retained.

All 42 tests pass; voice lifecycle assertions run with diagnostics off and on. New tests cover bounded copying, overflow, prohibited audio payloads, safe observer failure, late-score/threshold evidence, quiet-window timeout, lifecycle correlation, incident linking and UI controls. Isolated Chrome verified real export/clear/reload UI and zero microphone requests when enabling, then two completed retained recordings through the manual controls, without runtime exceptions. The accepted Stop in that UI check was synthetic; the spontaneous-recognition cause and iPhone outcome remain unverified. The [voice-control plan](voice-control-refactor.md#investigating-intermittent-stop-confirmations) owns the collection procedure and limits.

**Diagnostic UI follow-up:** The user reported that the incident marker appeared after an intentional spoken Stop and persisted after Yes, and requested that recording/storage diagnostics and preservation testing move under Advanced. Renamed the marker to Report unintended Stop to identify it as an optional report action, and clear its availability when confirmation is resolved/cancelled or a new wake sequence starts. Recognized Stop evidence remains in the log; recognition itself is unchanged. Both dynamically appended diagnostic/test panels now belong to the existing Advanced disclosure. All 43 tests pass, including confirmation completion/cancellation cases.

**Readable diagnostics / report removal:** At the user’s request, removed the report button and its pending incident-tracking API entirely. Advanced now offers View diagnostics with recent listening-window results, model scores/thresholds, elapsed time, peak Stop score and an expandable human-readable event/prediction timeline. JSON export remains optional. The viewer shows the latest 30 windows/60 events, refreshes on state boundaries while visible, and offers manual Refresh view without a polling timer. The 4,000-event log, opt-in default and recognition behavior are unchanged. All 43 regression methods pass with updated viewer/summary coverage.

**Advanced/default logging follow-up:** The user requested Advanced last in Settings, one rounded enclosure, default-on collection limited to 500 events, and clearer diagnostic presentation. They also reported two false Stops and two false Gos in roughly 10–15 quiet-room listening periods; this remains anecdotal field evidence, not a measured rate or established extraction cause. The dynamically added storage-protection section had appeared after Advanced, and reopening Settings did not refresh an already-open viewer. Advanced is now moved last after dynamic Settings initialization and uses the existing rounded-group style. Removed the extra View toggle; Command attempts appears directly under Advanced, with Detailed activity log explained as the many observations within each attempt. Logs default on, initialize with a readiness entry and retain at most 500 events; missing session metadata no longer hides entire summary rows. Recognition rules and model parameters are unchanged.

All 43 tests pass, including default bounds, collector state on/off, summary fallback and Settings reopen refresh. Isolated Chrome drove real controller/adapter callbacks with a test recognizer: Stop/No/Go appeared while collected with Settings closed, and opening it displayed the results. Checks also verified final placement/border, 500-event export/display cap, default-on reload, and two completed recordings with no runtime exceptions. Actual false-recognition causation remains open.

---

# DJ024 — Temporary pre-recording microphone-level check

**Date:** 4 November 2026. **Status:** Implemented; device acceptance pending.

The user approved a short explicit microphone acquisition for the existing meter before recording. Added Check microphone level (10 s) under Microphone levels, backed by a small temporary-capture controller. It uses the microphone manager’s device selection and processing requests, publishes live/last-acquired processing details, and creates no recorder, voice model or stored audio. Existing recording/paused levels reuse their own analyser. Timeout, manual cancellation, closing Settings/disclosure, page hide/background and Record release temporary tracks/context. Pending permission can be canceled without waiting; manager guards prevent a late result from taking recording ownership. A stale AudioContext resume also cannot dispose of a newer check. Record awaits existing check-resource cleanup before ordinary lease/microphone startup.

All 49 repository tests pass. New checks cover timeout/repeated cleanup, permission/setup failures, late resume, cancelled manager ownership and the recording-start cleanup barrier. Existing preservation and voice tests remain passing. An initial isolated Chrome run verified live preview with zero MediaRecorder starts, ten-second disposal, closing Settings and recording handoff. It exposed a check button left disabled after finalization; refreshing its state after writer release corrects that UI issue. The repeated isolated Chrome run passed both immediate and late-permission Record handoffs: canceled preview tracks ended while the recording track stayed live, and both recordings retained nonempty audio. Runtime exceptions were empty. A stalled-context test also verifies the ten-second microphone deadline starts before resume completes. Native MacBook Safari/iPhone acceptance remains pending.

**Level-check countdown:** The user confirmed the check button already disables during recording and requested a countdown instead. The status now shows seconds remaining against the existing acquisition deadline, refreshed by the meter’s existing poll; no additional timer or recording behavior change. Extended tests cover elapsed-time rounding and clearing the countdown on completion/cancellation. All 49 methods pass.


---

# DJ025 — Roadmap and documentation checkpoint

**Date:** 4 November 2026. **Status:** Documentation updated; no production change authorized by this entry.

The user reported that the microphone check and countdown worked. Native/Xcode testing is deferred because a suitable cable is unavailable. The next intended refactor is wake detection: characterize the adapters and describe a narrow extraction before production edits, preserving scaling, resampling, buffering, inference cadence, thresholds, cooldown and microphone ownership. DSP/model changes remain separate.

Readable command diagnostics showed intended Go/Stop scores at least 0.90 and unintended decisions at most 0.88 in the user's sample; they raised the threshold. Preserve that setting. This supersedes the earlier instruction to hold the original 0.70 threshold for evidence collection, but does not prove absence or cause of intermittent false commands.

Whisper stays out of live wake verification. The user favors evaluating Base over Tiny based on Memora experience. Whole-file post-recording cleanup remains an experiment: validate timestamps and retain original audio/transcripts with reversible derivatives. Recognition misses prevent promising automatic exact removal.

The user is considering native iMuse with transcription and multiple cached models, retaining Memora web and web iMuse for desktop/other platforms. This supersedes the earlier recorder-only native scope, without agreeing to all Memora features or authorizing a port. Multiple stored models need not be simultaneously loaded. Re-estimate the expanded project after native capture/file-recovery feasibility is established.

**Recording always has priority.** Future transcription/naming runs only outside active recording sessions, yields to Record, and retains queued work/source audio. Paused sessions, startup and finalization retain priority. Required live wake/command processing remains available. Verify real cancellation/resource release on-device. The lab currently permits an earlier filename inference to overlap a new recording; the requirement is not yet implemented there or as a production scheduler.

Reviewed active guides, retained regression-test documentation and archived the superseded detailed native proposal/lab guide with explicit historical notices. Updated the index, roadmap, voice-control plan, recording reference and integration contract; corrected old test counts and the Advanced failure-test path. No production files, model assets, browser data or test code changed. The last code checkpoint is 49 methods across eleven suites; this documentation pass checks links/diff rather than rerunning code tests. Current guides take precedence over historical journal entries and archived plans.


---

# DJ026 — Accepted wake refactor, build identity and documentation checkpoint

**Date:** 5 November 2026. **Status:** User-accepted implementation checkpoint; documentation cleanup complete.

The user tested production **build 2026-11-05.3**, reported it worked as expected and called the refactor a success. Loading and inference routing now live in `js/wake-detector.js`; recorder-owned microphone/audio graph, ring, rearming and recording/storage operations are preserved. The command controller remains separate. Do not restart the completed extraction. Device/browser and individual scenarios for the final user report were not specified; acceptance does not establish a universal false-trigger rate or resolve installed-iPhone background capture.

Characterization preceded the two extraction stages. Separately approved corrections then added latest-load generation guards, latest-threshold application at readiness, common post-inference validity checks and arm-generation invalidation. Outdated results/errors/timer callbacks cannot affect a later session or arming cycle; completion releases its own busy flag. No intentional wait or extra inference was added. The last implementation run passed **89 methods across thirteen suites**, including 26 wake methods. Earlier counts and unwanted baseline assertions are historical. See the [current voice guide](voice-control-refactor.md) and its [archived staged history](Archive/voice-control-history-2026-11-05.md).

Grouped Settings, temporary Suspend/Resume audio commands and the idle next-recording status are implemented. Production numbering uses **YYYY-MM-DD.N**, with a runtime label below the Settings selectors and `appBuild` in voice/saved-recording diagnostic exports. This identifies the exporting page's build module, not every cached asset or the capture build of an older recording.

The next discussed assessment is conventional generated asset fingerprinting, preserving readable source filenames and considering automated build/publish. No build tool, fingerprinting, service worker, release-folder system or hosting change is implemented or authorized by this entry. Keep that migration independent; inventory model/worker/lab paths and validate an existing-cache update before deployment changes. Native feasibility remains deferred until equipment is available, and Whisper stays outside live wake verification.

Documentation cleanup makes the accepted checkpoint and remaining queue current, archives detailed voice stage history, and removes four obsolete archived installation checklists: stage 1, stage 2, voice-command rollout and root relocation. They add no unique measured evidence and contain superseded instructions. Retained archives preserve investigations, original requirements, model findings and the still-available comparison lab. Application code, models, tests and browser data are unchanged by this documentation pass; validation checks local links/anchors and the diff rather than rerunning the already-passing implementation suite.


---

# DJ027 — Download naming and retained current-player audio

**Date:** 5 November 2026. **Status:** Build 2026-11-05.6 user-reported working; 94 automated methods across fourteen suites passed at the implementation checkpoint.

The user chose local recording-start time for download filenames, with a fixed `YYYY-MM-DD_HH-mm-ss_` prefix and an editable description initially `iMuse`. The dialog appears only on Download; descriptions are not stored as saved-list titles. New sessions store the local prefix alongside their UTC start timestamp. Older sessions lack the original timezone and derive their prefix using the device's current local timezone. The actual audio format determines the extension. Future Whisper suggestions may supply the description, but production Whisper naming and a general file-save workflow are not implemented.

Build .4 introduced the dialog; .5 connected creation of the main player's Download button. Testing then established that audio remained playable after permanent deletion but Download failed because it still looked up deleted database metadata. Build .6 keeps a filename snapshot with the player's audio Blob, removes that lookup, and clears/replaces both together. The user requested no extra deletion message and subsequently reported “okay that worked.” The retained player can download independently of the deleted saved copy until cleared/replaced or the page is lost. Emergency Discard retains its separate explicit cleanup semantics. Device/browser details of this acceptance were not specified.

The user deferred asset fingerprinting/version-maintenance upgrades and further live lab work. Future browser/native saving and Memora integration remain open choices, with Memora intended to retain browser capability. Documentation now links a root-level file map covering all repository files, while subject guides remain authoritative for behavior and acceptance evidence.


---

# DJ028 — State-specific production Silero speech gate

**Date:** 11 November 2026. **Status:** Implemented candidate 2026-11-11.1; device/acoustic acceptance pending.

The user authorized pause-only speech checking initially, a warmed model, independent recording/pause controls and advanced speech tuning. Silero checks whether speech evidence accompanies a wake candidate; speech alone does not resume capture. Go/Stop/Yes/No and RMS automatic silence pause remain unchanged. The worker reuses the existing pinned local model/runtime, has no microphone ownership, bounds pending audio and resets history across state/generation/gap boundaries. Readiness/failure does not block Record. No deliberate post-pause wait or fresh-state candidate replay was added.

All 103 automated methods across fifteen suites pass. Isolated Chrome ran the real model on digital silence and a prerecorded spoken prompt, checked Settings behavior/layout at 390 and 880 pixels and observed no microphone requests. This does not establish acoustic accuracy, device speed or background behavior. The separate lab remains available; its comparison and queue experiments are unchanged. See the [production speech reference](voice-control-refactor.md#state-specific-silero-speech-checking) for settings, fallback behavior, ownership and focused device checks.


# DJ029 — Speech controls and clearer diagnostics

**Date:** 11 November 2026. **Status:** Implemented candidate 2026-11-11.2.

At the user's request, keep all Silero controls in one rounded group immediately below wake-word recognition. Show the recommended starting policy (recording off, pause on) and tuning (0.60, two blocks, 1,000 ms), and provide a restore action limited to those five preferences. Diagnostics now offers Show/Hide and Copy alongside Download/Clear. The viewer starts hidden, while collection retains its existing setting. Rename and explain the summary as Voice recognition results and the detailed timeline as Detailed troubleshooting log, describing how each helps investigate unexpected/missed voice actions. Recognition policy and thresholds are otherwise unchanged.


**Placement correction, build 2026-11-11.3:** the user clarified Silero is adjusted less frequently. Final order is Wake-word recognition → Voice command recognition → Speech detection — Silero. All Silero controls remain together; recognition behavior is unchanged.


**Settings clarification, build 2026-11-11.4:** keep recording/pause switches in the main Silero group below command recognition. Return threshold, minimum blocks and lookback to Advanced voice settings. Remove the restore action; show recommended values in parentheses beside each of the five controls. Recognition behavior and saved preferences are unchanged.


# DJ030 — Scoped diagnostics and investigation of iPhone stop output

**Date:** 11 November 2026. **Status:** Candidate 2026-11-11.5; iPhone output result pending.

The user reported newly quiet receiver playback for the stopped announcement in Safari and installed iMuse, with normal headset playback and no MacBook symptom. Source comparison with the pre-Silero checkpoint found unchanged prompt/output/microphone/command files and an unchanged stop sequence; no root cause is established. Correct an existing gap by awaiting command-listener and AudioContext shutdown before playing the announcement. A bounded timeout/failure suppresses that prompt while preserving saved audio. Do not force a speaker route or raise volume speculatively. Tests establish shutdown ordering and retained finalization, not actual iPhone routing.

Diagnostics now presents independent Voice recognition results and Detailed voice diagnostics sections. Each owns Show/Hide, Copy and Download for its displayed readable rows. Full JSON remains a separate detail export. A single Clear all voice diagnostics removes their shared event history. Browser checks exercise export contents, independent visibility, shared clear and narrow/desktop layout. The implementation suite passes 106 methods across fifteen suites. See the recording investigation for the exact remaining device check.


# DJ031 — Spontaneous return of iPhone speaker output; observation checkpoint

**Date:** 11 November 2026. **Status:** User observes; no causal fix established.

The user reported that the original stopped prompt now plays normally through the iPhone speaker. Prior evidence: headset output remained normal; other sites and other iMuse prompts were normal; waiting for shutdown did not fix receiver routing; disabling Audio commands did not fix it; every option in the isolated output check still used the receiver. These negative results remain valid and do not establish a Silero or general Safari cause.

A temporary .6 substitution mapped stopped to recording.wav, but the user distinctly heard the original stopped message/intonation while speaker output was normal. Thus the substitution did not produce a verified A/B test. The .6 label does not establish every module or audio asset refreshed, and a cache/session explanation remains a hypothesis.

The user reverted the isolated output test (`0639a27` → `eebb6f4`) and the temporary audio swap (`6569436` → `95291db`). Live checkout verification shows build 2026-11-11.5 and the original recording-stopped.wav mapping. Retain scoped diagnostics, Silero settings and the earlier shutdown-ordering correction; no further audio change is authorized by this documentation checkpoint. The active investigation owns recurrence instructions. No site data was cleared. Last retained implementation validation is 106 tests across fifteen suites; documentation validation checks file coverage and links, without rerunning microphone/model tests.
