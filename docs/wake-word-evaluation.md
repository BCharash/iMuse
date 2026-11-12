# Wake-word evaluation and offline recorder lab

Updated 12 November 2026. This guide owns wake-model evidence and lab use. Production ownership/refactoring lives in the [voice-control plan](voice-control-refactor.md); future transcription lives in the [native proposal](iMuse%20Swift%20migration%20plan.md). The [detailed lab snapshot](Archive/recorder-lab-guide-2026-11-04.md) retains implementation history and experimental procedures.

## Hey iMuse model transition, 12 November

Current lab build 2026-11-12.1 uses the supplied medium Hey iMuse model, labels and default Heed threshold 0.75. The wake-mode and engine selectors use 0.75 for Heed and retain 0.90 for Voicute. Optional strict Whisper comparison now expects Hey iMuse. The lab cache advances to imuse-simple-lab-v2 to load the new weights. Saved recordings/reviews remain; all older Hey Doc measurements below describe the prior model and are not evidence of new-model accuracy. No queue, Silero gate, review decision or capture behavior was tuned.

## Current conclusions

- Heed/Voicute remain production wake engines; TensorFlow Go/Stop/Yes/No is a separate command stage.
- Prioritize dedicated wake models, phrase choice and measured parameters. Tiny's live verification was too slow and missed genuine phrases. Keep Whisper out of the production live path.
- Command diagnostics showed the user's intended Go/Stop scores at least 0.90 and unintended ones at most 0.88; the user raised the threshold. Preserve those settings. This limited observed separation is not a guaranteed cutoff across environments.
- Speech gating can reject nonspeech but not all unrelated conversation. Level gating cannot identify the speaker. Production wake-word minimum dBFS remains evaluation-only and does not filter activations.
- Production wake loading/inference extraction and the subsequent race fixes are complete and user-accepted in **build 2026-11-05.3**; see [current ownership and validation](voice-control-refactor.md). Production and lab build numbers are independent. Further model/DSP tuning remains separate; production Silero integration is implemented; the accepted refactor does not establish a new acoustic false-trigger rate.

## Evidence retained

Detailed replay measurements, labels and threshold comparisons are in the [historical evidence](Archive/wake-evaluation-evidence-2026-11-12.md). They explain the corrected Silero input contract and the limits of fresh-state replay; they do not certify Hey iMuse accuracy.

## Current lab

Local **lab.html**, build **2026-11-05.1**, is separate from production recording. No API key/cloud inference is used.

| Mode/control | Purpose |
| --- | --- |
| Filename suggestions | Tiny.en q8 transcribes up to 15 seconds after Stop; date/time prefix remains and the user applies/edits the suffix |
| Speech-gated wake testing | Heed/Voicute with optional Silero speech/minimum-level gates; default wake action marks detection |
| Live analysis unchecked | Native MediaRecorder baseline without detector worker/analysis context; manual titles |
| Compare fresh, detector-aligned Silero | Default-on report-only comparison at each actual candidate; separate worker, fresh state, shared review label/clip and measured added delay |
| Compare with Whisper verification | Retained shadow experiment; slow and rejected for production use |
| Prepare offline models | Cache roughly 79 MiB bundled assets and prepare Tiny; verify offline reload in the same browser |

Full recordings use browser-supported compressed audio, preferably AAC/M4A. Review clips use 16 kHz WAV from the analysis path, normally three seconds before and two after each event. Playback is blocked during recording. The earlier comparison lab's compressed MP3 review path is a different implementation.

Live analysis uses AudioWorklet, bounded queues and continuous anti-alias resampling; recording uses its separate native MediaRecorder branch. The current lab allows filename inference to overlap a new recording. **That experimental behavior does not satisfy the production requirement that recording always has priority.** No scheduler change is included here.

Data lives in **imuse-simple-recorder-lab**, separate from production. Incremental chunks support recovery after reload; failed final saves retain memory audio until closure. Abruptly interrupted containers may be incomplete. Starting another recording retains earlier entries. Per-recording deletion and Clear all lab recordings require confirmation and remove this lab's audio/reviews. Export before deletion or browser/app storage removal.

