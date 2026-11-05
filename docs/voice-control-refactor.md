# Voice control: current architecture and validation

Updated 5 November 2026. This is the current production reference. **Build 2026-11-05.3 is the accepted wake-word refactor and race-fix checkpoint:** the user tested it, reported it worked as expected and called it a success. Device/browser and individual acceptance scenarios were not specified; this does not certify every platform, environment or acoustic false-trigger rate. Detailed intermediate plans and test counts are [archived](Archive/voice-control-history-2026-11-05.md).

## Current checkpoint

Command coordination, wake-model loading and inference routing are extracted. The last implementation check passed **89 methods across thirteen suites**, including 26 wake methods; see the [tests guide](../tests/README.md). The user accepted stage one, stage two and the subsequent race fixes. Do not restart these completed extractions. AudioWorklet migration, Silero integration, model/DSP tuning and asset fingerprinting are separate work.

## Ownership to preserve

| Owner | Responsibilities |
| --- | --- |
| `js/recorder.js` | Original microphone/MediaRecorder, recording transitions, shared audio graph, silence/meter observation, three-second wake ring, session/busy guards, rearming timers, readiness/status, storage/finalization and spoken-response playback |
| `js/wake-detector.js` | Existing adapter selection/loading and engine-specific window extraction, resampling and inference/detection calls; receives a buffer view and live callbacks, not the mutable recording session |
| `js/voice-controller.js` | Command state/generation, model preload, prompt/listener sequencing, countdown, Go/Stop/Yes/No and guarded requests through recorder-owned session capabilities |
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

## Temporary suspension and grouped Settings

The persisted Audio commands checkbox remains locked during an active recording, including pause. A separate **Suspend audio commands / Resume audio commands** button beside Record/Stop appears when enabled. Suspension lasts for the page, survives another recording until resumed, resets when the preference is disabled and is not saved in localStorage. It suppresses voice actions while capture and wake analysis continue; it cancels pending command episodes and invalidates delayed voice Resume actions. Manual Pause/Resume/Stop remain available. A pause or prompt already initiated is not rolled back.

Settings has Microphone, Voice commands and Storage selectors with a shared selected-panel highlight and category-specific Advanced areas. Voice commands has a bold caption/On badge for the saved preference, separate from temporary suspension. While idle, status describes the preference/readiness for the next recording. Microphone processing is under Advanced microphone settings. Switching away stops hidden microphone previews/polling. The preservation test appears directly under Storage/Advanced, unchecked/off by default, and still requires explicit enablement plus an active qualifying recording.

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

1. Open **Settings → Voice commands → Advanced voice settings** for voice diagnostics. **Settings → Storage → Advanced storage settings** holds Recording and storage diagnostics plus the opt-in Recording preservation test. Voice diagnostics are checked by default on each load; failure testing remains off.
2. **Command attempts** appears directly when Advanced opens; there is no extra View button. One row describes a listening period and the command accepted, score/threshold and elapsed time. A Yes/No confirmation is a separate row. The summary counts recognized Go and Stop commands without claiming the speech was intentional.
3. **Detailed activity log** expands the individual score checks, prompts and listener lifecycle entries within those periods. This is many rows per attempt. Both views use the same retained log. Refresh view updates predictions received since the last state-boundary refresh.
4. Opening Settings or Advanced refreshes the display, including data captured while Settings was closed. A Diagnostics ready entry appears at startup to show that the collector is connected. Windows lacking session metadata are shown rather than silently discarded.
5. After an unsolicited prompt, use the displayed time/window to describe the incident. JSON download remains optional for detailed review. Download before reloading or closing if evidence needs to be kept.
6. Clear diagnostics removes only the log and readable rows; recordings, settings and active voice commands are unaffected. Unchecking collection retains existing data for viewing/export. Reload clears the prior log and enables a new one.

`js/voice-diagnostics.js` keeps the latest **500 events** in page memory, with no persistent browser storage or raw audio. The detailed table can show all 500 retained events; the summary shows the latest 30 listening windows represented by those events. Export reports dropped events. A window can be partial when older events roll off or collection is toggled. A small clean sample cannot establish absence of an intermittent regression.

Events include the winning label/score and Go/Stop/Yes/No scores, effective thresholds, requested settings, elapsed/remaining listening time, session/window/generation identifiers, model readiness, prompt start/end/error, listener start/readiness/shutdown, timeout and accepted commands. The adapter now supplies its already-computed winning score as additional metadata; classifier filtering, overlap, deadlines and action conditions remain unchanged. Prediction decision time is sampled before logging so observer work does not redefine that callback's deadline test. No PCM, spectrogram, recording Blob or transcript is collected. Browser identity, diagnostic schema/code version and the current page’s `appBuild` are included at export; see the [build guide](build-versioning.md) for cache-consistency limits.

Diagnostic callbacks perform no storage transactions or extra audio connections. State-boundary updates refresh the readable view only while Advanced and Settings are visible; prediction events do not repaint it. The viewer has no polling timer. Observation still has processing overhead and cannot establish the acoustic cause without further evidence. The recorder's saved-audio diagnostics remain separate.

## Acceptance after a production extraction

The user accepted build 2026-11-05.3. For future changes, use a short recording on MacBook and the supported iPhone Safari-tab route to check:

- Manual recording, pause/resume, Stop, playback and a second recording while retaining the first.
- Wake while recording/paused; Go; Stop with Yes, No and timeout; spoken prompts and paused reminders.
- Manual Stop during command startup, followed promptly by another recording.
- Suspension during normal capture, acknowledgement/confirmation and a quick Suspend/Resume; late words cannot act and manual controls remain usable.
- Settings categories, preference locking, processing/diagnostic placement and saved audio playback/export.

Record build, device/browser, microphone and failed scenario. Add a headset check when microphone/listener ownership changes. The unspecified device details of the successful user check remain unspecified; the iPhone installed-app background-capture issue is separate and unresolved.

## Deferred work and limits

Asset fingerprinting is the discussed next assessment: conventional generated content-hashed assets and an automated deployment build, preserving readable source filenames. It has not been implemented or authorized by this documentation update. The [build guide](build-versioning.md) owns that scope.

Keep Silero and Whisper outside production wake verification. AudioWorklet migration changes audio delivery and needs independent validation. Naming/transcription/cleanup run only outside active recording sessions and yield to Record, including pause/startup/finalization; no production scheduler exists. Retain source audio and reversible derivatives. See [wake evaluation](wake-word-evaluation.md), [native/transcription requirements](iMuse%20Swift%20migration%20plan.md#recording-has-absolute-priority) and the [active queue](iMuse%20next%20steps.md).
