# Voice control: current architecture and validation

Updated 12 November 2026. Production source **2026-11-13.1**. Current validation and priorities are in the [index](README.md) and [next steps](iMuse%20next%20steps.md). Earlier build-by-build decisions remain in the [journal](design-journal.md).

## Startup and spoken prompts

All six spoken prompts fetch/decode at startup regardless of Audio commands. Playback uses complete cached buffers, selected gain, serial ordering and cancellation; media-element playback remains the fallback. Original WAV assets are retained. Audio prompt volume appears above its 220 px slider, without explanatory text or a recommendation label. It remains usable with commands off. Pointer release previews Yes immediately; keyboard changes debounce for 150 ms. Further adjustment cancels the prior preview. Recording playback and reminder beeps are separate.

Wake loading is skipped while Audio commands is off. Enabling prepares the selected model; settings changes do not duplicate pending loads, and ready models survive off/on toggles. Heed is first/default with threshold 0.75; saved choices/tuning remain. Silero and command preparation respect their settings. Enabled-model preparation can still block UI interaction. The ONNX proxy experiment was excluded after transferred feature buffers broke repeated inference; no worker or runtime change remains.

The user confirmed the iPhone Yes/preview correction. Other buffered messages require device acceptance. The intermittent post-update menu issue is currently absent and was not reproduced with single emulated touches. Menu logic is unchanged.

## State-specific Silero speech checking

**Implemented candidate: production build 2026-11-11.1.** User requested production integration on 11 November. Device/acoustic acceptance remains pending; existing lab observations do not certify the new production path.

Voice commands Settings includes a separate rounded **Speech detection — Silero** group. **Evaluate speech during recording** defaults off; **Evaluate speech during pause** defaults on. Both off bypass speech checking. These preferences respect the existing Audio commands switch. The main Silero group sits last, below voice command recognition, with the two state switches. Advanced voice settings exposes speech threshold (0.10–0.95, default 0.60), minimum qualifying 32 ms blocks (1–6, default 2), and lookback (250–2,000 ms, default 1,000 ms). Minimum blocks need not be consecutive; they must lie in the lookback window. Settings persist without resetting existing wake/command tuning. Build 2026-11-11.4 shows the recommended value in parentheses beside each Silero control. No restore button is present; changing preferences remains manual.

Silero checks speech evidence only before accepting a Heed/Voicute wake candidate in a selected recording state. Speech alone never resumes capture. Go/Stop/Yes/No, pause confirmation, RMS silence pause and microphone ownership are unchanged. The candidate is checked against the speech packet captured with that wake evaluation; later audio does not retrospectively validate it. The request is discarded if session, recording state, arming generation, settings epoch or voice-action ownership becomes stale.

When Audio commands and either speech option are enabled, the separate worker loads the existing pinned local Silero v5 model/runtime and performs one silent warm-up frame. It stays loaded across state changes and recording sessions, but receives live microphone samples only during enabled states. Preparing the model does not acquire a microphone or block Record. No fresh-state candidate replay is added. Continuous model state is maintained within each enabled listening interval; pause/resume, settings changes, cleanup and delivery gaps reset speech history/context without reloading the model. No deliberate transition wait is inserted. The two-block minimum requires at least 64 ms of qualifying audio, not a guaranteed 64 ms detection latency.

The existing normalized microphone tap feeds the speech worker independently of the scaled wake ring. Anti-alias resampling produces 16 kHz blocks of 512 new samples with 64 historical context samples, and the recurrent state is separate from the lab. At most four audio packets are outstanding; overload terminates queued worker work instead of growing a backlog. Preparation has a 45-second deadline; packet work has a 250 ms deadline and stale-result check. Loading/unavailability bypasses the speech restriction and is shown in the speech status. Invalidated in-flight wake checks are discarded; subsequent normal wake recognition remains available. Failed workers can be retried at the next recording or Settings change. Manual capture never depends on Silero readiness.

Advanced diagnostics records a `speech-gate` event for each completed current candidate decision: state, pass/reject, threshold, qualifying blocks/peak, lookback, and bypass reason when applicable. This adds no raw audio logging or persistent speech history.

Automated verification: 116 methods across sixteen suites. An isolated Chrome check used the real local ONNX/WASM model to reject digital silence and accept a bundled spoken prompt, confirmed zero microphone requests during preparation/UI changes, and checked the Settings layout at 390 and 880 pixels. This is wiring/model execution evidence, not false-positive/negative rates, iPhone performance, screen-lock capture or microphone/device acceptance.

Focused device checks: enable Audio commands; verify paused defaults and ready status; record without speech gating, pause and deliberately say the wake phrase, then complete the usual command sequence. Test both engines, both state switches, both switches off, immediate post-pause phrases, suspension, repeated pause/resume and starting/stopping another recording. Confirm recorded audio/export remains intact. Observe threshold/decision diagnostics during quiet, noise, conversation and intended phrases before changing defaults. The separate lab remains available for detailed labeling/comparison.

## Ownership to preserve

