# Voice-control stabilization and extraction

Updated 4 November 2026. This is the current plan for voice-control architecture. After the initial tests/documentation checkpoint, the user reviewed and approved the **first command-controller extraction**. That extraction is implemented; device acceptance is pending. Wake detection, the audio graph, deployed-build work and model tuning are separate later changes requiring a new checkpoint.

## Current checkpoint

`js/voice-controller.js` now owns command state/generation, model preload, command countdown presentation, prompt/listener sequencing, and Go/Stop/Yes/No windows. `js/recorder.js` keeps capture, recording transitions, storage/finalization and spoken-response playback ownership. It supplies stable per-session capabilities with live identity/state getters and specific recording/reminder operations; the controller does not receive the mutable recorder session or storage internals. The borrowed stream remains available to the unchanged TensorFlow adapter.

`tests/test_voice_control.py` runs the complete controller with the real recorder bridge, `finalizeRecording()`, pause-event body and manual Record/Stop handlers. A separate fixture runs the complete TensorFlow adapter. Models, playback, timers, MediaRecorder and metadata storage remain controlled dependencies. Existing behavioral assertions were retained; two additional methods cover the narrow session interface and the existing Go/Stop versus Yes/No deadline distinction.

All **39 repository test methods** pass across nine suites. An isolated headless Chrome check loaded the production page/module, recorded, manually paused/resumed/stopped, then recorded again; both sessions retained nonempty chunks and completed status, with no runtime exceptions. It used a synthetic microphone, disposable profile and blocked CDN model downloads. It does not establish spoken-command accuracy or replace MacBook/iPhone device acceptance.

These are characterization tests: they capture the behavior to retain during extraction. They do not prove that every possible race is handled or that current models recognize real speech accurately.

## Ownership to preserve

| Owner | Responsibilities |
| --- | --- |
| Recorder | Session identity, MediaRecorder state transitions, capture microphone lifetime, ordered writes, protective stops and finalization |
| Existing store/recovery/library modules | Durable audio, structural checks, recovery, saved-player UI and deletion |
| Voice controller | Command state/generation, model readiness, prompt/listener sequencing, command windows and requests for recording actions |
| Existing audio-analysis setup, initially unchanged | Shared analysis context, silence monitoring, level observation and wake audio buffer |
| Future post-recording jobs | Naming/transcription/cleaned derivatives using retained audio; errors cannot redefine recording completion or destroy originals |

The proposed controller must use narrow recorder operations and a session-validity check. It must not own IndexedDB, the capture track, a second recording session, or original-audio deletion. Start with the smallest practical seam; avoid passing the entire recorder session as an unrestricted shared state bag. Any necessary borrowed state should be explicit.

## Protected behavior and automated evidence

| Scenario | Required existing behavior |
| --- | --- |
| Wake during recording | Pause once; wait for the pause announcement before opening recognition; duplicate wake does not open another window |
| Wake while paused | Play the acknowledgement before recognition; do not pause again |
| Manual or silence pause | Announce pause and maintain reminder/rearming; do not enter command recognition solely because of pause |
| Go or manual Resume | Await recognizer shutdown, then recheck session identity, recorder state and finalizing status before resuming |
| Spoken Stop | Remain paused and retain audio while awaiting confirmation |
| Confirmation | Stop Go/Stop listener, play confirmation prompt, then open Yes/No listener |
| Yes | Finalize once with explicit voice-confirmed intent; repeated callback does not stop again |
| No or confirmation timeout | Remain paused, retain audio and rearm wake detection |
| Command thresholds/timeout | Below-threshold scores do nothing; timeout closes the window without silently resuming |
| Manual Stop | No spoken confirmation; invalidates command work, including pending model/listener startup or confirmation |
| Replacement session | Late callbacks, completed acknowledgement or pending Resume cannot act on the new session after cancellation |
| Model/prompt/shutdown failure | Model failure and failed confirmation prompt cannot finalize audio; failed listener shutdown cannot resume; manual Stop remains usable |
| TensorFlow microphone adapter | Borrow a clone of the live recording track; do not acquire a new audio input; invalidate callbacks during pending startup; teardown releases the clone |
| Adapter failure/repeated calls | Restore the temporary global media override after successful/failed startup; reject duplicate startup; reject a dead original track; repeated shutdown is harmless |

Preserve current timing semantics during the move: Go/Stop computes its expiry before awaiting listener startup; Yes/No starts its countdown after listener startup completes. These are currently different. Normalizing them would be a separate behavior change, not part of extraction.

The adapter test also confirms that non-audio getUserMedia requests retain the original route. It does not establish safety for every concurrent microphone request or multiple recognizer instances. The temporary override remains a documented integration boundary, not a target for simultaneous redesign.

## Ordered changes and approval checkpoints

1. **Command-controller extraction — implemented; device acceptance pending.** Command-window state, generation guards, countdown presentation, prompt coordination and Go/Stop/Yes/No sequencing moved behind a small interface. Model versions, thresholds, prompt files, timeout semantics, TensorFlow adapter and the existing audio graph are unchanged. Recorder operations remain recorder-owned; manual buttons and recognized commands use the same guarded operations. Tests execute the complete extracted implementation and recorder integration.
2. **Wake-detector extraction.** Separately move model selection/loading and inference routing. Retain existing adapters, sample representation, buffering, cadence and trigger behavior. Establish adapter contract tests before changing those details.
3. **Production version identification.** Add visible deployed-build identity and a coherent asset-version strategy, without clearing storage. Version display alone is not evidence that imported modules match. Review any service-worker/deployment implications separately.
4. **Optional analysis ownership cleanup.** Only after the first boundaries are accepted, consider moving shared sample delivery, silence monitoring and meter observation. A ScriptProcessor-to-AudioWorklet migration is a distinct runtime change, not part of a file move.

The user should be informed of the specific proposed production change and validation before work begins. Each implementation should be independently reviewable and reversible, with no unrelated storage migration, capture retry, model replacement, prompt change or new feature bundled in.

## Acceptance after a production extraction

Run the complete repository suite. Then use a short recording on MacBook and the supported iPhone Safari-tab route to exercise:

- Manual recording, pause, resume, Stop, playback and a second recording without losing the first.
- Wake while recording and while paused; Go; Stop followed by Yes, No and timeout.
- Manual Stop while a command window is opening, followed by a new recording.
- Spoken prompts, pause reminders and actual saved audio, not just icons or recorder state.

Record deployed build, device/browser, microphone and any failed scenario. Add a headset check when microphone/listener ownership changes. The unresolved iPhone installed-app background issue remains a separate investigation; a file extraction must not be presented as its remedy.

## Deferred work and limits

The current lab's Whisper verification exceeds the desired live latency. It must not be introduced into the production wake path during cleanup. Custom wake-phrase training and parameter tuning remain separate experiments.

Future wake-phrase removal should scan the finished audio, use validated timestamps and produce reversible transcript/audio derivatives. It is not part of controller extraction. Likewise, future naming/transcription jobs must not delay safe audio persistence or mutate recording status when they fail.

No full state-machine rewrite, event bus, shared cross-project database, runtime unification or native migration is needed for this checkpoint. Keep the current interfaces small and address demonstrated coupling incrementally.
