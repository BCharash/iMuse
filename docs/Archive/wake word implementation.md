# Wake Word Implementation

**Project:** iMuse --- browser-based automatic pause/resume experiment\
**Document status:** Working notes from the standalone Voicute and Heed
experiments\
**Last updated:** 29 October 2026\
**Purpose:** Record what has been tested, what appears to work, the
current design, and what still needs validation before any wake-word
feature is incorporated into iMuse.

------------------------------------------------------------------------

## Current decision — 29 October 2026

This document is a **technical research archive**, not the current development queue. The pause-only Voicute wake workflow has progressed beyond the early standalone tests and is used in the current iMuse development path, subject to verification against the latest source. Automatic inactivity pause does not require a voice command. Keep wake inference disabled during active recording. Full voice-command recognition (proposed on-demand Whisper tiny) and continuous Voicute listening while recording are **deferred until after integration with Memora**. The public demo phrase is provisional. The A/B spectrum screening experiment showed 166 wake predictions during the enabled trial without reported inference errors, but did not establish identical acoustic fidelity or absence of dropouts. No further wake research is an immediate prerequisite for the Record/Memora integration.

The older statements below about 'not integrated into production' describe the status of the original standalone experiments and may no longer reflect the current iMuse prototype. The current next-steps document and design-journal DJ005 supersede them.

## 1. Objective

The intended iMuse experience is hands-free recording with automatic
pause during silence and automatic resume when the user says a wake
phrase.

The standalone Voicute test is implemented and its automatic
pause/beep/listen/resume loop has been exercised. It uses a public demo
wake-word model ("Hey Friday" when available, with "Hey Jarvis" as a
fallback); those are temporary stand-ins, not a custom iMuse model.

**No final iMuse wake phrase has been selected or validated.** "Go iMuse"
was considered in the Voicute notes. The broader design-journal candidate
list also includes "iMuse," "Hey iMuse," and "Ready iMuse?" A custom model
for any of these phrases has not yet been trained or validated.

The main goals are:

-   Preserve the user's speech in a recording without requiring manual
    pause/resume.
-   Pause after a sustained period of silence.
-   Play an audible beep when automatic pause occurs.
-   Run wake-word inference only while recording is paused.
-   Resume recording when a wake phrase is detected, then turn wake-word
    inference off again.
-   Keep the audio capture and detector local in the browser during
    inference, avoiding a per-use cloud wake-word service fee if
    feasible.
-   Reduce false wake-ups caused by ordinary speech or background audio.

The Heed and Voicute experiments are **implemented as standalone test
pages**, not integrated into production iMuse. The core experimental loop
is no longer a task to implement from scratch. The remaining work is
comparative evaluation of false activations and missed detections,
confirming the exact model loaded, and deciding whether a custom phrase
model is worthwhile. These experiments do not establish that the
production recording architecture is ready.

## 2. Intended state machine

The design should follow a simple, explicit cycle:

1.  **Recording active**
    -   The microphone stream is being recorded.
    -   Silence monitoring is active.
    -   Wake-word inference is off.
2.  **Five seconds of low audio level**
    -   If the measured audio remains below the silence threshold for
        five seconds, pause the recorder.
    -   Play a short beep.
    -   Prepare the wake-word detector.
3.  **Recording paused; detector active**
    -   The recorder remains paused.
    -   The detector analyses microphone audio for the wake phrase.
    -   Ordinary speech must not be enough to trigger resume; this is
        the principal unresolved quality issue.
4.  **Wake phrase accepted**
    -   Resume the recorder.
    -   Immediately disable wake-word inference.
    -   Reset the silence timer so the next pause is measured from the
        resumed recording.
5.  **Repeat**
    -   If the resumed recording again has five seconds of low audio
        level, pause and listen for the wake phrase again.

The detector should **not** run while recording is active. This reduces
unnecessary inference and avoids detecting the wake phrase in the middle
of the user's recorded speech.

Manual controls are useful for testing and recovery: start recording,
pause and listen now, resume manually, stop recording, and stop
everything.

## 3. Experiments completed

### 3.1 Heed standalone experiment

A separate Heed test was created before the Voicute experiment.

What was observed:

-   The automatic pause after approximately five seconds of silence
    worked.
