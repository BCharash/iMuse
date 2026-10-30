# iMuse voice-control integration plan

**Date:** 30 October 2026  
**Status:** Implementation design for review against current source; not a claim that integration is complete

## 1. Architectural objective

Provide local, hands-free **start, pause, resume and stop** while preserving iMuse's primary responsibility: **durable, recoverable audio recording**. Two-stage recognition: temporary **Heed “Hey Doc”** wake phrase, then TensorFlow.js Speech Commands **Go** or **Stop**. Later substitute a separately trained/validated **“Hey iMuse”** wake model. Wake is an *attention event*, not an independent recording command. No Whisper inference is used in Record or in the command pathway.

## 2. Components and ownership

| Component | Responsibility | Must never do |
|---|---|---|
| Recorder/session service | Own capture, pause/resume, Stop, segment ordering, IndexedDB persistence and recovery | Depend on recognition model or command callback |
| Wake adapter (Heed) | Detect wake while enabled, report confidence/timing | Write/delete recording chunks or directly mutate recorder state |
| Command adapter (TensorFlow) | Recognize Go/Stop in a bounded command-mode window; expose confidence/timing | Start a recorder itself or run permanently during normal speech |
| Voice coordinator | Validate state, request pause, activate/deactivate listeners, route recognized commands through recorder public API | Bypass recorder lifecycle or assume commands are synchronous |
| UI/Settings | Explicit enable/disable, device settings, state indication, manual fallback | Report listening/recording if microphone or recorder has stopped |
| Memora Transcribe | Receive validated completed/recovered audio non-destructively | Be a prerequisite for Record or voice controls |

## 3. Proposed isolated file tree (adapt to latest code)

```text
js/
  voice/
    voice-controller.js          # small coordinator / state machine
    voice-settings.js            # defaults, validation, device overrides
    wake/
      heed-adapter.js             # wake model lifecycle and callbacks
      ...                        # wake-specific assets, if locally hosted
    tensorflow/
      commands-adapter.js        # speech-commands lifecycle
      commands-config.js         # labels, thresholds, overlap
      ...                        # any locally hosted TF assets / model files
```

**Requirement:** all TensorFlow-specific files and supporting assets remain **under `js/voice/tensorflow/`** or another single agreed TensorFlow-specific subfolder. No TF command scripts, model JSON/weights, or command-worker files in the application root. Third-party CDN modules may be imported from within the adapter if needed, but confirm privacy/offline/network behavior and hosting URL resolution. Do not copy the whole standalone HTML lab into production. Preserve the existing repository's naming conventions and import architecture after source inspection. Ensure GitHub Pages base-path-safe imports, model asset paths, and service-worker caching are tested.

## 4. State model

Distinguish **recording state** (`idle`, `starting`, `recording`, `pausing`, `paused`, `resuming`, `finalizing`, `completed`, `recoverable`, `error`) from **recognizer state** (`off`, `wake-listening`, `command-entering`, `command-listening`, `command-closing`, `error`). The recorder is authoritative. A recognized wake while recording requests pause; only after the recorder confirms paused may command listening begin. Existing automatic inactivity pause, manual controls, and desktop headset controls call the same recorder transitions.

| Recorder state | Wake recognized | Go after wake | Stop after wake | Timeout/error |
|---|---|---|---|---|
| Idle, voice-start enabled | Enter command mode | Start new session | Idle | Idle |
| Recording | Pause and enter command mode | Resume same session | Finalize same session | Stay paused |
| Paused | Enter command mode | Resume same session | Finalize same session | Stay paused |
| Starting/pausing/resuming/finalizing/error | Ignore or queue only under explicitly tested rules | No direct action | No direct action | Preserve authoritative recorder state |

The app must provide a way to re-arm wake listening after a command timeout while remaining paused. No automatic resume after timeout. A Stop is terminal for that session; Go cannot revive a finalized session. Start-from-idle is optional and requires an explicit user-enabled microphone/listening session; on iOS it is foreground-only unless actual testing establishes otherwise.

## 5. Audio graph and model lifecycle

Prefer one permissioned microphone stream feeding independent recording and detection branches. Avoid opening a second competing getUserMedia stream without a tested need. Avoid stopping the shared microphone tracks merely because the TensorFlow command listener stops. **Audit actual TF Speech Commands listen/stopListening behavior** and ensure it does not steal, stop, reconfigure, or independently compete with the recorder microphone. If the library internally owns its own microphone, test coexistence and consider a safe adapter or audio-source integration before enabling during recording. A successful standalone command lab does not prove the integrated mic graph is safe.

Warm models when appropriate without blocking the recorder. The command recognizer is inactive except for the bounded Go/Stop window; the wake recognizer is suspended during command listening to prevent competing triggers. On Go/Stop/timeout, stop command listening, cleanly reset the generation token, and resume wake listening only if voice mode remains enabled and the state allows it. Ensure TTS “Yes”, chimes and paused beeps do not overlap with captured speech or interfere with recognition; do not assume output is excluded from microphone capture.

