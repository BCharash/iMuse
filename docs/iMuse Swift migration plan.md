# iMuse — Native Swift Migration Plan

**Date:** 30 October 2026  
**Status:** Proposed future architecture; no Swift implementation begun  
**Relationship to current work:** The browser recording prototype will be incorporated into Memora. A separate native iOS iMuse app may subsequently be built for hands-free, lock-screen-oriented recording. This document does not supersede the current Record → Memora integration plan.

## 1. Executive decision

Build **one cross-platform Memora web application** using the proven browser Record implementation, and eventually build **iMuse as a focused native iOS recording app** using Swift and Apple's native audio, persistence, and system-integration APIs. Do not attempt to mechanically convert JavaScript into Swift or create a second full Memora implementation.

The primary reasons for native iMuse are (1) greater control over recording during screen lock and supported background-audio scenarios, (2) Siri and Shortcuts entry points, (3) better integration with iOS audio interruptions and headset/audio routes, and (4) a more natural installed-app experience. None of these automatically guarantees indefinite microphone capture, an always-on wake-word engine, or hands-free operation after every termination or reboot.

**Migration principle:** Transfer product behavior, state-machine rules, recovery invariants, test cases, and data contracts—not browser implementation details.

## 2. Goals and non-goals

### Goals

- Start, pause, resume, and stop recording with minimal interaction.
- Keep one logical session across pauses; deliver one valid, playable final audio file.
- Preserve audio incrementally and recover as much committed data as practical after an interruption or crash.
- Make lock-screen recording a first-class, explicitly tested capability.
- Provide Siri/Shortcuts actions, ideally **“Start recording with iMuse”**, **“Pause iMuse recording”**, **“Resume iMuse recording”**, and **“Stop iMuse recording”** where iOS permits.
- Reuse the accepted two-stage voice-command concept: wake phrase (“Hey Doc” initially, later trained “Hey iMuse”) enters command mode; **Go** starts or resumes, **Stop** finalizes.
- Exchange recordings with Memora without forcing a cloud account or rebuilding its transcription/search systems.
- Make installation and updates practical for a non-developer owner.

### Non-goals for the first native release

- Reimplement Memora's Whisper models, paragraphing, editing, combining, semantic search, or model registry.
- Promise that custom wake-word listening works with the screen locked, after force-quit, or when the OS has suspended the app.
- Promise that Siri can silently grant microphone permission, bypass the lock screen, or launch an unrestricted continuous listener.
- Introduce automatic deletion of suspected command speech from the only stored recording.
- Replace the working web app before the native recorder has independently passed its acceptance tests.

## 3. Important iOS distinctions: screen lock, background, Siri

### 3.1 Recording while locked

A native app can use `AVAudioSession` and an appropriate recording/background-audio configuration to support continued audio capture in supported circumstances **after a recording session has legitimately started**. It must declare and justify any required background mode and respond to interruptions, route changes, and operating-system lifecycle events. Test on the actual iPhone, with the Shokz headset connected and disconnected.

**Do not conflate continuing an already active recording with starting a new one while locked.** iOS background-execution policies, user authorization, lock state, and whether the app is running or suspended can affect what is possible. Native development makes this much more feasible than a PWA, but it is not an exemption from iOS policy.

### 3.2 Siri and Shortcuts

Use **App Intents** to expose clearly named recording actions to Siri and the Shortcuts app. A simple **Start Recording** intent should be the first integration target. Test whether an action can start capture directly, whether iOS requests confirmation/unlock, and what happens if the app is not already running. Siri can invoke an action or open the app, but saying “Siri, open iMuse” by itself is not proof that recording will start.

Do not depend on replacing Apple's system wake phrase with “Hey iMuse.” Custom wake detection is a feature of iMuse when the app is permitted to run and process audio; it is **not** a replacement for system-level “Siri” invocation.

### 3.3 Lock-screen controls and headset

Explore `MPRemoteCommandCenter` and `MPNowPlayingInfoCenter` only where the app's genuine audio session and platform rules make those controls appropriate. Headset button events are not guaranteed to map to arbitrary recording actions. Test actual headset behavior; do not port the browser Media Session workaround as an assumption. Native controls, a visible in-app control, and Siri/Shortcuts should remain fallback paths.

## 4. Proposed native architecture

```text
SwiftUI application shell
    |
    +-- RecordingCoordinator (explicit state machine)
    |     idle / starting / recording / pausing / paused /
    |     resuming / finalizing / completed / interrupted / error
    |
    +-- AudioCaptureService (AVAudioEngine or AVAudioRecorder,
    |                         chosen after focused evaluation)
    |     audio session / route changes / interruptions / level monitoring
    |
    +-- RecordingStore
    |     app-private files / manifest / ordered segments /
    |     atomic checkpoints / recovery / storage errors
    |
    +-- VoiceControlCoordinator (optional and subordinate)
    |     wake detector -> command mode -> Go / Stop
    |     separate from durable capture
    |
    +-- SiriAppIntents / Shortcuts integration
    |
    +-- ExportBridge
          Share Sheet / Files / Memora-compatible audio + metadata
```