-   The beep and pause/resume loop worked reasonably well.
-   The test shared the microphone between recording and detection.
-   The detector was intended to run only during paused intervals.
-   Wake-word detection was not perfectly reliable when sharing the
    microphone stream, but the overall loop was promising.

This established that the basic browser interaction pattern was
plausible. It did **not** establish that Voicute would behave the same
way or that the final "Go iMuse" model would be accurate.

### 3.2 Voicute public demo experiment

A separate page was then created to test Voicute's public demo model.
The current test file is named:

`iMuse-voicute-auto-pause-wake-word-test.html`

The test uses a browser-side ONNX runtime and Voicute's browser
wake-word engine, loaded from public CDN/GitHub-hosted resources. The
model and runtime need internet access on the first load. The test page
reports that inference is performed locally in the browser; it does not
intentionally send microphone audio to a wake-word inference server.

The page tries to load the public "Hey Friday" model metadata and asset.
If that load fails, it attempts to use the repository's current model
configuration as a fallback, which may load a different phrase such as
"Hey Jarvis." **Always read the model name shown by the page instead of
assuming which phrase is active.**

An early version of the Voicute test did not implement the five-second
auto-pause correctly. A JavaScript syntax issue was corrected in a later
version, and the page was subsequently reported to work. The
auto-pause/resume behaviour should still be retested after any later
code changes.

### 3.3 False detections and threshold experiments

The first Voicute testing produced too many false wake-ups: the detector
classified ordinary speech as the wake phrase. Increasing the UI
sensitivity setting to `0.8` did not adequately solve this.

The detection threshold was then expanded to include stricter values.
The user reported that the test was **"pretty good at .9"** and plans to
continue experimenting. This is the best result so far, but it is an
informal observation, not a measured false-accept rate.

Current practical conclusion:

-   `0.8` was not selective enough in the user's test conditions.
-   `0.9` appeared substantially better.
-   More testing is needed to learn whether `0.9` still catches the
    intended phrase reliably.
-   A high threshold may reduce false activations while also causing
    genuine wake phrases to be missed.
-   If ordinary speech continues to trigger at stricter thresholds,
    further threshold increases alone may not be the right solution.

## 4. Current Voicute test architecture

The current standalone page contains the following pieces.

### 4.1 External runtime and model

The page loads:

-   ONNX Runtime Web from jsDelivr.
-   Voicute's browser wake-word JavaScript from a GitHub CDN path.
-   Voicute model metadata and model assets from the public repository.

These are external dependencies. The test is not fully self-contained,
and its behaviour may change if the upstream branch, CDN assets,
runtime, or model files change. For repeatable testing, consider pinning
a known repository commit and runtime version once the model choice is
settled.

### 4.2 One microphone stream, separate processing branches

The page requests one microphone stream with `getUserMedia()`.

That stream is used directly by `MediaRecorder` for recording. A
separate Web Audio branch feeds microphone samples to the wake-word
model. This avoids opening a second microphone stream, which could
introduce device conflicts or inconsistent audio processing.

The audio-processing callback also estimates the input level for silence
detection. The detector's model inference is skipped unless the recorder
is paused and the detector is enabled.

### 4.3 Audio buffering and model input

The test keeps a rolling audio buffer and prepares a recent audio window
for Voicute inference. The code scales captured floating-point samples
into the range expected by the model and resamples when the browser
audio context's sample rate differs from 16 kHz.

This code is experimental and should be checked against the exact
Voicute SDK version in use. In particular, the expected window length,
sample scaling, resampling, and detector API need to remain consistent
with the upstream implementation.

### 4.4 Silence detection

The current test uses these constants:

-   Silence duration: **5,000 ms**.
-   RMS silence threshold: **0.012** in normalized floating-point audio
    (approximately −38 dBFS for a steady signal at that amplitude).

While recording is active, it calculates the root-mean-square (RMS)
amplitude of each audio-processing block. If the RMS remains below the
threshold for five seconds, the recorder is paused.

This is a level-based silence detector, not speech recognition. It may
be affected by room noise, microphone gain, ventilation, keyboard
sounds, or audio processing performed by the browser or operating
system. If the threshold is too high, quiet speech could be treated as
silence; if too low, background noise could prevent auto-pause.

The five-second interval and RMS threshold are separate from the
wake-word confidence threshold. Do not alter silence detection merely to
compensate for false wake-word detections.

