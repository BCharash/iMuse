# Voice-control stabilization and extraction

Updated 5 November 2026. This is the current plan for voice-control architecture. After the initial tests/documentation checkpoint, the user reviewed and approved the **first command-controller extraction**. That extraction is implemented; diagnostics have since been used on real devices, but the full device acceptance matrix is not established. Following reports of intermittent unsolicited Stop confirmations, the user also approved diagnostics behind a collapsed Advanced section, subsequently requesting default-on collection capped at 500 events. The user subsequently tuned command thresholds using diagnostics and chose wake-detector extraction as the next intended refactor; describe its boundary and validation before production edits. Wake detection, the audio graph, deployed-build work and model tuning are separate later changes requiring a new checkpoint.

## Current checkpoint

`js/voice-controller.js` now owns command state/generation, model preload, command countdown presentation, prompt/listener sequencing, and Go/Stop/Yes/No windows. `js/recorder.js` keeps capture, recording transitions, storage/finalization and spoken-response playback ownership. It supplies stable per-session capabilities with live identity/state getters and specific recording/reminder operations; the controller does not receive the mutable recorder session or storage internals. The borrowed stream remains available to the unchanged TensorFlow adapter.

`tests/test_voice_control.py` runs the complete controller with the real recorder bridge, `finalizeRecording()`, pause-event body and manual Record/Stop handlers. A separate fixture runs the complete TensorFlow adapter. Models, playback, timers, MediaRecorder and metadata storage remain controlled dependencies. Existing behavioral assertions were retained; two additional methods cover the narrow session interface and the existing Go/Stop versus Yes/No deadline distinction.

All **57 repository test methods** pass across eleven suites. Voice lifecycle checks now run with diagnostics both off and on; focused checks cover bounded diagnostic memory, readable window summaries and controls. An isolated headless Chrome check loaded the production page/module, recorded, manually paused/resumed/stopped, then recorded again; both sessions retained nonempty chunks and completed status, with no runtime exceptions. It used a synthetic microphone, disposable profile and blocked CDN model downloads. It does not establish spoken-command accuracy or replace MacBook/iPhone device acceptance.

These are characterization tests: they capture the behavior to retain during extraction. They do not prove that every possible race is handled or that current models recognize real speech accurately.

## Wake-detector characterization checkpoint

On 5 November 2026 the user approved characterization of the existing production wake implementation before extraction. **No production code or model assets changed at that checkpoint.** `tests/test_wake_detector.py` added 17 methods; all **79 methods across thirteen suites passed**. Earlier counts in this document describe their dated checkpoints. The subsequent loader-only extraction is described below.

Coverage executes the real recorder audio callback, model initialization, settings handler, inference routing, buffer reset and rearming functions. It protects signed-int16-scale floats, chronological ring wraparound, insufficient input, both recording/paused states, 16/44.1/48 kHz routing, Voicute resampling and detect arguments, busy skips, failures and results arriving after session replacement/disarm. Adapter checks execute the complete Heed and Voicute loading/streaming implementations with controlled external dependencies. Separate Heed checks execute its real filters/mel preprocessing and trigger logic, including raw versus EMA scores, consecutive crossings, strict threshold/refractory boundaries, silence gating and reset.

Observed details to preserve during extraction:

- The recorder owns a three-second ring and a 2,048-sample ScriptProcessor callback. Heed receives the latest 2,048 samples and the original sample rate. Its adapter normalizes/resamples, accumulates 1,600-sample frames at 16 kHz and processes at most one frame per consume call. Voicute requests its window length and receives resampled, still-int16-scale floats.
- A busy inference skips incoming evaluation calls; the ring continues collecting. The next evaluation uses the latest window, without replaying skipped windows. These tests establish sample behavior, not measured wall-clock responsiveness under browser load.
- Voicute's adapter configures an internal 2,000 ms cooldown, while recorder routing passes 1,500 ms to `detect()`. Both existing values are characterized; this checkpoint does not establish how the downloaded library combines them.

