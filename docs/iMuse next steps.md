# iMuse next steps

**Updated:** 31 October 2026  
**Status:** Current priorities following Heed/Voicute and TensorFlow integration. This is a planning document, not an independent runtime certification or authorization to change code.

## Goal and protected invariants

Unify iMuse Record with Memora's Transcribe, Edit and Combine, and Search workflows. Record is independent of Whisper and recognition-model availability. Preserve incremental IndexedDB audio persistence, crash recovery, original saved sessions, manual controls, and accurate media format metadata. Never delete source audio as a side effect of transcription or handoff.

## Current implementation checkpoint

- Selectable wake engines: **Heed / “Hey Doc”** and **Voicute / “Hey Friday”**. Both have been reported working on the MacBook, but field reliability is not established.
- After wake, a bounded **TensorFlow.js Go/Stop** command window operates on the active recording. Wake while recording pauses first; wake while paused acknowledges “Yes?”. **Automatic silence pause and manual pause do not launch TensorFlow.**
- The command window uses a small **solid light-blue circular countdown**, emptying counterclockwise from 12 o'clock, instead of numerical seconds.
- Spoken cues are assigned to state transitions: “New recording” when a new session begins; “Pause” on entering paused; “Recording” on resume; “Recording stopped” on stopping. “Yes?” acknowledges a wake phrase while already paused. The **periodic double beep every ~4.5 seconds while paused must be retained**.
- Microphone selection is implemented through a microphone manager; the user reported that System default selected Shokz on the MacBook. The shared spoken-response module serializes WAV playback. The latest timer and audio-state updates have syntax checks, **not comprehensive device validation**.
- Current paths are `js/heed/`, `js/voicute/`, `js/tensorflow/`, `js/microphone-manager.js`, and `js/audio-response-manager.js`; do not use the obsolete proposed `js/voice/` tree.
- **Idle wake before first Start Recording is not implemented** and is deliberately deferred until the present version is tested.

## Priority 1 — Field-test the current build, then freeze a stable commit

Test on MacBook with built-in/Shokz microphones and on iPhone. Verify wake detection by both engines, Go/Stop thresholds, pause from silence/button/headset/wake, spoken cue ordering and failure behavior, double beep continuing during pause, timer sweep and disappearance, command timeout, manual fallback, microphone release, and no spurious command activation. Check recording playback and recoverability after a forced reload. Capture reproducible failures with steps and observed states; avoid speculative refactoring.

## Priority 2 — Targeted architecture audit

Review the latest authoritative code for: single-owner microphone acquisition and disposal; any temporary global `getUserMedia` interception by the TensorFlow adapter; races between pause/stop, spoken playback, command-window generation, and manual/headset actions; stale callbacks; queue backpressure and IndexedDB transaction durability; actual microphone-status accuracy; cleanup after failures. Recognition must never block or invalidate durable capture. Make only narrowly justified changes and repeat affected tests.

## Priority 3 — Idle wake listening (not yet authorized for implementation)

When Audio commands is enabled and the app is foregrounded, allow a wake phrase before the first button press, respond “Yes?”, then interpret Go as starting a **new** recording (with “New recording” state cue) and Stop/timeout as returning to idle. Explicitly design the handoff from listening-only microphone to recording without duplicate streams or gaps; release microphone when commands are disabled. Do not promise reliable iPhone background/locked-screen operation.

## Priority 4 — Memora integration

Use the active `iMuse Memora integration handoff.md` to map the current Memora import/Transcribe interfaces and iMuse session/export interfaces. Preserve source recordings and recoverable sessions, avoid duplicate model/file-picker infrastructure, and test completed plus interrupted recordings end-to-end.

## Deferred

Custom universal “Hey iMuse” model, reversible removal of spoken commands from exported audio, native Swift/Android development, iPhone headset media buttons, broad media-remux redesign, and speculative storage migration. Reconsider only with evidence or an explicit product decision.

## Working rules

User supplies latest source files before changes. Only changed files are delivered, in a ZIP with original filenames and paths. Remove temporary diagnostics. The chronological design journal retains historical experiments; archived checklists and plans are not current implementation instructions.
