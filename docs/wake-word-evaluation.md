# Wake-word evaluation and offline recorder lab

Updated 4 November 2026. This guide owns wake-model evidence and lab use. Production ownership/refactoring lives in the [voice-control plan](voice-control-refactor.md); future transcription lives in the [native proposal](iMuse%20Swift%20migration%20plan.md). The [detailed lab snapshot](Archive/recorder-lab-guide-2026-11-04.md) retains implementation history and experimental procedures.

## Current conclusions

- Heed/Voicute remain production wake engines; TensorFlow Go/Stop/Yes/No is a separate command stage.
- Prioritize dedicated wake models, phrase choice and measured parameters. Tiny's live verification was too slow and missed genuine phrases. Keep Whisper out of the production live path.
- Command diagnostics showed the user's intended Go/Stop scores at least 0.90 and unintended ones at most 0.88; the user raised the threshold. Preserve those settings. This limited observed separation is not a guaranteed cutoff across environments.
- Speech gating can reject nonspeech but not all unrelated conversation. Level gating cannot identify the speaker. Production wake-word minimum dBFS remains evaluation-only and does not filter activations.
- Next intended code work is behavior-preserving wake-detector extraction, described and approved before production edits. Model/DSP changes remain separate experiments.

## Evidence retained

Private archive `WakeLab-review-2026-11-04T08-04-54.824Z.json` contained 86 reviewed clips across three Heed runs: 12 activations (2 labeled true positive, 10 false positive) and 74 near-trigger clips (70 true negative, 4 false negative). Nine false activations were annotated faint background speech and one unrelated conversation. Separate noise-only observations are outside that archive.

The 2,121.5-second run had ten labeled false activations, about 17 per captured hour under those conditions. Median inference was 1.1 ms, 95th percentile 2.4 ms; input backlog median 21.25 ms, 95th percentile 40.38 ms. This does not indicate growing inference backlog. False-positive peak scores 0.761–0.962 overlapped positive peaks 0.920 and 0.957. Overlapping false-negative clips are not independent attempts. These are wake scores, distinct from the command scores above.

Later Tiny verification showed ASR errors and experimental limitations: strict matching rejects alternate spellings, checks see only preceding audio, and near-trigger inference can occupy the single lane before actual wakes. Warmed three-second checks took roughly 2.2–2.5 seconds in reviewed runs/checks. The user rejected that delay. Base accuracy/performance on iPhone remains untested.

### Build 11: user-reported genuine wake rejected by speech gate

The supplied diagnostics/review exports identify **2026-11-04 17:38:20.259 UTC**, event `1-4` in recording `05262e61-ec83-4672-bff9-164be24189e2`, at analysis time **22.208 s**. Heed scored **0.908794** (wake threshold **0.8**), but the preceding second's highest Silero score was **0.258482**, with zero blocks reaching the run's speech threshold **0.7**. The current block scored **0.004604**. The level gate was off; input level was **−22.34 dBFS**, transport lag **3 ms**, and no analysis gaps were logged. This would also fail the default 0.6 speech threshold. The user identifies the phrase as a clear genuine Hey Doc; treat the rejection as a false negative for the speech gate, not an incorrect Heed activation.

The review archive contains a complete **5 s**, mono **16 kHz** WAV with the event at **3 s**. An isolated Chrome/WASM replay using the same bundled model/runtime and the lab's unchanged **512-sample** input/state handling, starting with fresh recurrent state and aligned to the original frame boundaries, reached **0.948844** in the second before the trigger, with **10 blocks ≥ 0.7**. It therefore passed the same gate on the extracted clip. Local Tiny.en also transcribed the three seconds preceding the event as “Hey, Doc.”, corroborating phrase presence before the detector decision. This does **not** reproduce the live state: the clip begins 19.208 seconds into the run and omits the preceding audio. It rules out the claim that this clip necessarily needs a lower speech threshold, but does not establish the cause of the live rejection. Do not attribute it to an early trigger, a short phrase, or a broken integration without further evidence.

