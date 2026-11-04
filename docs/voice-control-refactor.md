# Voice-control stabilization and extraction

Updated 4 November 2026. This is the current plan for voice-control architecture. The user authorized **tests and documentation only** and requested notice before any production code change. No controller extraction, deployed-build change, microphone change or model-tuning change is authorized by this document.

## Current checkpoint

`tests/test_voice_control.py` adds nine test methods against existing production source. The suite executes the command-coordination block and `finalizeRecording()` from `js/recorder.js`, its real pause-event body and manual Record/Stop handlers, plus the complete `js/tensorflow/commands-adapter.js` module in a separate fixture. Dependencies such as playback, model calls, timers, MediaRecorder and metadata storage are controlled fakes; the coordination under test is not a reimplementation.

All **37 repository test methods** pass across nine suites. Production files are unchanged at this checkpoint. There is no browser/device retest requirement for adding these tests and documents; device acceptance becomes necessary when production behavior or ownership changes.

These are characterization tests: they capture the behavior to retain during extraction. They do not prove that every possible race is handled or that current models recognize real speech accurately.

## Ownership to preserve

| Owner | Responsibilities |
| --- | --- |
| Recorder | Session identity, MediaRecorder state transitions, capture microphone lifetime, ordered writes, protective stops and finalization |
| Existing store/recovery/library modules | Durable audio, structural checks, recovery, saved-player UI and deletion |
| Proposed voice controller | Command state/generation, model readiness, prompt/listener sequencing, command windows and requests for recording actions |
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

## Ordered changes requiring separate approval

1. **Command-controller extraction.** Move command-window state, generation guards, countdown presentation, prompt coordination and Go/Stop/Yes/No sequencing together behind a small interface. Keep model versions, thresholds, prompt files, timeout semantics and the existing audio graph unchanged. Recorder operations remain recorder-owned; manual buttons and recognized commands use the same guarded operations. Adapt tests to import the extracted implementation and continue exercising the recorder integration.
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