The **RecordingCoordinator** owns transitions; voice commands, Siri actions, UI buttons, and possible headset controls submit requests to it. None should independently manipulate the recorder or delete files. Serialize transitions to avoid races between a spoken Stop, a button press, an interruption, and an IndexedDB-equivalent persistence checkpoint.

Use Swift concurrency deliberately (`actor` or a single serialized coordinator as appropriate), with clearly defined ownership of audio buffers and files. Keep expensive recognition inference away from the time-critical audio callback.

## 5. Recording engine selection

Evaluate two native options before choosing:

- **`AVAudioRecorder`:** potentially simpler for standard file recording, with native pause/resume and supported output formats. Verify how reliably it checkpoints recoverable data, handles abrupt termination, and produces a valid file after multiple pauses.
- **`AVAudioEngine` with a capture tap:** offers more control over PCM buffering, silence analysis, custom wake detection, segment boundaries, and incremental writing, but requires careful real-time audio engineering and explicit encoding/finalization.

Choose on evidence, not theoretical flexibility. A short technical spike should compare continuity, crash recovery, CPU/battery use, route changes, headset microphone quality, and file compatibility. Avoid doing expensive work or waiting on disk writes inside real-time audio callbacks.

For final output, prefer a widely supported native format such as M4A/AAC **if it satisfies recovery requirements**. Keep original recoverable segments/checkpoints until the final file has been validated. PCM/CAF or other intermediate formats may be useful internally, but are not automatically the best user-facing export. Never concatenate separately finalized media containers and assume the result is valid.

## 6. Persistence and recovery: carry forward the core requirement

The browser prototype's IndexedDB store does not carry over literally. In native iOS, use **app-private filesystem storage** with a small durable session manifest (and, if useful, SQLite for indexes/metadata). The file system is the authoritative source for audio; metadata must never imply that unflushed samples are durable.

Minimum persisted state: session UUID, creation time, state, capture format, ordered segment IDs, file locations, last confirmed checkpoint, interruption markers, and finalization status. Use coordinated/atomic manifest updates where appropriate and protect against half-written files.

At app launch, inspect incomplete sessions, verify what audio can be decoded, and offer **Recover / Continue / Finalize** as appropriate. Retain original segments if finalization fails. Be explicit that the last uncommitted buffer can be lost in an abrupt crash, low-storage event, or power failure.

Set an appropriate iOS file-protection class based on the requirement to record and write while the device is locked. The default strongest-at-rest protection may prevent needed file access after locking; security and locked-state writeability must be evaluated together, not assumed.

## 7. Voice control: transfer the state machine, not the web libraries

Accepted product behavior:

| Recording state | Wake phrase recognized | Go | Stop |
|---|---|---|---|
| Idle, listening enabled | Enter command mode | Start new recording | Stay idle |
| Recording | Pause immediately, then enter command mode | Resume same session | Finalize session |
| Paused | Enter command mode | Resume same session | Finalize session |

Go/Stop are accepted only in command mode. If no valid command follows the wake phrase, remain paused rather than silently resuming. Manual controls always remain available. A recognized wake phrase must not discard any previously committed audio.

The current web laboratory uses **Heed** for “Hey Doc” and **TensorFlow.js speech-commands** for Go/Stop. Its provisional overlap settings are **0.75 on MacBook and 0.90 on iPhone**. These are **web-model observations**, not Swift parameter recommendations. `overlapFactor` and the TensorFlow.js callback schedule do not map directly onto Apple's speech frameworks or a native Core ML implementation.

For native implementation, investigate (a) whether the chosen wake model can be executed reliably on-device through a suitable runtime or converted to Core ML, and (b) whether a small native keyword model can recognize Go/Stop. Do not assume the browser ONNX model or TensorFlow.js pretrained command model can simply be copied into Swift. Verify model license, preprocessing, sample rate, window size, and recognition thresholds. Keep models and runtime assets inside a dedicated `VoiceControl/` area, not the app root.

**Critical unresolved issue:** missed wake phrases spoken during an active recording will remain in the original audio. Even with immediate pause after a recognized wake phrase, prior unrecognized “Hey Doc” attempts are captured. Preserve the raw recording and treat any future command-audio cleanup as a separate, reversible editing operation. First prioritize reliable first-attempt wake detection and a practical Siri/Shortcuts alternative.

### Proposed Swift source organization

```text
iMuse/
  App/
  UI/
  Recording/
    RecordingCoordinator.swift
    AudioCaptureService.swift
    RecordingStore.swift
    RecoveryManager.swift
  VoiceControl/
    WakeDetector.swift
    CommandRecognizer.swift
    VoiceControlCoordinator.swift
    Models/
  SystemIntegration/
    RecordingAppIntents.swift
    AudioSessionManager.swift
    RemoteControls.swift
  Export/
    RecordingExportService.swift
  Tests/
```

This is a conceptual target, not a claim about current repository contents.

## 8. Memora interoperability