### 4.5 Beep and detector activation

On pause, the page plays a short beep, waits briefly, resets the model's
inference state, and enables detection. The detector is disabled on
recorder resume.

The short delay helps keep the pause beep itself from being immediately
interpreted by the detector. Its effectiveness should be checked in
testing.

### 4.6 Recording output

The test uses `MediaRecorder` on the original microphone stream. It
collects the recorder's output chunks and creates a downloadable Blob
when recording stops. The file extension is selected based on the
reported media type.

Paused intervals are not included in the recording because the recorder
is paused during those intervals.

This is appropriate for a small experiment, but it should **not** be
mistaken for a complete production audio durability strategy. Production
iMuse has separate requirements around preserving captured audio, crash
recovery, and correctly finalizing a recording.

## 5. Threshold and filtering

### 5.1 Confidence threshold

The page exposes a selectable Voicute detection threshold. A stricter
threshold requires stronger model confidence before a detection is
accepted.

Values tested informally so far:

  -----------------------------------------------------------------------
  Threshold                           Observation
  ----------------------------------- -----------------------------------
  0.8                                 Too many false detections; ordinary
                                      speech was sometimes classified as
                                      the wake phrase.

  0.9                                 Reported as "pretty good"; more
                                      testing planned.

  0.85 and 0.95                       Added as additional experiment
                                      values; results not yet reported.
  -----------------------------------------------------------------------

These observations are specific to the current public demo model,
microphone, environment, and implementation. They do not establish a
universally correct threshold.

The current page passes the selected threshold into Voicute's detection
logic and also calls the engine's threshold setter when the control
changes. Nevertheless, the exact semantics should be verified against
the precise SDK version being loaded. A control labelled "threshold"
should represent the threshold actually used by the final detection
decision, not merely a visual or unrelated sensitivity setting.

### 5.2 Consecutive-frame filtering and cooldown

The page enables Voicute's L1 consecutive-frame filter and L3 cooldown
filter, and supplies a cooldown value to the detection call. The current
configuration is experimental; it is not proof that these filters alone
eliminate false positives.

A cooldown is useful for preventing repeated detections in a short
period, but it does not necessarily prevent the **first** false
detection of ordinary speech. The threshold and model discrimination
remain important.

A possible future safeguard is to require several positive model results
over a defined time window before resuming. This should only be added
after inspecting how the SDK's built-in filters work. Layering another
confirmation system on top of existing temporal filters without
understanding their semantics could increase latency or cause genuine
wake phrases to be missed.

## 6. What we have learned

1.  **The basic interaction is feasible in a browser.** The Heed
    experiment demonstrated a workable automatic
    pause/beep/listen/resume loop.
2.  **The pause/resume state machine and wake-word accuracy are separate
    problems.** The Voicute experiment eventually worked, but the main
    issue was false wake detections, not the concept of auto-pause
    itself.
3.  **Ordinary speech can be mistaken for the public demo wake phrase.**
    This was observed directly in testing.
4.  **A threshold of 0.9 currently looks more promising than 0.8.** It
    is an initial user observation, not a formal benchmark.
5.  **The public demo phrase is only a proxy.** Performance with "Hey
    Friday" or "Hey Jarvis" does not predict the performance of a custom
    "Go iMuse" model.
6.  **The detector should only run while recording is paused.** This
    remains a core design requirement.
7.  **Local browser inference appears possible without a per-detection
    server call.** The current experiment loads its runtime and model
    from external hosts, so initial network access and dependency
    availability are still required.
8.  **Production integration must not compromise audio durability.** The
    standalone page is a proof of concept, not a replacement for iMuse's
    recording and recovery design.

## 7. Historical evaluation plan (deferred)

The standalone test implementation is in place. The next work is to gather
comparable evidence, not to rebuild the pause/resume loop or add more
features before measuring the current detector.

### 7.1 Compare threshold values

Try 0.85, 0.90, and 0.95 in the same environment, if practical. At each
threshold:

1. Confirm the exact model name and phrase displayed by the page.
2. Pause recording so the detector is listening.
3. Speak several ordinary sentences without saying the wake phrase; count
   any false activation.
4. Say the displayed wake phrase several times at a normal speaking
   volume; count successful detections and misses.