The initial characterization recorded these async limitations. They were preserved during extraction, then corrected in the separately approved build 2026-11-05.3 described below:

- After an awaited inference, Heed rechecks enabled/current session identity but does not repeat Voicute's recording/paused state check. This test observes routing into the command callback; it does not establish a user-visible action under full recorder/controller cleanup.
- A rejected inference from an older session can still replace the shared status text after a newer session starts. The old failure does not disable the newer session in the exercised case.
- Model readiness compares the selected engine name, not a load-generation token. In a Heed → Voicute → Heed sequence, the first Heed load can overwrite the later Heed load.

These observations motivated a separate correction rather than a silent behavior change during extraction. Automated dependencies are controlled: no real microphone, ONNX inference, downloaded Voicute implementation, browser scheduling or device recognition accuracy is tested. The existing Mac/iPhone acceptance checklist remains required after a production change.

The implemented extraction puts adapter selection/loading and inference routing in `js/wake-detector.js`. It returns the original adapter/phrase and evaluates a caller-supplied buffer view with live validity checks; readiness, reset and threshold updates remain coordinated by the recorder through the original adapter. The recorder retains its microphone, graph, ring, session/busy guards, rearming timers and status UI; accepted results still enter the existing voice controller. Both extraction steps are described below. AudioWorklet migration remains a separate change: it would replace main-thread ScriptProcessor delivery, aggregate worklet blocks into the existing detector chunks and require independent lifecycle/timing/device validation.

### Loader-only extraction

The user subsequently approved **the first step only** on 5 November. `js/wake-detector.js` now exports `loadWakeDetector({engineName, threshold, onStatus})`, which selects the existing Heed/Voicute adapter and returns its promise directly. `recorder.js` imports this function instead of importing both adapters. Threshold selection, readiness/status updates, existing stale-load checks and rearming remain recorder-owned. The module adds no cache, async wrapper, microphone acquisition or inference work; the original adapter result, status callback and rejection are preserved.

The existing characterization assertions remained intact. Their fixtures execute the extracted loader along with recorder initialization; an additional method checks delegation, option/result/rejection identity, the unchanged non-Heed fallback and direct promise identity. **All 80 methods across thirteen suites passed at this checkpoint.** Production audio/inference code, adapters, models, thresholds and timers were unchanged. No device recognition or native browser timing acceptance was performed for this checkpoint. The user subsequently reported stage one seemed normal in their testing; device/browser and individual scenarios were not specified, so this does not close the full device checklist.

### Inference-routing extraction

The user approved stage two after their stage-one check. Production build **2026-11-05.2** moves window extraction, Voicute resampling and both engines' inference/detection calls into `evaluateWakeDetector()` in `js/wake-detector.js`. The recorder passes the original adapter engine, a ring/position/sample-count view, sample rate, live threshold getter and cooldown value. Live callbacks retain the engines' distinct enabled/current/listening checks; recorder callbacks still own trigger dispatch, error reporting and clearing the busy flag. Completion occurs inside the evaluator's `finally` block to preserve the original callback sequence, without deferring busy cleanup to another promise continuation.

The module does not receive the mutable recorder session, acquire audio, own a timer or update the DOM. All entry guards, buffer collection/reset, adapter reset/threshold changes, readiness, rearming and command actions remain in the recorder/controller. Models, sample scaling, window sizes, resampling math, cadence and cooldowns are unchanged. The three characterized async limitations remain explicit baseline behavior; none was silently fixed.

Existing characterization assertions pass through the extracted implementation. Two additional methods verify the standalone evaluator's live guards/threshold without recorder state, plus trigger/error/busy-clear ordering relative to the original inference promise. **All 83 methods across thirteen suites pass.** No native browser microphone/recognition test was performed for this stage. The next acceptance step is the existing Mac/iPhone checklist below using build **2026-11-05.2**. Asset fingerprinting, AudioWorklet migration, Silero integration and race corrections remain separate work.