The first native iMuse should export a valid audio file and minimal sidecar metadata where useful: stable recording UUID, created timestamp, duration if verified, MIME/UTType or file extension, and recovery/finalization status. **Do not require Memora to adopt iMuse's internal native file layout.**

Initial interchange should use the iOS Share Sheet / Files workflow or another user-controlled local transfer. Later, evaluate a more direct handoff only if it materially improves the experience and remains robust across devices. Memora should continue to own transcription, paragraphing, transcript editing/combining, search, and model management.

Keep the native recording and the Memora-imported copy independently recoverable; do not delete the only source automatically after export or transcription.

## 9. Distribution and the weekly-reinstallation problem

**The current recurring reinstall/re-sign experience is a distribution/signing problem, not an inherent requirement of Swift apps.** Free Apple ID development provisioning commonly involves short-lived signing; do not design the product around weekly manual reinstallation.

Practical distribution paths to evaluate:

1. **Apple Developer Program + development installation:** paid membership and suitable signing can avoid the short free-provisioning cycle, but provisioning profiles, certificates, and device/build management still require care. This is appropriate for active personal development, not necessarily the easiest permanent user experience.
2. **TestFlight:** convenient installation and updates for beta testing, but individual beta builds expire (commonly after 90 days). It is not a permanent maintenance-free deployment strategy.
3. **App Store distribution:** generally the most convenient long-term installation and update experience after review/approval, with ongoing developer-account and compliance obligations. A focused recorder may be more practical to maintain than a full Memora port.
4. **Other eligible distribution mechanisms:** availability depends on region, entitlement, and current Apple rules; investigate only if the conventional options are unsuitable.

Before writing substantial Swift code, choose a distribution path based on how often the user is willing to rebuild, whether the app is private or public, ongoing fees, and whether App Store review is acceptable. Do not promise a particular provisioning duration without checking the current account and Apple documentation.

## 10. Recommended phased roadmap

**Phase A — Finish the web handoff (now).** Move the existing browser Record implementation into Memora without weakening IndexedDB recovery or adding a second transcription stack. Preserve the standalone lab results and documentation.

**Phase B — Native feasibility spike.** Create a minimal SwiftUI shell with one Start/Pause/Resume/Stop recording flow; test microphone permission, headset route, actual screen locking, interruption recovery, and one complete audio export. Also create one Siri/App Intent for Start Recording. Decide whether native iMuse provides the expected lock-screen and Siri benefit before investing in voice models.

**Phase C — Durable native recorder.** Implement explicit states, ordered checkpoints/segments, recovery after force-close/crash scenarios, valid finalization, saved-recording list, delete/reset, and repeatable device tests. Validate file protection and storage behavior while locked.

**Phase D — System integration.** Add Siri/Shortcuts pause/resume/stop intents, lock-screen-visible controls where supported, route-change handling, and optional headset control. Verify behavior when the app is open, backgrounded, locked, suspended, or terminated—these are distinct conditions.

**Phase E — Optional on-device voice commands.** Port or replace the wake/Go/Stop models only after capture and Siri paths are stable. Test whether simultaneous audio analysis affects fidelity, durability, battery, thermal load, or interruption recovery. Native wake-word listening while locked is a research question, not a release promise.

**Phase F — Distribution and maintenance.** Select paid development/TestFlight/App Store route, automate routine build/signing steps where practical, and document a simple install/update procedure that does not require weekly manual rebuilding.

## 11. Acceptance tests and stop/go criteria

- A recording started while unlocked continues to capture correctly after the screen locks, for a realistic session duration, on the actual iPhone.
- A recording remains valid through multiple pauses and resumes, with no missing or duplicated spoken segments.
- After a forced termination or interruption, previously committed audio is recoverable and the app does not claim uncommitted audio survived.
- Microphone permissions, phone calls, Bluetooth disconnection/reconnection, and route changes fail safely and visibly.
- Siri/Shortcuts can invoke the agreed action under clearly documented device/app states; any unlock or confirmation requirements are accurately described.
- Final audio plays correctly, has the actual expected format, and imports into Memora.
- The app does not silently lose recordings due to a failed voice recognizer or an unavailable model.
- A realistic installation/update pathway has been demonstrated without a weekly manual re-signing cycle.

**Go/no-go after Phase B:** If reliable locked-state recording and a useful Siri invocation path cannot be demonstrated on the target iPhone, do not invest in a full native migration merely because Swift is available. Continue with the working Memora web recorder while revisiting the native hypothesis.

## 12. What to preserve from the current project

Retain the iMuse design journal, next-steps document, voice-control integration plan, standalone diagnostic findings, user-facing recording semantics, and recovery acceptance tests. These form the native product specification. Keep the web implementation in Memora; do not delete it as a prerequisite for native work.

**Next practical decision, when ready:** select the distribution route and perform the minimal Swift feasibility spike. No current JavaScript or Swift source edits are authorized by this document.

> **Capture first. Preserve continuously. Make hands-free operation useful without sacrificing recoverability.**