5. Repeat in a quiet room and, if relevant, with typical background noise.
6. Keep the microphone position, speaking distance, model, and filters
   reasonably consistent between threshold tests.

The informal report that 0.9 was "pretty good" is a useful lead, not a
measured false-accept or miss rate.

### 7.2 Record trial results

For each run, note:

- Exact model name and phrase shown by the page.
- Threshold selected.
- Microphone and browser/device used.
- Number of ordinary-speech trials and false activations.
- Number of genuine wake-phrase attempts and successful detections.
- Whether the five-second silence pause and beep behaved as expected.
- Any detector errors or unexpected state transitions.

A simple trial log is more informative than a general impression alone.
Small samples can guide further experiments but cannot establish
production reliability.

### 7.3 Confirm the existing state machine

The test page already implements the intended loop. Verify that it still
behaves as expected after changes:

- Recording starts and wake inference is off.
- Five seconds of low audio level pauses recording and produces one beep.
- Wake inference activates only after the pause.
- An accepted wake phrase resumes recording and disables inference.
- Silence timing resets after resume.
- The next silence triggers another pause.
- Manual pause, manual resume, stop recording, and stop everything behave
  safely.

Do not alter several variables together. Tune the confidence threshold
separately from the silence threshold and keep the detector/model fixed
during threshold comparisons.

## 8. Longer-term options

### Option A --- Continue with the public demo model for experimentation

Advantages:

-   Fastest way to explore the interaction.
-   No need to train a custom phrase immediately.
-   Useful for validating the pause/resume state machine.

Limitations:

-   It recognises a phrase that is not the intended iMuse wake phrase.
-   False positives may remain unacceptable.
-   The model may be tuned for a different microphone or acoustic
    environment.
-   Public model assets and code may change unless versions are pinned.

### Option B --- Create a custom iMuse wake-phrase model

This may be worthwhile if the browser-based approach remains promising.
The phrase is not yet selected: "Go iMuse" is one candidate from the
Voicute notes, while "iMuse," "Hey iMuse," and "Ready iMuse?" are also
listed in the design journal.

Before committing, establish:

-   The training procedure and required positive/negative audio
    examples.
-   Whether the training pipeline supports the desired phrase and target
    language/accent.
-   How to evaluate false accepts from normal speech and background
    noise.
-   How to package and load the resulting model in the browser.
-   Model size, startup time, inference cost, and device compatibility.
-   Licensing and redistribution conditions for the training pipeline,
    runtime, and model assets.

A custom phrase may improve practical discrimination, but it is not
guaranteed to do so automatically. It needs a representative negative
test set and repeated evaluation.

### Option C --- Compare another detector

Heed was promising for the basic loop, while Voicute offers a different
model and configuration path. If the public Voicute model continues to
false-trigger, compare alternatives using the same test phrases,
microphone, environment, and trial log. Do not compare only on a
subjective "seems better" basis if a production choice depends on
reliability.

## 9. Production integration review criteria (historical checklist; verify against current code)

These criteria were written for the original standalone prototype. The newer pause-only iMuse development path is described at the beginning of this document; verify its actual implementation against current source files. Any further changes should be reviewed for:

-   **Recording durability:** preserve captured audio as it is created
    and make crash recovery as robust as browser storage permits.
-   **Correct finalization:** produce one valid final audio recording;
    do not assume arbitrary concatenation of media chunks produces a
    valid file.
-   **State management:** prevent duplicate timers, overlapping
    inference calls, and races between manual controls and automatic
    transitions.
-   **Microphone lifecycle:** handle permission denial, device changes,
    track termination, browser suspension, and audio-context
    interruption.
-   **False-activation policy:** define acceptable false-trigger and
    missed-trigger rates using actual trials.
-   **Privacy and network behaviour:** document external downloads and
    verify that microphone audio is not sent to a remote inference
    service.
-   **Fallback behaviour:** allow the user to resume manually if the
    detector fails or the model does not load.
-   **Resource use:** measure CPU, memory, battery, and latency on the
    actual target devices, including iPhone Safari.
-   **Dependency stability:** pin versions or otherwise control changes
    to runtime, model assets, and SDK behaviour.
-   **User experience:** make it clear when recording is active, paused,
    and listening for the wake phrase.