| Owner | Responsibilities |
| --- | --- |
| `js/recorder.js` | Original microphone/MediaRecorder, recording transitions, shared audio graph, silence/meter observation, three-second wake ring, session/busy guards, rearming timers, readiness/status, storage/finalization and spoken-response playback |
| `js/wake-detector.js` | Existing adapter selection/loading and engine-specific window extraction, resampling and inference/detection calls; receives a buffer view and live callbacks, not the mutable recording session |
| `js/voice-controller.js` | Command state/generation, model preload, prompt/listener sequencing, countdown, Go/Stop/Yes/No and guarded requests through recorder-owned session capabilities |
| `js/speech-detection.js`, `speech-detection-worker.js`, `speech-detection-core.js` | Warmed speech model/worker, bounded packet lifecycle, streaming resampling/context and speech evidence decisions; no microphone or recorder ownership |
| Existing adapters | Heed/Voicute model/DSP behavior; TensorFlow borrows a clone of the recording track and releases the clone on shutdown |
| Store/recovery/library | Existing durable audio, recovery, finalization outcomes, saved playback and deletion boundaries |

The command controller cannot replace MediaRecorder, release the original microphone or mutate storage. The wake module has no microphone, DOM or timer ownership. Recorder reset/threshold updates still use the original adapter. Preserve the existing interface instead of moving audio ownership as incidental cleanup.

## Wake-detector characterization checkpoint

Tests exercise the actual recorder callback, loading/settings integration, extracted evaluator, adapters and real Heed filters/mel preprocessing with controlled model outputs. They cover sample representation, ring boundaries, insufficient input, cadence/busy skips, reset/rearm, thresholds/cooldowns, failures and asynchronous validity. They do not execute the production ONNX models or downloaded Voicute implementation, certify native scheduling, or measure real recognition accuracy/latency.

The recorder's 2,048-sample ScriptProcessor callback fills a three-second ring with floats scaled by 32767. Heed receives the latest 2,048 samples at the context rate; its adapter normalizes/resamples and accumulates 1,600-sample frames at 16 kHz, processing at most one frame per consume call. Voicute requests its input length and receives resampled, still-int16-scale floats. Busy evaluations are skipped; later work uses the latest window without replaying skipped windows. Voicute's adapter configures 2,000 ms internally and routing passes 1,500 ms to `detect()`; their combination remains library behavior, not a tuning change made by this refactor.

### Loader-only extraction

`loadWakeDetector({engineName, threshold, onStatus})` selects the unchanged Heed/Voicute adapter and returns its promise directly. It adds no cache or async wrapper. The recorder owns readiness, threshold selection, progress/error presentation and rearming. The user reported this first step behaved normally.

### Inference-routing extraction

`evaluateWakeDetector()` handles window extraction, existing Voicute resampling and both inference paths. Live callbacks keep session/threshold checks current after awaits. Trigger/error callbacks remain recorder-owned; completion clears that operation's busy flag inside `finally`, at the original point in the callback sequence. This stage shipped as build 2026-11-05.2 before the separately approved fixes below.

### Wake race corrections

Accepted build **2026-11-05.3** adds these protections:

- Each model-loading request has a page-local generation. Only the latest may install a model or publish progress/failure, including Heed → Voicute → Heed. When loading completes, apply the latest threshold setting, including for cached models.
- Clear/rearm advances the session's wake generation. Cancelled timer callbacks cannot arm detection or erase a newer timer reference.
- Both engines require the original session, detector, engine, load generation and arm generation still to match after inference. The session must not be discarded; audio commands and detection must be enabled; capture must be recording or paused.
- Stale results and errors are ignored. A current inference failure still disables detection and reports manual controls. Completion releases its own session's busy flag without touching a newer session.

These checks add no deliberate wait or extra model inference. They do not forcibly cancel in-flight work; a pending operation retains its own busy flag until it finishes. Tests that documented unwanted behavior now assert the corrected outcomes. The [archived checkpoint](Archive/voice-control-history-2026-11-05.md) retains the original observations and staged validation.

## Unified audio-command preference and grouped Settings

The main Suspend/Resume audio commands button mirrors the Settings Audio commands checkbox. Both update the same persisted preference and remain usable during capture; changing the preference does not stop MediaRecorder. Turning commands off closes command listening and disarms wake actions. Turning them on prepares/arms recognition through the existing loading and session guards. The former temporary page-only suspension is not exposed as a separate user function.

The status directly below Microphone says Audio commands enabled — “Hey iMuse” (or the selected Voicute phrase) or Audio commands disabled. The old detailed wake-status node is hidden from the main screen; diagnostics retain technical evidence. Main button hover/active colors preserve readable text.

Settings retains Microphone, Voice commands and Storage categories and their Advanced areas. Prompt volume remains usable with commands off. Microphone-processing changes still apply to a subsequent recording. The preservation failure test remains off by default under Advanced storage settings. Switching away from the microphone-level disclosure stops its temporary check, not actual recording.

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

Preserve these current timing semantics: Go/Stop computes its expiry before awaiting listener startup; Yes/No starts its countdown after listener startup completes. These are currently different. Normalizing them would be a separate behavior change, not part of extraction.