### Wake race corrections

After reporting stage two looked good so far, the user separately approved fixes to the characterized async cases. **Build 2026-11-05.3** implements them. The user's report does not specify device/browser or close the full acceptance matrix.

- Every load request increments a page-local generation. Only the latest request may install a model, report progress or publish an error, including Heed → Voicute → Heed sequences. The accepted model receives the latest selected threshold after loading, including when an adapter reuses a cached model.
- Every clear/rearm invalidates the session's earlier wake generation. A queued callback from an old timer cannot arm detection or erase the newer timer reference. Current inference captures its session, detector object, selected engine, model-load generation and arm generation; after inference these must still match, the session must not be discarded, the preference/detection must remain enabled, and capture must be recording or paused. Both engines now apply this common validity rule.
- Outdated inference errors are ignored. Current failures still disable detection and show the manual-control fallback. Completion always releases its own session's busy flag, including for obsolete results, without changing a newer session's flag.

The tests that formerly asserted unwanted behavior now assert the corrected outcomes. Six additional methods cover disarm/rearm, cancelled timers, reused cached detector identity, old completion versus a new session's busy inference, rapid load success/error/progress ordering and threshold changes during load. **All 89 methods across thirteen suites pass**, including 26 wake methods. Tests first reproduced the defects on the previous implementation; they remain controlled JavaScript checks rather than native microphone/recognition certification.

No deliberate delay, extra inference or new model is added. In-flight inference is not forcibly cancelled; its stale result/error is ignored when it completes. A pending inference continues to hold its original busy flag until completion. Audio capture, buffering, DSP, threshold values, cooldowns and the audio graph are unchanged. The next device check should use **2026-11-05.3**, exercising normal wake/commands and manual Stop followed promptly by a new recording. Asset fingerprinting, AudioWorklet migration and Silero remain separate work.

## Temporary suspension and grouped Settings

Implemented 5 November 2026 at the user's request, independently of wake-detector extraction. The Audio commands checkbox remains a persisted preference and stays locked for the active recording session. A separate **Suspend audio commands / Resume audio commands** button beside Record/Stop is visible when that preference is enabled. Suspension is transient for the page; it survives starting another recording until resumed, is reset when the preference is disabled, and is not saved in localStorage.

Suspension blocks wake entry into recording/command actions. The microphone, MediaRecorder, wake analysis and loaded models remain in place; existing model versions/thresholds are unchanged. If a command episode is underway, the controller invalidates its generation, closes that optional command listener and rearms wake detection. A pending voice Go shutdown also carries a suspension generation so Suspend followed quickly by Resume cannot revive its old resume request. Manual Pause, Resume and Stop remain usable. A pause or spoken prompt already initiated before suspension is not rolled back; already paused audio remains paused. The continuously running detector can still hear wakes, but its actions are suppressed.

Settings now has labeled **Microphone**, **Voice commands** (speech-bubble/waveform icon), and **Storage** icon buttons in a rounded launcher. Selecting one reveals its group; selecting it again closes it. Microphone processing requests live under Advanced microphone settings; voice diagnostics under Advanced voice settings; storage diagnostics and failure testing under Advanced storage settings. Switching away from microphone settings stops hidden level polling and a temporary level check. Group changes do not modify stored settings.

Validation: **57 tests pass**, including suspension while recording, during acknowledgement/model startup/Yes-No confirmation/Go shutdown, quick Suspend/Resume, stale callbacks and manual-control independence. Isolated Chrome at a 390-pixel viewport opened all three categories without horizontal overflow, verified Advanced ownership, recorded → suspended voice actions while recording → manually paused → manually resumed → resumed voice actions → stopped, then recorded/stopped a second time. The saved Audio commands preference stayed enabled and no runtime exceptions occurred. Browser checks used a synthetic microphone and blocked external model downloads; real spoken-command recognition and Mac/iPhone Safari acceptance remain device checks.