## 6. Defaults and experimental evidence

- **MacBook Chrome**: provisional `overlapFactor = 0.75` (user described recognition as perfect in lab).
- **iPhone**: provisional `overlapFactor = 0.90` (Go recognition improved, with residual missed wake and Stop).
- **Go** threshold about `0.60`; **Stop** threshold about `0.85` to limit accidental finalization; **Heed** threshold adjustable and **not yet optimized**.
- Do not silently treat overlap 0.90 as best for every phone or 0.75 as best for every desktop. Provide a conservative fallback and configuration surface.
- Lab callback intervals: MacBook 0.50→0.75 median 643→257 ms; iPhone 0.75→0.90 median 540→104 ms. These are not controlled end-to-end speech latencies. Gaps across different-duration tests are not directly comparable.
- The iPhone sensitivity experiment involved many threshold changes; do not calculate a reliable wake false-negative rate from its raw marker/recognition totals.

## 7. Concurrency and failure handling

Use a monotonic **listener generation** and **session ID** for every wake/command episode. On any state change, invalidate stale callbacks. Disable duplicate Go/Stop events during an in-progress recorder transition. Await pause/stop/resume confirmation and IndexedDB writes as required by the recorder; command recognition must not bypass persistence. On model error, microphone error, permission denial, page suspension, or user disable: stop optional listeners, preserve existing recorder/session data, show a truthful status, and retain manual controls. Never promise that browser storage survives every crash or that iOS can listen while backgrounded/locked.

## 8. Recording contamination: known and unresolved

If Heed recognizes a wake word after it has been captured, that phrase may already be stored. If earlier wake attempts were missed, they will remain in the audio. The immediate safe implementation **does not remove these phrases**. Preserve original IndexedDB data unchanged. Future optional cleanup must be **reversible**, based on defensible utterance boundaries rather than fixed windows around delayed callbacks, and must not delete meaningful speech on a false trigger. Record cleanly when Go starts from idle; prevent Go/Stop audio from being appended after the successful pause, subject to actual mic/capture timing tests.

## 9. Phased implementation and acceptance gates

**Phase A — inspect and isolate:** user provides current iMuse and relevant Memora source; identify recorder API, existing Voicute/Heed code, shared stream constraints, current Settings, service-worker paths, and desktop headset path. Preserve stable commit. Introduce folders and a disabled-by-default adapter/coordinator, without changing existing recording behavior. Verify no regression with voice off.

**Phase B — paused-state commands:** when paused, recognize wake, enter bounded command mode, Go resumes, Stop finalizes, timeout stays paused. Confirm no duplicate listener and manual fallback. Verify both commands in desktop Chrome and iPhone Safari/PWA.

**Phase C — active-recording wake:** recognized wake requests pause; only after pause acknowledgment enable Go/Stop. Test normal speech, quiet speech, repeated missed wake attempts, false activations, recording gaps, chunk ordering, crash/reload recovery, and absence of automatic destructive cleanup.

**Phase D — optional idle start:** explicit opt-in listening in idle; wake → Go starts a new session, wake → Stop/timeout remains idle. Verify foreground permission and iOS lifecycle; never claim lock-screen operation without real-device proof.

**Phase E — unified Memora handoff:** verify completed/recovered recording, correct actual MIME/extension, session identity, and non-destructive import into Memora Transcribe; original audio remains stored. Voice-control failure must not affect this pathway.

**Phase F — custom wake phrase and polish:** obtain/train “Hey iMuse” model, test positive/negative trials across real devices and ordinary speech, tune threshold, remove temporary diagnostics, document known wake contamination and any later reversible cleanup design.

## 10. Tests not required before the first integration commit

No additional generic overlap sweep is needed now. Do not revisit previously unsuccessful iPhone headset-button experiments, replace the recorder storage architecture with OPFS, or add Whisper tiny to command recognition without evidence of a concrete need. Retest only the specific boundaries integration changes. The user supplies current source before every modification; return only changed files in a ZIP with original internal filenames.

## 11. Explicit open questions for source review

1. Does the current recorder's MediaRecorder pause/resume release or retain the shared microphone stream, and can Heed still listen while paused?
2. Does TensorFlow Speech Commands own an independent getUserMedia stream in this version? If so, can it coexist safely with active/recoverable capture on iPhone Safari?
3. How does the existing Voicute paused-state pathway need to be retired or adapted without creating two wake engines?
4. What command-mode timeout, re-arm behavior, and audible acknowledgment work best without false Stop or accidental audio capture?
5. How should per-device overlap settings be exposed and persisted without assuming UA detection is perfect?
6. How do existing GitHub Pages imports, service worker, and offline model caching map to the new subfolders?

**Decision:** Proceed with integration, answer these questions by reading the latest source and targeted in-app tests, and keep capture/recovery as the non-negotiable priority.