## Production integration boundary

On 11 November the user authorized state-specific production Silero checking. Candidate **2026-11-11.1** evaluates during pause by default, with recording evaluation off; its dedicated worker and Settings are described in [production speech checking](voice-control-refactor.md#state-specific-silero-speech-checking). It reuses the pinned local model/runtime and corrected audio contract, without importing lab orchestration, review rendering, queues or the fresh-comparison policy. No lab decision/default changed. Earlier “production unchanged” statements describe their dated experiments. Device/acoustic acceptance of production remains pending.

## Fresh, detector-aligned Silero comparison

Implemented locally in build **2026-11-05.1**, at the user's request. The current continuous speech gate still owns live acceptance and any configured Pause/Resume action. The new result is observational only and never changes the recorder. Only actual Heed/Voicute candidates are rechecked, including candidates rejected by the continuous gate; near triggers and manual samples do not consume the fresh lane.

- **Exact sample endpoint:** Heed may have up to 448 newer samples in its pending buffer when its 1600-sample step completes. Snapshot audio ending at `position - wakePending.length`, not at the later processing cursor or message arrival. Voicute ends at the last sample of the exact `audioSamplesNeeded()` input. Copy original normalized 16 kHz PCM before engine-specific filtering/scaling; never feed Silero Voicute's ×32767 copy.
- **Window:** Heed's nominal input plus the preceding consecutive prediction window(s), using its loaded metadata. Current 16000-sample/2-crossing model requests 17600 samples (1.1 s). Extend the left edge by 320 historical samples to process 35 complete 512-sample blocks: **1.12 s**, with no future-audio wait. Voicute uses its current input-window length, rounded on the left to complete blocks. The raw buffer normally retains three seconds; missing startup/gap history is explicitly incomplete, not zero-filled into a usable verdict.
- **Fresh state:** separate worker/model session, warmed before microphone acquisition. Reuse the loaded session but zero the `[2,1,128]` recurrent state and 64-sample audio context for every candidate. Carry both normally within the segment. Keep 32 ms fresh scores with absolute sample start/end, threshold and window bounds. The same two-block rule and final one-second lookback apply. Initial threshold remains **0.6**; user-selected values are snapshotted, not silently overwritten.
- **Continuous baseline:** the live gate is unchanged and uses its existing frame grid/history at the live analysis cursor. Its trace and the detector endpoint/lag are retained. Fresh blocks are aligned to the detector endpoint; up to 28 ms of Heed buffering and a different frame phase can contribute to differences alongside the state reset. This is a comparison of candidate checks, not a controlled proof that state alone caused every difference.
- **Scheduling/failure:** one fresh request at a time, no queue. Busy candidates are explicitly skipped. A ten-second deadline records a timeout but does not pretend the computing lane has become free; late results are identified. Worker errors, incomplete windows and unavailable preparation are visible without stopping continuous detection or recording. Separate workers avoid adding the replay to the live detector's serial queue, but CPU/memory contention can still affect live timing and produce logged analysis gaps.
- **Timing:** each card shows fresh processing time and total candidate-result-to-fresh-result delay, including snapshot/dispatch/worker work/return delivery. Dispatch-to-worker-start is also exported. Model preparation is excluded by warming before capture. This is potential added verification delay, not spoken-phrase-end-to-audible-response latency. The fresh check does not wait for the normal two-second review post-roll.
- **Review and storage:** one actual-action TP/FP/TN/FN label and existing five-second clip serve both methods. Paired summaries use only candidates with completed fresh checks and apply the speech/level gates to both, regardless of the live Require speech checkbox. Incomplete, skipped, error and pending checks remain outside paired denominators. Standalone detector misses remain in ordinary review; fresh checking cannot recover a wake that never became a candidate. Fresh status, timing, both traces and bounds persist with the recording and are included in diagnostics/review exports. Clearing/deleting logs invalidates late updates. Closing a page during a check restores it as interrupted.

Validation: **61 tests pass** across twelve suites, including exact sample endpoints and normalized amplitude for both engines, independent fresh state/context, frame traces/lookback, busy/timeout/error handling and protection against late updates after log clearing. An isolated 390-pixel Chrome check used synthetic microphone input and a marked synthetic candidate while running the real bundled fresh Silero worker. Its 35-block result rendered while recording continued; the shared label/clip and complete trace survived diagnostic export and reload with no runtime exceptions or horizontal overflow. This verifies wiring, not real speech accuracy, added-delay guarantees or iPhone acceptance. Production iMuse code is unchanged by this lab experiment.

### First comparison run

1. Stop and export any existing results, then use **Clear all logged data…** for a clean comparison; full recordings are retained.
2. Select **Speech-gated wake testing**, leave **Compare fresh, detector-aligned Silero** checked, **Mark detection** selected, Whisper verification off, minimum level gate off, and speech threshold **0.6**. Keep the chosen wake threshold fixed.
3. Start with a short quiet-room run containing deliberate wake phrases, then separate short music, conversation and noise runs. Include noise between ordinary spoken words. Mark intentional misses promptly.
4. Stop. On each actual candidate's card compare Continuous and Fresh pass/reject, peak, qualifying blocks and added milliseconds; expand **Speech scores by 32 ms block** when needed. Listen and label the one shared clip according to the actual action. Wait for pending fresh checks before exporting completed results.
5. Export both diagnostics and review audio + labels. Evaluate genuine phrases rescued versus false activations admitted on the same completed pairs before longer background runs or production decisions. Do not change the recording/pause policies or lower thresholds during this first comparison.

## First completed fresh comparison: music on the same MacBook

The user supplied `RecorderLab-review-1793887325850.json` and matching diagnostics `RecorderLab-diagnostics-1793887320502.json`, from **lab build 2026-11-05.2**, and reported music playing through QuickTime on the same MacBook. Both exports contain identical events/recording metadata. Recording ran **210.133 s** on 5 November, with Heed threshold **0.7**, required speech threshold **0.6**, level gate and Whisper off, and fresh comparison enabled. Echo cancellation and noise suppression were enabled; these results include that browser microphone processing.

There were **4 actual wake candidates**, all reviewed true positive, accepted by continuous Silero and also passed by fresh Silero. All four fresh results were complete, each using 35 blocks / **1.12 s** of historical audio ending exactly at the detector's consumed-sample endpoint. No fresh checks were skipped or incomplete, and no analysis gaps or storage errors were logged.

| Event | Continuous peak / qualifying blocks | Fresh peak / qualifying blocks | Candidate-to-fresh-result delay |
| --- | --- | --- | --- |
| 2-3 | 0.9992 / 21 | 0.9996 / 22 | 24 ms |
| 2-5 | 0.9964 / 13 | 0.9970 / 19 | 28 ms |
| 2-11 | 0.9876 / 12 | 0.9994 / 17 | 39 ms |
| 2-13 | 0.9844 / 13 | 0.9995 / 18 | 45 ms |

Median fresh delay was **33.5 ms**; worker processing ranged **20.0–26.9 ms**, median **21.9 ms**. Total delay includes dispatch/return overhead; these overlapping fields must not be added. This is measured comparison delay on this MacBook, not spoken-phrase-end-to-response latency or an iPhone guarantee. Fresh is still report-only.

Of **12 near-trigger clips**, 9 were labeled true negative; 8 of those had continuous speech peaks between **0.000143 and 0.02306**. They never became actual wake candidates and received no fresh check, so they cannot be counted as activations prevented by either gate. The three near clips labeled false negative precede accepted candidates by **0.192, 0.224 and 0.224 s** and are linked/excluded from independent comparison counts. These are consistent with the same phrase windows, not evidence of three independent missed attempts. One early negative clip has short pre-roll.

The run demonstrates completed, low-delay fresh checks retaining all four reviewed genuine candidates under these conditions. It contains no false-positive candidate and no continuous-gate rejection, so it cannot yet establish improved false-accept/false-reject discrimination or superiority over continuous evaluation. A targeted follow-up should include conditions that previously produced nuisance candidates or genuine gate rejections, keeping settings fixed. Private audio and raw exports remain outside the repository.

## All-negative background-speech comparison, 5 November

The user supplied `RecorderLab-review-1793891895087.json` and matching diagnostics `RecorderLab-diagnostics-1793891880251.json` from **lab build 2026-11-05.3**, stating that **no wake words were spoken anywhere in the run**. Use that run-wide ground truth for all candidates, including four without saved review labels; do not interpret an unannotated card as a genuine phrase. The user reported faint background speech and some audible Portuguese speech receiving low scores. Speech presence and wake-phrase presence are separate judgments.

The recording lasted **49 min 13.639 s**, with Heed threshold **0.7**, required speech threshold **0.6**, fresh comparison on, Whisper/level gate off, and echo cancellation/noise suppression on. Exports contain identical event/recording metadata: **23 actual candidates**, 124 sampled near triggers and 29,461 measurements. All actual candidates are false positives from Heed under the user's stated ground truth.

| Decision policy on the same 23 candidates | Unwanted activations accepted | Correctly rejected |
| --- | --- | --- |
| Raw Heed, without a speech gate | 23 | 0 |
| Continuous Silero, actual live gate | 15 | 8 |
| Fresh detector-aligned Silero, hypothetical replacement | 20 | 3 |

Continuous blocked **8/23 (34.8%)** nuisance candidates; fresh would block **3/23 (13.0%)**. Both passed 13, both rejected 1, fresh passed 7 that continuous rejected, and fresh rejected 2 that continuous passed. The latter are **1-66 and 1-128**. The seven fresh-only passes are **1-33, 1-59, 1-68, 1-78, 1-113, 1-118 and 1-122**. Thus replacing continuous with fresh would add five unwanted acceptances in this run. Requiring both to pass would accept 13, but this negative-only run cannot establish the effect of that stricter policy on genuine phrases.

For example, **1-113** is annotated audible unrelated speech: continuous peak **0.524** rejected it, while fresh peak **0.758**, seven qualifying blocks, passed it. That may improve speech detection while worsening wake filtering, because no wake phrase was spoken. Conversely, **1-66** had continuous peak **0.799** but fresh **0.409**, so fresh would reject an actual nuisance acceptance. The exports alone do not isolate Portuguese as the cause of any speech-score error, and a correct rejection of a non-wake is not a wake false negative merely because speech is audible.

All **23 fresh checks completed** with complete 35-block / **1.12 s** windows ending at the detector endpoint. All **46 continuous/fresh gate decisions**, peaks and qualifying-block counts were cross-checked against the actual lab gate helper. Fresh total delay ranged **30–248 ms**, median **74 ms**, with 95th percentile about **245 ms**. Worker processing was **13.7–24.5 ms**, median **15.9 ms**; dispatch-to-worker-start was 0–1 ms. Most of the longer end-to-end delay is therefore outside the measured fresh model loop, not evidence of slow Silero inference alone.

There were **20 analysis-queue-limit gap messages**, starting around 14:45:17 UTC. Fifteen review clips have short post-roll (six actual-candidate clips); all clips contain audio and no recording storage error was logged. Gaps affect analysis/review completeness and prevent treating this as uninterrupted whole-session accuracy certification. They do not by themselves prove a gap in the separately captured MediaRecorder audio. The code synchronously rebuilds review cards before dispatching fresh work and on review updates; profiling is needed to establish its contribution to delay/queue pressure before changing scheduling. No timing fix was made during this evaluation.

This run supports retaining continuous gating as the current baseline rather than switching to fresh-only confirmation. It cannot measure genuine-phrase recall because none were spoken. Before selecting a graded policy or a stricter combination, collect deliberate wake attempts mixed into the same background conditions and assess the lab's rendering/queue overhead separately. Higher speech sensitivity is not automatically better wake discrimination. Raw audio/exports and original review labels are unchanged and remain outside the repository.

## Deferred queue and fresh-latency investigation

On 5 November the user deferred this work because they could not do it then and requested documentation. **No scheduling, queue, model or recording-policy change is implemented by this note.** Resume as a separate lab experiment when requested; production iMuse remains outside its scope.

Baseline: the all-negative run above had a median **74 ms**, range **30–248 ms**, from Heed candidate to fresh result returning, despite median **15.9 ms** fresh worker processing. If fresh were mandatory confirmation, this measured interval would be additional decision delay after Heed's candidate, excluding prior audio/window accumulation and the later spoken response. Fresh remains observational in the current lab. The **20 gaps are twenty queue-limit occurrences, not a queue of twenty**: the existing limit is eight pending packets/acknowledgements. Incoming analysis packets are skipped at that limit. A busy main thread can delay audio forwarding and acknowledgement handling even if worker inference is fast; the gap messages alone do not isolate the cause.

Proposed resume sequence:

1. Record a baseline and separate the stages: candidate timestamp, fresh-audio arrival, dispatch, fresh worker start/end, main-thread result arrival and UI update. Measure main-thread render duration, queue occupancy and dropped analysis packets. Distinguish actual worker work from delayed delivery/acknowledgement handling.
2. Dispatch the fresh request before rendering its Checking state. Batch/coalesce review UI updates, avoid rebuilding unchanged cards and reduce review work during capture; retain final labels/clips, export fidelity and playback guards.
3. Hold models, thresholds, detector windows, queue limit and decision rules fixed. Repeat comparable short/long runs and report total/worker delay distributions, dropped packets, incomplete review clips, classification persistence and recording/playback outcomes. Preserve continuous ownership of live actions while evaluating.
4. If the queue still fills, separately evaluate a direct AudioWorklet-to-analysis-worker MessagePort route, retaining bounded flow control and lifecycle/generation guards. This is a later architectural option, not part of the initial UI scheduling change.

Do not first increase the queue size: that may trade dropped packets for longer detection latency. Do not claim a cause or improvement without measurements. A successful experiment should reduce avoidable delay/queue pressure without changing speech decisions or losing review data; no device-independent latency target is established. Only then consider graded recording/silence/pause gating, still report-only initially.

The motivation for fresh evaluation remains the **4 November 18:09:56 UTC genuine Hey Doc with music**: corrected continuous input scored **0.386** and rejected at **0.6**; a fresh-state replay of saved pre-trigger audio scored **0.994** and passed. The earlier **17:38:20 UTC** rejection also passed fresh replay, but that build had the subsequently fixed 64-sample-context omission. These were offline saved-audio experiments, including a three-second fresh recheck; they are not proof that the current live 1.12-second candidate check rescues those same cases. The completed live music comparison retained all four genuine candidates with both methods; the all-negative run admitted more nuisance candidates with fresh. A mixed run with deliberate wake phrases in the same troublesome background is still needed to measure the tradeoff.

## Practical evaluation

**Lab build 2026-11-05.3** keeps listening judgments in a fixed order: **Wake phrase heard** first (left, or above when stacked), **No wake phrase** second, then Clear label. The outcome-specific classifications change with acceptance: TP/FP for accepted triggers and FN/TN for rejected/non-trigger clips. Saved classification values and all Silero reporting/decisions are unchanged. Existing tests now verify the stable order for accepted, rejected, near-trigger and manual cards.

**Lab build 2026-11-05.2** makes review choices directly visible beside Play clip, replacing the classification dropdown. Accepted triggers offer **Wake phrase heard · True positive** and **No wake phrase · False positive**. Rejected/near/manual events offer **Wake phrase heard · False negative** and **No wake phrase · True negative**. Only those applicable outcomes are offered; Clear label restores unreviewed, and the selected classification is highlighted. The heading shows Accepted/Rejected/Near trigger and controls wrap inside the card. Labels describe the final gated outcome; the comparison independently derives the raw Heed/Voicute result from phrase presence. Older incompatible labels remain saved and are identified as Previous label until explicitly changed.

Validation: the existing review test now checks direct-button labels, persistence/highlighting, rejected and manual/near choices, Clear label, maintenance disabling and preservation of older labels. Isolated Chrome fixtures using the actual renderer and stylesheet at **320, 390 and 880 pixels** showed no page/card horizontal overflow and saved a rejected genuine phrase as false negative. These are review-layout checks, not microphone/model tests. The state-dependent recording/silence/pause policy remains unimplemented; fresh-versus-continuous comparison is unchanged. Production iMuse build numbering/code are unaffected.

1. Prepare models. Select Speech-gated wake testing, Mark detection, and leave Whisper verification off. Initially disable the level gate to isolate speech gating.
2. Test deliberate phrases at normal distance, quiet/noise, conversation and soundalikes. Compare speech gate on/off in separate runs. Record microphone, settings, environment and observation duration.
3. Triggers and sampled near triggers collect clips. Mark missed phrases promptly; Capture negative sample adds a reviewed non-wake example. Stop and label actual speech through playback: TP/FP/FN/TN. Short/overlapping clips need caution.
4. Export **review audio + labels** for portable clips/annotations and diagnostics for scores, gates and timing. Diagnostic JSON alone has no audio. Reload to verify saved playback/labels.
5. Compare false activations per observed hour, independent phrase misses and response delay. Sampled clips do not establish whole-session accuracy; validate changes on held-out examples.

Reboot resolved the earlier Mac-wide microphone failure, which also affected production. No Safari codec cause was established. An unmoving input meter calls for checking OS/device capture before changing detection. The earlier review whine has no established acoustic cause. Desktop checks do not certify iPhone speed or cure installed-PWA microphone suspension.

## Phrase and post-recording direction

Choose a distinctive phrase with varied sounds, uncommon in conversation and easy to repeat consistently. Hey iMuse is selected and integrated. Other phrases remain optional future training experiments; the older Hey Doc measurements do not establish current-model accuracy. Current wake models use roughly one-second windows; a longer phrase requires matching training/preprocessing, not a display-name change. Collect intended pronunciations, distant conversation, soundalikes and hard negatives; test held-out examples and latency.

Compare Base/Tiny for post-recording naming/transcription. Whole-file wake cleanup needs validated timestamps and reversible derivatives; recognized text cannot guarantee exact audio cuts. Recording priority and model management are specified in the native proposal, rather than duplicated here.

## Maintenance and historical tools

Dependencies/licenses: [lab sources](../js/lab/SOURCES.md). The service worker scopes cover only lab.html and js/lab/. After lab code/assets change, run `python3 scripts/build-lab-manifest.py`; bump cache versions for pinned asset changes. Documentation-only edits need no regeneration.

The [previous comparison lab](Archive/wake-word-comparison-lab-2026-11-04.html) and [instructions](Archive/wake-word-review-notes-2026-11-04.md) preserve access to separate **imuse-wake-review-lab** storage. Keep its regression tests while retaining the tool. Private audio/Desktop JSON exports are not committed.

The **Wake tracking** panel and trigger review table are always visible, including in Filename mode, which explicitly reports that wake tracking is off. Choose **Use wake detector lab**, then **Record**; the panel reports active tracking once the analysis graph is connected. **Review trigger clips and classifications** jumps to the event table. Browsers restoring the task selector on navigation are reconciled with the panel visibility.

**Clear all logged data…** is available while stopped. After confirmation it clears current event history and removes saved review clips, labels, notes and Whisper verification results from all lab recordings in one transaction. It resets the comparison counters, retains full recordings and filename suggestions, and prevents late worker/verification results from restoring cleared reviews. Downloaded exports and the archived lab database are unaffected. A failed storage transaction keeps the existing in-memory results. **Clear displayed events** still only hides rows.

Build .14 displays **Processing ms** and **Packet → result ms** per event. The former is elapsed worker processing within the current packet; the latter includes delivery/queue wait plus that processing, so they overlap and must not be summed. Both preexisting fields remain in diagnostics/review exports. Missing values (for example manual marks) show a dash. Neither includes microphone/packet buffering, detector-window accumulation or audible-response onset, so these are not phrase-end-to-acknowledgement measurements.