Settings refinements on 5 November: Recording microphone has one visible heading and the selector retains an accessible label. The browser-reported Microphone processing report now sits with its processing requests under **Advanced microphone settings**, outside Microphone levels. All category selectors share the same shaded rounded highlight while open. Voice commands additionally has a bold caption and **On** badge whenever its saved preference is enabled, including while its panel is closed; this indicates the preference, not active recognition or the temporary suspension state. **Recording preservation test** is directly visible inside **Advanced storage settings**, without another disclosure. Failure testing remains unchecked/off by default and still requires its checkbox plus a qualifying active recording before the failure button can act.

While idle, the wake-status line describes Audio commands for the **next recording**, including disabled, enabled/preparing, enabled/available, enabled/unavailable and temporary suspension. Settings changes refresh it immediately without recording or opening microphone levels. Model loading progress/completion uses the latest preference, so delayed callbacks cannot restore a stale disabled/ready message; active command-window status remains separate. A regression check exercises the real settings handler and asynchronous wake-model setup. The complete current suite has **62 passing methods**.

## Focused acceptance for these controls

On Mac and the supported iPhone Safari-tab route, open each Settings category, confirm category-specific Advanced controls, enable Audio commands while idle, and start a short recording. Verify the preference stays locked but Suspend/Resume is usable. While suspended, deliberate wake phrases must not change recording state; manual Pause/Resume/Stop must still work. After resuming actions, test a new wake and normal Go/Stop/Yes/No flow. Suspend during a command/confirmation window and verify late words cannot act, including after a quick Resume. Play the resulting audio and make a second recording. Capture/storage ownership, model behavior and the separate lab are not redesigned here.

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

## Investigating intermittent Stop confirmations

After extraction the user reported unsolicited confirmation prompts in a quiet room, late in the command window, on MacBook Live Server and iPhone. A regression is suspected but not established. The extraction did not intentionally change the command model, microphone adapter, thresholds or acceptance rule. A controlled before/after comparison accepted and rejected identical late-window scores alike; that does not measure real acoustic false-activation rates.

The current command accepts one winning Stop prediction at or above the configured threshold; it has no separate speech gate or consecutive-prediction requirement. The earlier report used a 0.70 Stop threshold. Subsequently, readable diagnostics showed the user’s intentional Go/Stop decisions at 0.90 or above and unintended decisions at 0.88 or below; they raised the threshold. Preserve the current user setting rather than restoring that earlier value. This limited sample does not establish a universal cutoff or prove that an extraction regression occurred or was eliminated.

### Using Advanced diagnostics

1. Open **Settings → Voice commands → Advanced voice settings** for voice diagnostics. **Settings → Storage → Advanced storage settings** holds Recording and storage diagnostics plus the opt-in Recording preservation test. Voice diagnostics are checked by default on each load; failure testing remains off.
2. **Command attempts** appears directly when Advanced opens; there is no extra View button. One row describes a listening period and the command accepted, score/threshold and elapsed time. A Yes/No confirmation is a separate row. The summary counts recognized Go and Stop commands without claiming the speech was intentional.
3. **Detailed activity log** expands the individual score checks, prompts and listener lifecycle entries within those periods. This is many rows per attempt. Both views use the same retained log. Refresh view updates predictions received since the last state-boundary refresh.
4. Opening Settings or Advanced refreshes the display, including data captured while Settings was closed. A Diagnostics ready entry appears at startup to show that the collector is connected. Windows lacking session metadata are shown rather than silently discarded.
5. After an unsolicited prompt, use the displayed time/window to describe the incident. JSON download remains optional for detailed review. Download before reloading or closing if evidence needs to be kept.
6. Clear diagnostics removes only the log and readable rows; recordings, settings and active voice commands are unaffected. Unchecking collection retains existing data for viewing/export. Reload clears the prior log and enables a new one.

