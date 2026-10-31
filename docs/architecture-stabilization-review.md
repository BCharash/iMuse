> **Status update — 31 October 2026:** This document records an earlier code review of `iMuse(7).zip`, not an audit of the current build. Microphone selection and a shared spoken-response manager have since been introduced; Heed/Voicute and TensorFlow Go/Stop are integrated for active sessions. The historical findings below must **not** be presented as verified current defects. The remaining items are audit questions until checked against latest source and tested.

# iMuse architecture stabilization review

Baseline: iMuse(7).zip. Code review and plan, not a runtime-tested patch.

## Startup microphone finding

`recorder.js` unconditionally calls `initialize()`, `initializeWakeWord()`, and `initializeMicrophoneReadiness()` at module startup. The readiness function calls `getUserMedia({audio:true})` even when Audio commands is unchecked, tests a MediaRecorder, opens an AudioContext and attempts a chime. Its `finally` stops all stream tracks and closes the AudioContext. It does **not** start idle wake-word inference. The visible microphone label is set during acquisition but not reset after release. Thus a lit OS microphone indicator may be a transient startup capture, an incomplete/overlapping operation, or another application's stream; the label is not proof of a live track.

## Boundaries requiring correction

| Subsystem | Source observation | Target |
|---|---|---|
| Microphone | Readiness and `startRecording()` independently call `getUserMedia({audio:true})`; production has no verified Shokz input selector | One mic manager, explicit deviceId selection, track label/settings verification, cleanup and truthful UI |
| Wake engines | `initializeWakeWord` loads Heed/Voicute; recorder audio processing feeds inference only in active session | Engines report detection only; controller owns transitions |
| TensorFlow | `startCommands()` temporarily overrides global `navigator.mediaDevices.getUserMedia` to provide a cloned recording track | Serialized start/stop, explicit clone disposal and mic ownership; avoid global override if practical |
| Spoken responses | `sayResponse()` creates a new Audio per cue and swallows playback errors | Preload five WAVs, serialize responses, report playback outcome, start command timer after cue/fallback |
| Pause | Silence timer sets `pauseReason='silence'` and calls `recorder.pause()` | Only `WAKE_DETECTED` may enter Go/Stop command state; silence/manual pause never do |
| UI | `displayActiveMicrophone()` shows label but does not track release | Show Inactive / Checking / Listening / Recording plus verified device and errors |
| Durable capture | MediaRecorder, IndexedDB chunk writes, write queue, recovery and finalization coexist in recorder.js | Preserve these mechanisms and their tests; refactor orchestration around them |

## Independent state axes

Recording: idle / starting / recording / paused / finalizing / error.
Voice: disabled / wake-listening / acknowledging / command-starting / command-listening / stopping / error.
Microphone: inactive / acquiring / live-listening / live-recording / releasing / error.

Only `WAKE_DETECTED` enters command mode. While recording, pause and say “Pause”; while already paused, say “Yes?”. `SILENCE_TIMEOUT` may pause and say “Pause”, but never starts TensorFlow. Go resumes, Stop finalizes once, timeout returns to wake listening. Manual controls invalidate stale command callbacks. Use session/generation tokens to guard asynchronous transitions. Audio commands checkbox stays locked throughout an active session, including pause.

## Incremental delivery

**A — Mic ownership and status.** Centralize acquisition, release, selected input and verified track. Eliminate or defer unconditional startup capture when idle, or explicitly show Checking → Inactive. Compare Shokz selection to the proven lab. Preserve recording/IndexedDB code.

**B — Voice event controller.** Central wake event, explicit pause reasons, generation guards and deterministic command window. Keep Heed/Voicute/TensorFlow implementations in their respective folders.

**C — Response playback.** Preload five WAVs, serialize cues, handle failure visibly, and coordinate listening-window timing.

**D — Idle wake listening.** Only after A–C pass on MacBook and iPhone, acquire listening-only microphone when Audio commands is enabled, release when disabled, and hand off safely to durable recording.

## Test gates

Test on MacBook built-in and Shokz, and iPhone. Verify actual input track `label`, `getSettings().deviceId`, `readyState`, `muted`, active stream ownership, OS indicator, command state and pause reason. Test silence pause, manual pause, wake during record/pause, Go, Stop, timeout, repeated commands, device disconnect, and playback failures. Confirm IndexedDB recovery and final audio integrity. Remove temporary diagnostics after verification. Return only changed files in ZIPs with exact repository-relative filenames.

## Current audit checklist (31 October 2026)

1. Confirm whether any TensorFlow adapter still temporarily overrides global `navigator.mediaDevices.getUserMedia`; if so, test concurrent mic acquisition and teardown before refactoring.
2. Confirm microphone manager track ownership and UI state for System default/Shokz, built-in microphone, iPhone, command timeout, Stop, and errors.
3. Check session/generation guards and whether state announcements are emitted exactly once for successful transitions. Verify the new recording cue, pause cue, resume cue, stopped cue, and “Yes?” while already paused.
4. Verify the **paused double beep remains active** and the circular command timer is display-only (must not change recognition window timing).
5. Test durable IndexedDB writes, completed/recovered playback, and safe failure when wake/command/audio-response subsystems fail.
6. Defer idle wake microphone lifecycle until this targeted audit and field testing pass.

Archive this review after the outstanding questions are either resolved or transferred to a current issue list.