The adapter test also confirms that non-audio getUserMedia requests retain the original route. It does not establish safety for every concurrent microphone request or multiple recognizer instances. The temporary override remains a documented integration boundary, not a target for simultaneous redesign.

## Investigating intermittent Stop confirmations

Earlier unsolicited confirmations were reported on MacBook Live Server and iPhone. Their acoustic cause and a suspected command-extraction regression were not established. A controlled before/after comparison accepted and rejected identical scores alike; that does not measure real false-activation rates. The accepted wake refactor/race fixes do not establish that unrelated classifier false positives are eliminated.

Stop still accepts one winning score at or above the configured threshold, without a separate speech gate or consecutive-score requirement. The user's sample placed intended Go/Stop scores at least 0.90 and unintended ones at most 0.88; they raised the threshold. Preserve their settings rather than restoring the earlier 0.70 value. This is limited tuning evidence, not a universal cutoff.

### Using Advanced diagnostics

Build 2026-11-11.5 separates **Voice recognition results** (up to 30 summarized listening periods) from **Detailed voice diagnostics** (up to 500 individual events). Each section has independently scoped Show/Hide, Copy and Download controls. Copy and Download use the same formatted rows as that section's display and produce readable text; the detail section additionally offers Download JSON for the full structured snapshot and environment metadata. The structured export can contain more history than the 30-row results view. Each button group sits directly below its section title/explanation. Both views start hidden; visibility does not change collection. One **Clear all voice diagnostics** action clears the shared underlying history and both views. Clipboard failures offer Download as the fallback. No audio is logged.

Recording stopped follows capture-stop confirmation independently of saving. Capture analysis/listening shut down; the microphone remains through the announcement and is released afterward, with an eight-second cancellation deadline. New Recording waits for microphone cleanup and storage ownership. Saving failure is a separate notice. See [recording reliability](recording-investigation.md#iphone-stop-announcement-output-regression).

Open Settings → Voice commands → Advanced voice settings. Voice recognition results summarize listening periods; Detailed voice diagnostics shows individual events. Each view has scoped Show/Hide, Copy and Download controls. Clear all voice diagnostics clears their shared history, without affecting recordings. Collection defaults on each page load; views start hidden. Disabling collection retains existing data; reload clears it. Export before leaving the page.

`js/voice-diagnostics.js` keeps the latest **500 events** in page memory, with no persistent browser storage or raw audio. The detailed table can show all 500 retained events; the summary shows the latest 30 listening windows represented by those events. Export reports dropped events. A window can be partial when older events roll off or collection is toggled. A small clean sample cannot establish absence of an intermittent regression.

Events include the winning label/score and Go/Stop/Yes/No scores, effective thresholds, requested settings, elapsed/remaining listening time, session/window/generation identifiers, model readiness, prompt start/end/error, listener start/readiness/shutdown, timeout and accepted commands. The adapter now supplies its already-computed winning score as additional metadata; classifier filtering, overlap, deadlines and action conditions remain unchanged. Prediction decision time is sampled before logging so observer work does not redefine that callback's deadline test. No PCM, spectrogram, recording Blob or transcript is collected. Browser identity, diagnostic schema/code version and the current page’s `appBuild` are included at export; see the [build guide](build-versioning.md) for cache-consistency limits.

Diagnostic callbacks perform no storage transactions or extra audio connections. State-boundary updates refresh the readable view only while Advanced and Settings are visible; prediction events do not repaint it. The viewer has no polling timer. Observation still has processing overhead and cannot establish the acoustic cause without further evidence. The recorder's saved-audio diagnostics remain separate.

## Acceptance after a production extraction

The user accepted build 2026-11-05.3. For future changes, use a short recording on MacBook and the supported iPhone Safari-tab route to check:

- Manual recording, pause/resume, Stop, playback and a second recording while retaining the first.
- Wake while recording/paused; Go; Stop with Yes, No and timeout; spoken prompts and paused reminders.
- Manual Stop during command startup, followed promptly by another recording.
- Turn Audio commands off/on from either main button or Settings during capture and pause; verify matching preference/status, preserved capture and no stale command action.
- Settings categories, preference locking, processing/diagnostic placement and saved audio playback/export.

Record build, device/browser, microphone and failed scenario. Add a headset check when microphone/listener ownership changes. The unspecified device details of the successful user check remain unspecified; the iPhone installed-app background-capture issue is separate and unresolved.

## Deferred work and limits

Asset fingerprinting remains deferred: conventional generated content-hashed assets and an automated deployment build, preserving readable source filenames. It has not been implemented or authorized by this documentation update. The [build guide](build-versioning.md) owns that scope.

Silero now provides the state-specific production gate above; keep fresh-Silero replay and Whisper outside production wake verification. AudioWorklet migration changes audio delivery and needs independent validation. Naming/transcription/cleanup run only outside active recording sessions and yield to Record, including pause/startup/finalization; no production scheduler exists. Retain source audio and reversible derivatives. See [wake evaluation](wake-word-evaluation.md), [native/transcription requirements](iMuse%20Swift%20migration%20plan.md#recording-has-absolute-priority) and the [active queue](iMuse%20next%20steps.md).