The detector should remain an optional convenience feature until its
reliability and failure modes are well understood. It must not be
allowed to jeopardize the primary job of recording the user's audio.

## 10. Historical standalone-prototype status (superseded)

**Historical status:** Standalone wake-word prototype implemented; evaluation and phrase selection remained open at that stage. This is not a statement about the current iMuse prototype. See the current decision at the top; verify current integration against source code.

- [x] Standalone Heed experiment demonstrated a workable pause/resume loop.
- [x] Voicute standalone test page implemented.
- [x] Five-second auto-pause and beep implemented in the test.
- [x] Wake-word inference is configured to run only while recording is paused.
- [x] Public demo model loading/fallback behavior and threshold controls are present.
- [x] False detections from ordinary speech identified.
- [x] Threshold 0.9 informally appeared better than 0.8 in the user's test conditions.
- [ ] Complete comparable false-activation and genuine-detection trials at 0.85, 0.90, and 0.95.
- [ ] Record the exact loaded model/phrase and results for each trial.
- [ ] Decide whether the public demo model is adequate for further prototyping.
- [ ] Select a final iMuse wake phrase and investigate training/obtaining a custom model.
- [ ] Validate resource use, microphone behavior, and lifecycle on target devices, especially iPhone Safari/PWA.
- [ ] Validate that any future integration cannot compromise audio persistence, recovery, or finalization.
- [ ] Historical gate: evaluate reliability before expanding production integration; not a current instruction to remove or rebuild the existing pause-only pathway.

------------------------------------------------------------------------

## Appendix A --- Current experimental settings

These values describe the current test page and should be verified
against the actual file before relying on them after future edits.

  -----------------------------------------------------------------------
  Setting                             Current value or behaviour
  ----------------------------------- -----------------------------------
  Silence duration                    5 seconds

  Silence detector                    RMS amplitude of audio-processing
                                      blocks

  RMS silence threshold               0.012 normalized amplitude
                                      (approximately −38 dBFS)

  Wake-word detector                  Voicute browser engine

  Intended public demo                "Hey Friday" when its model loads

  Fallback                            Repository model configuration,
                                      potentially "Hey Jarvis"

  Best observed threshold so far      0.9, based on informal user testing

  Other threshold trials              0.8 produced too many false
                                      detections; 0.85 and 0.95 still to
                                      evaluate

  Detector active state               Only while the recorder is paused

  Beep                                Short tone after pause

  Recording mechanism                 Browser `MediaRecorder` on the
                                      original microphone stream

  Model inference                     Browser-side ONNX inference

  Network dependency                  Runtime/model downloaded from
                                      external CDN/GitHub-hosted
                                      resources

  Production integration              Historical standalone-test status; verify current code
  -----------------------------------------------------------------------

## Appendix B --- Interpretation cautions

-   A confidence threshold is not a guarantee of a particular
    false-positive rate.
-   Results depend on the exact model, SDK version, microphone,
    environment, and audio pipeline.
-   A detector may report a high score for ordinary speech if its model
    confuses that speech with the target phrase.
-   Cooldown filtering reduces repeated detections but may not prevent
    the first false activation.
-   A custom wake phrase requires its own training and evaluation;
    performance cannot be inferred from "Hey Friday" or "Hey Jarvis."
-   Browser microphone capture, model inference, and recording may
    behave differently across desktop browsers and iOS Safari.
-   This document records the evidence currently available. Items not
    tested are explicitly left as open questions rather than treated as
    established facts.

## Appendix C — Future command-listener handoff (deferred)

The current wake-word detector recognizes a trigger phrase; it does not transcribe or interpret general spoken commands. A proposed future flow is wake-word detection followed by a bounded command-capture window, on-demand recognition through the unified Memora/Whisper infrastructure, command validation, and an explicit state-machine action. This is a design proposal, **not an implemented or validated command listener**. Do not run a second independent Whisper stack in the Record tab. Keep the original recording path and persisted audio independent of command inference, and always retain manual controls. The present pause-only policy disables wake inference during active recording; any future continuous-listening mode requires separate tests of resource contention, fidelity, and recording recovery.

The recent A/B spectrum screening used two different speech performances. The enabled trial reported 166 wake predictions without inference errors. It did not establish sample-identical audio, absence of dropouts, or causal spectral differences attributable to Voicute.
