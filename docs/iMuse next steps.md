# iMuse next steps

**Updated:** 30 October 2026  
**Status:** Current action plan; supersedes earlier priority lists without erasing historical journal entries. This plan does not itself authorize edits to production code.

## Goal and decision

Build one unified iMuse application using Memora as the technical foundation, with tabs **Record → Transcribe → Edit and Combine → Search**. Record remains independent of Whisper/transcription and retains incremental IndexedDB preservation, crash recovery, manual and inactivity pause/resume, completed-file export, and existing saved-session behavior. Reuse Memora's file import/save and transcription/model infrastructure. Preserve original audio after handoff.

**Decision from 30 October:** Stop broad standalone command-overlap experimentation and **proceed toward integrating Heed wake + TensorFlow Go/Stop commands into the current iMuse recorder**. The voice-control feature must be optional, modular, and incapable of compromising capture or recovery. No production code has been changed as part of this documentation update.

## Confirmed baseline (do not re-test generically without cause)

- Incremental IndexedDB chunk persistence; recovery after reload during a multi-part recording, including pauses; user accepts possible loss of a short uncommitted tail.
- Manual pause/resume; approximately five-second inactivity pause and paused-state audible cue; browser-aware M4A/AAC preference with supported fallback.
- Completed saved recordings remain available; new recording does not delete previous recordings; Delete Saved Session removes only the selected session and is hidden during active recording.
- Tested WebM export accepted by Memora; a recovered M4A was reportedly usable, but rigorous media-container certification is not established by this note.
- MacBook desktop opt-in headset controls are retained; iPhone headset controls disabled/deferred.
- Lab observations: MacBook TensorFlow overlap **0.75** performed very well; iPhone **0.90** improved Go response. Wake-word misses and occasional Stop misses remain. Heed threshold was varied, so no validated optimum exists. The temporary phrase is **Hey Doc**, not yet a trained **Hey iMuse** model.

## Priority 1 — Freeze checkpoint and inspect current code

1. User supplies **latest current** iMuse files and any Memora files needed for the interface; older attachments or this journal are not authoritative code.
2. Review recorder states, microphone acquisition, MediaRecorder pause/resume, IndexedDB write lifecycle, audio cues, current wake/Voicute path, Settings, desktop headset path, and Memora file-import handoff.
3. Identify existing abstractions to reuse; make a minimal, non-destructive integration plan. Commit stable baseline before changes. Avoid simultaneous broad refactoring.

## Priority 2 — Implement isolated voice control in stages

**Folder requirement:** place **all TensorFlow command code and related assets** in a dedicated subfolder, provisionally `js/voice/tensorflow/`. Keep wake-word adapter separate (`js/voice/wake/`) and voice-state coordination in `js/voice/`, subject to current repository layout. Do not scatter TensorFlow files into the project root or duplicate dependencies.

1. Introduce an optional voice-control setting, platform-aware overlap config (desktop starting point 0.75, iPhone starting point 0.90), conservative command thresholds (Go ~0.60, Stop ~0.85), and visible microphone/listening state. These are provisional values.
2. Implement one coordinated microphone/audio-input route if the existing code supports it. Keep Heed listening for wake and TensorFlow command listener inactive except in command mode; ensure loading/failure of either recognizer does not affect recording.
3. **First integrate paused state:** wake enters command mode; Go resumes the same session; Stop finalizes; timeout/failure leaves session paused. Test manual fallback.
4. **Then integrate active recording:** recognized wake pauses capture through the existing recorder API before command listening. Go resumes; Stop finalizes; timeout remains paused. Preserve all committed chunks.
5. **Finally add optional idle hands-free start:** when explicitly enabled and app is active, wake enters command mode; Go starts a new recording; Stop/timeout returns idle. Never claim iOS lock-screen or background operation.
6. Guard every asynchronous listener/callback with state/session-generation IDs. Tear down listeners on Stop, Delete, navigation, permission failure, and disable; prevent stale Go/Stop actions and duplicate finalization.
7. Keep desktop headset opt-in and mobile headset disabled; coordinate multiple control pathways through the same recorder state machine.

## Priority 3 — Narrow in-app acceptance tests

- Normal record → wake → Go → record → wake → Stop; manual pause/resume; auto-pause; command timeout and repeated wake.
- False wake during ordinary speech; missed wake on first attempt; deliberate repeated wake phrases; accidental Stop protection. Do not treat lab recognition counts as field accuracy rates.
- Recording playback, segment ordering, persisted chunk recovery after interruption, and valid output with recognition enabled. Compare against voice-control-disabled baseline for audible dropouts and interference.
- Real iPhone Safari/PWA microphone, foreground/screen state, model-loading, CPU/battery practicality, and device-specific overlap; MacBook Chrome regression.
- Audio cues do not pollute captured speech; microphone permission failure and offline/model load failure degrade to fully functional manual recording.
- Completed/recovered audio passes to Memora Transcribe without deleting IndexedDB originals. No new Whisper dependency in Record.

## Known limitation: command words in recorded audio

A recognized wake phrase can already have entered the recorder before pause. Earlier missed attempts (“Hey Doc” said repeatedly) will be saved as normal speech. The current architecture **does not solve that**. Never delete source audio to hide it. Consider reversible, timestamp/utterance-aligned exclusion in a later phase only after safe recognition and boundary testing. First-attempt wake reliability is important but must be balanced against false activations.

## Deferred, not blocking this integration

- Training and validating the eventual custom **Hey iMuse** model (required before production phrase switch, but temporary model can be used during integration).
- Automatic, reversible cleanup of wake/command speech in finalized audio.
- iPhone headset media-button experiments; native-app redesign; always-on locked-screen recording promises.
- Whisper-tiny command recognition (superseded as current preferred command path by TensorFlow Go/Stop).
- Speculative OPFS migration, wholesale media-remux refactor, redoing already accepted Delete/recovery tests, or parallel transcription in Record.

## Working method and next action

Request latest source files **before any edit**. Change one logical layer at a time; test on the actual device. Deliver only modified code files in a ZIP with their **true original filenames**, no numbered suffixes or parentheses inside the archive. Remove temporary diagnostics after acceptance. Documentation may be updated as integration discoveries warrant. See **DJ007** and **iMuse voice-control integration plan.md** for architecture, file layout, state transitions, safety and acceptance criteria.

**Next concrete action:** inspect the current iMuse source and agree the first small implementation change: a voice-control coordinator and isolated TensorFlow module, beginning with **paused → wake → Go/Stop**.