The older `@ricky0123/vad-web@0.0.27` wrapper omits the 64-sample audio context required by the [official Silero v5.1 wrapper](https://github.com/snakers4/silero-vad/blob/v5.1/src/silero_vad/utils_vad.py). An initial fresh-state 576-sample replay peaked at **0.996975**, with **26 blocks ≥ 0.7**. That isolated replay alone did not establish the cause because the unchanged method also passed when started from fresh state.

The subsequently supplied **42.858 s M4A** allowed full-sequence replay with the same bundled ONNX model/runtime. Decode at 48 kHz, apply the lab's resampler, and align the compressed audio to the original analysis clip (normalized waveform correlation **0.999961**, analysis start offset **0.238 s**). AAC audio is not bit-identical to the original analysis PCM, but the old path closely reproduces the live failure:

| Input at every 32 ms step | Peak speech score in second before original trigger | Blocks ≥ 0.7 | Gate result |
| --- | --- | --- | --- |
| Original live build .11 | 0.258482 | 0 | Rejected |
| Full-recording replay, old 512-only input | 0.259321 | 0 | Rejected |
| Full-recording replay, preceding 64 + new 512 samples | 0.997824 | 25 | Passed |

**Lab build .13 fixes this input-context omission.** Retain the trailing 64 samples separately from the recurrent `[2,1,128]` state and prefix them to each new 512-sample block. Reset both at recording starts, rate configuration and analysis gaps. The 64 samples are historical audio, so this adds no wait for future audio and does not advance clip timestamps. Model/runtime assets, wake threshold, speech threshold, gate decision rule and production code remain unchanged. Reevaluate both false accepts and false rejects on fresh runs; earlier lab gate results used the incorrect input contract and cannot establish performance of the corrected integration. This single example is not device-wide certification. Private audio and raw exports remain outside the repository.

### Build 14: genuine wake rejected with background music

The user supplied the full **105.834 s** recording and matching diagnostics/review exports for **2026-11-04 18:09:56.981 UTC**, event `1-6`, at analysis time **44.224 s**. This run used wake threshold **0.7**, speech threshold **0.6**, no level gate, and Whisper verification off. Heed scored **0.872094**; peak speech score **0.386257** left zero blocks above the speech threshold. Input level was **−21.47 dBFS**, processing **3.8 ms**, packet-to-result **4 ms**. The user reports a genuine Hey Doc with music playing in the background.

Full-recording Chrome/WASM replay with the corrected 64-sample context reproduced rejection: peak **0.378957**, zero blocks ≥ 0.6. The decoded/resampled M4A was aligned to the original analysis clip with normalized waveform correlation **0.999977** and analysis start offset **0.064 s**. The older incorrect 512-only input instead peaked at **0.683152** with two qualifying blocks, which supports that this exported run follows the corrected path rather than a stale older worker. Lossy audio replay is not bit-identical to the original live PCM.

Resetting recurrent state at the beginning of the same saved pre-trigger audio produced a peak of **0.994174**, with **16 blocks ≥ 0.6**. Thus the prior sequence/state materially affects the result; this survives the build .13 context fix. Music is a plausible contributing condition, but no music-removed comparison establishes it as the sole cause. No threshold, model or runtime change is justified solely from this example. Local Tiny transcribed the preceding audio as “Hey dogs”, further illustrating why strict ASR phrase matching is not a reliable substitute here.

An exploratory fresh-state recheck of the preceding three seconds, using existing 16 kHz analysis PCM and the bundled model in isolated local Chrome, passed on all 11 repetitions. First check: **48.74 ms**. Ten warmed repetitions: median **37.69 ms**, 95th percentile / maximum **42.90 ms**, minimum **36.60 ms**. These numbers measure the local replay loop, exclude dispatch/queueing and concurrent live capture/model contention, and do not certify end-to-end response time or other devices. A rejected-candidate fresh-state fallback is a possible **lab experiment**, not implemented behavior; compare false accepts as well as rescued genuine phrases before adopting it. Production remains unchanged. Raw audio/exports remain outside the repository.

### Offline speech-threshold comparison on the corrected build 14 run

Compared all **five actual wake candidates** in the 18:09:12 recording, holding the exported one-second history, two qualifying blocks and level-gate result fixed. Review and diagnostic exports contain identical histories. All 15 clip labels are still unreviewed; only the genuine phrase at **18:09:56.981** is established by the user's report. The other four candidates have unknown truth labels. Older build .11 scores are excluded because they used the incorrect input contract. Forty-five decisions across nine thresholds were cross-checked against the lab's actual `evaluateSpeechGate` helper.

| Speech threshold | Accepted candidates | Rejected candidates | Confirmed genuine phrase accepted? | Other decisions changed from 0.6 |
| --- | --- | --- | --- | --- |
| 0.6 | 3 | 2 | No | 0 |
| 0.5 | 3 | 2 | No | 0 |
| 0.4 | 3 | 2 | No | 0 |
| 0.35 | 3 | 2 | No | 0 |
| 0.3 | 4 | 1 | Yes | 0 |
| 0.25 | 4 | 1 | Yes | 0 |
| 0.2 | 5 | 0 | Yes | 1 |

The confirmed phrase has two-block support **0.340847** (the second-highest speech score), so 0.35 still fails despite the peak of 0.386257. The other rejected candidate at **18:09:20.182** has two-block support **0.210504**; 0.3 keeps it rejected while 0.2 accepts it. Its correctness is unknown. The three already accepted candidates have support above 0.92 and remain accepted throughout this sweep.

**Next focused experiment:** manually try speech threshold **0.3**, leaving the wake threshold, two-block rule and lookback unchanged, and label every actual candidate as well as intentional misses. This rescues the one confirmed false rejection without changing any other decision in this small sample, but does not establish false-positive rates or an optimal production threshold. Lowering the decision threshold requires no additional inference or audio wait. No default, runtime behavior or fresh-state fallback was changed by this offline comparison.

### Labeled export and overlapping near-trigger review

The later diagnostic export `RecorderLab-diagnostics-1793816807994.json` contains **all 15 review labels** for the same build .14 run. Its five actual candidates are **3 TP, 1 TN, 1 FN** under the original 0.6 gate. This supplies the previously missing ground truth; it supersedes the initial unreviewed-label limitation above. At speech threshold 0.3, those same candidates become **4 TP, 1 TN, 0 FP, 0 FN**. At 0.2 the correctly rejected candidate at 18:09:20 becomes an FP. Keep the one-second history and two-block rule fixed. This is one labeled run, not production validation.

Each actual candidate has a preceding near trigger **0.096–0.320 s** earlier, so their five-second clips substantially overlap. Four near triggers labeled FN lead to an eventual actual trigger containing the same phrase; those rows should not be counted as separate misses in the comparison. A standalone near trigger at **18:10:22.069** is labeled FN despite strong speech evidence; lowering the speech threshold cannot rescue an attempt that never produced a wake candidate. Across ten observations after linking the five preceding near triggers, the original gate yields **3 TP / 0 FP / 5 TN / 2 FN**; threshold 0.3 yields **4 TP / 0 FP / 5 TN / 1 FN**. Sampled TN observations are not continuous-time negatives.

Build .15 presents review cards with Play and classification together, wrapping scores/timing beneath them to avoid per-clip horizontal scrolling. Accepted candidates offer unreviewed/TP/FP; rejected candidates and other non-accepted samples offer unreviewed/TN/FN. Existing incompatible labels are retained, with a prompt to choose a result-appropriate label. Near triggers within one second before an actual candidate in the same recording are linked by sample time (analysis seconds fallback), hidden by default and excluded from comparison counts. **Show near triggers linked to actual triggers** reveals the raw rows for review; exports and saved audio/labels retain all events. This is a temporal grouping heuristic, not a claim that every overlapping clip is the same utterance. No trigger threshold, model or detector behavior changed.

## Current lab

Hosted **lab.html**, build **2026-11-04.15**, is separate from production recording. No API key/cloud inference is used.

| Mode/control | Purpose |
| --- | --- |
| Filename suggestions | Tiny.en q8 transcribes up to 15 seconds after Stop; date/time prefix remains and the user applies/edits the suffix |
| Speech-gated wake testing | Heed/Voicute with optional Silero speech/minimum-level gates; default wake action marks detection |
| Live analysis unchecked | Native MediaRecorder baseline without detector worker/analysis context; manual titles |
| Compare with Whisper verification | Retained shadow experiment; slow and rejected for production use |
| Prepare offline models | Cache roughly 79 MiB bundled assets and prepare Tiny; verify offline reload in the same browser |

Full recordings use browser-supported compressed audio, preferably AAC/M4A. Review clips use 16 kHz WAV from the analysis path, normally three seconds before and two after each event. Playback is blocked during recording. The earlier comparison lab's compressed MP3 review path is a different implementation.

Live analysis uses AudioWorklet, bounded queues and continuous anti-alias resampling; recording uses its separate native MediaRecorder branch. The current lab allows filename inference to overlap a new recording. **That experimental behavior does not satisfy the production requirement that recording always has priority.** No scheduler change is included here.

Data lives in **imuse-simple-recorder-lab**, separate from production. Incremental chunks support recovery after reload; failed final saves retain memory audio until closure. Abruptly interrupted containers may be incomplete. Starting another recording retains earlier entries. Per-recording deletion and Clear all lab recordings require confirmation and remove this lab's audio/reviews. Export before deletion or browser/app storage removal.

## Practical evaluation

1. Prepare models. Select Speech-gated wake testing, Mark detection, and leave Whisper verification off. Initially disable the level gate to isolate speech gating.
2. Test deliberate phrases at normal distance, quiet/noise, conversation and soundalikes. Compare speech gate on/off in separate runs. Record microphone, settings, environment and observation duration.
3. Triggers and sampled near triggers collect clips. Mark missed phrases promptly; Capture negative sample adds a reviewed non-wake example. Stop and label actual speech through playback: TP/FP/FN/TN. Short/overlapping clips need caution.
4. Export **review audio + labels** for portable clips/annotations and diagnostics for scores, gates and timing. Diagnostic JSON alone has no audio. Reload to verify saved playback/labels.
5. Compare false activations per observed hour, independent phrase misses and response delay. Sampled clips do not establish whole-session accuracy; validate changes on held-out examples.

Reboot resolved the earlier Mac-wide microphone failure, which also affected production. No Safari codec cause was established. An unmoving input meter calls for checking OS/device capture before changing detection. The earlier review whine has no established acoustic cause. Desktop checks do not certify iPhone speed or cure installed-PWA microphone suspension.

## Phrase and post-recording direction

Choose a distinctive phrase with varied sounds, uncommon in conversation and easy to repeat consistently. Discussed candidates: Hey iMuse, Hello iMuse, Okay iMuse, Muse Capture, Hey Memento. None is selected/validated. Current wake models use roughly one-second windows; a longer phrase requires matching training/preprocessing, not a display-name change. Collect intended pronunciations, distant conversation, soundalikes and hard negatives; test held-out examples and latency.

Compare Base/Tiny for post-recording naming/transcription. Whole-file wake cleanup needs validated timestamps and reversible derivatives; recognized text cannot guarantee exact audio cuts. Recording priority and model management are specified in the native proposal, rather than duplicated here.

## Maintenance and historical tools

Dependencies/licenses: [lab sources](../js/lab/SOURCES.md). The service worker scopes cover only lab.html and js/lab/. After lab code/assets change, run `python3 scripts/build-lab-manifest.py`; bump cache versions for pinned asset changes. Documentation-only edits need no regeneration.

The [previous comparison lab](Archive/wake-word-comparison-lab-2026-11-04.html) and [instructions](Archive/wake-word-review-notes-2026-11-04.md) preserve access to separate **imuse-wake-review-lab** storage. Keep its regression tests while retaining the tool. Private audio/Desktop JSON exports are not committed.

The **Wake tracking** panel and trigger review table are always visible, including in Filename mode, which explicitly reports that wake tracking is off. Choose **Use wake detector lab**, then **Record**; the panel reports active tracking once the analysis graph is connected. **Review trigger clips and classifications** jumps to the event table. Browsers restoring the task selector on navigation are reconciled with the panel visibility.

**Clear all logged data…** is available while stopped. After confirmation it clears current event history and removes saved review clips, labels, notes and Whisper verification results from all lab recordings in one transaction. It resets the comparison counters, retains full recordings and filename suggestions, and prevents late worker/verification results from restoring cleared reviews. Downloaded exports and the archived lab database are unaffected. A failed storage transaction keeps the existing in-memory results. **Clear displayed events** still only hides rows.

Build .14 displays **Processing ms** and **Packet → result ms** per event. The former is elapsed worker processing within the current packet; the latter includes delivery/queue wait plus that processing, so they overlap and must not be summed. Both preexisting fields remain in diagnostics/review exports. Missing values (for example manual marks) show a dash. Neither includes microphone/packet buffering, detector-window accumulation or audible-response onset, so these are not phrase-end-to-acknowledgement measurements.