`js/voice-diagnostics.js` keeps the latest **500 events** in page memory, with no persistent browser storage or raw audio. The detailed table can show all 500 retained events; the summary shows the latest 30 listening windows represented by those events. Export reports dropped events. A window can be partial when older events roll off or collection is toggled. A small clean sample cannot establish absence of an intermittent regression.

Events include the winning label/score and Go/Stop/Yes/No scores, effective thresholds, requested settings, elapsed/remaining listening time, session/window/generation identifiers, model readiness, prompt start/end/error, listener start/readiness/shutdown, timeout and accepted commands. The adapter now supplies its already-computed winning score as additional metadata; classifier filtering, overlap, deadlines and action conditions remain unchanged. Prediction decision time is sampled before logging so observer work does not redefine that callback's deadline test. No PCM, spectrogram, recording Blob or transcript is collected. Browser identity and diagnostic schema/code version are included at export; this is not a coherent production asset-version system.

Diagnostic callbacks perform no storage transactions or extra audio connections. State-boundary updates refresh the readable view only while Advanced and Settings are visible; prediction events do not repaint it. The viewer has no polling timer. Observation still has processing overhead and cannot establish the acoustic cause without further evidence. The recorder's saved-audio diagnostics remain separate.

**Validation:** All 49 repository tests pass. Voice behavior checks run with collection disabled and enabled. An isolated Chrome check verified collapsed/default-on UI, zero microphone acquisition when enabling, readable summaries and event rows for synthetic command decisions, removal of the report indicator, actual JSON download, clearing, normal manual recording/pause/resume/Stop with two retained completed sessions, and default-on fresh state after reload. No runtime exceptions occurred. This does not reproduce the reported spontaneous recognition or certify iPhone behavior; subsequent user diagnostics informed threshold tuning as described above.

## Ordered changes and approval checkpoints

1. **Command-controller extraction — implemented; full device checklist remains open.** Command-window state, generation guards, countdown presentation, prompt coordination and Go/Stop/Yes/No sequencing moved behind a small interface. Model versions, thresholds, prompt files, timeout semantics, TensorFlow adapter and the existing audio graph are unchanged. Recorder operations remain recorder-owned; manual buttons and recognized commands use the same guarded operations. Tests execute the complete extracted implementation and recorder integration.
2. **Wake-detector extraction — loading and inference implemented; stage-two device acceptance pending.** Characterization preceded both stages. Existing adapters, sample representation, buffering, cadence, trigger behavior, analysis graph and recorder-owned microphone are retained. The user reported stage one seemed normal. Validate stage two before further architecture changes; tuning and AudioWorklet migration remain separate.
3. **Production version identification — display implemented; asset consistency pending.** The separately approved identifier uses `YYYY-MM-DD.N`, appears below the Settings selectors and is included in diagnostic exports. See the [numbering convention](build-versioning.md). The shared build module identifies the exporting page, not the capture build of older saved recordings. A coherent asset-version strategy remains separate work without clearing storage. Version display alone is not evidence that imported modules match. Review any service-worker/deployment implications separately.
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

Future wake-phrase removal should scan the finished audio, use validated timestamps and produce reversible transcript/audio derivatives. It is not part of controller extraction. Future naming/transcription runs only outside active recording sessions and yields to a Record request; paused sessions and preservation retain priority. See the [native/transcription proposal](iMuse%20Swift%20migration%20plan.md#recording-has-absolute-priority) for the agreed requirements. No production job scheduler is implemented.

No full state-machine rewrite, event bus, shared cross-project database, runtime unification or native migration is needed for this checkpoint. Keep the current interfaces small and address demonstrated coupling incrementally.

**Latest UI validation:** Controlled classifier callbacks through the actual extracted controller and unchanged TensorFlow adapter produced readable Stop, No and Go entries while Settings was initially closed. Isolated Chrome verified automatic collection without a checkbox click, refresh on opening, Advanced as the last Settings child, the rounded border, a strict 500-event cap in memory/export/display, JSON download/clear, and two completed retained recordings. The model was a test recognizer; this is not an acoustic false-trigger test.
