# Wake-word audio review lab

`lab.html` is an enhanced copy of the user's Desktop `WakeWordComparisonLab.html`. The Desktop original and production capture code are unchanged. Open the repository copy locally in a browser that allows microphone access, or serve `/lab.html` from the usual HTTPS site after deployment. Internet access is required for runtime/model downloads. Browser storage belongs to the address/browser context; keep using the same address to find saved reviews.

## Comparison with iMuse

| Aspect | Supplied lab / enhanced lab | Production iMuse |
| --- | --- | --- |
| Heed model | Embedded Hey Doc model; SHA-256 `2635f8c007651c39a8f63d9f6834c65f85359b7361d99e2e5d0770fa9513aa01` | Identical model bytes in `js/heed/wake.onnx` |
| Heed detector | Embedded energy gate, scores and trigger class | Detector implementation matches the embedded class |
| Heed scheduling | Queues each resampled 100 ms frame; can accumulate inference backlog | Reads newest 2048 input samples; skips inference calls while busy, potentially omitting input |
| Voicute | Public Friday metadata override, ONNX Runtime 1.20.1; upstream engine/models loaded from changing `main` | Same loading approach and anti-trigger-layer selections; source is also unpinned |
| Voicute scheduling | Latest input window, approximately 130 ms between attempts | Attempts on audio callbacks when not busy |
| Processing defaults | AGC, noise suppression and echo cancellation initially off; changes applied on the live track | AGC off, suppression and echo cancellation on by default; preferences applied on acquisition |
| Detection response | Logs the event; capture continues without acknowledgement | Pauses an active recording and opens the spoken-command interaction |

Therefore a lab false-trigger rate is not automatically iMuse's rate. Match device, microphone, processing selections, model and threshold before comparing. This change does not fix or retune either detector, pin Voicute, change preprocessing or implement iMuse's minimum-dBFS gate.

## Use

1. Choose one engine and the microphone-processing options. Leave the near-trigger capture score at 0.500 initially. It controls which clips are retained, not the detector's live threshold.
2. Start monitoring. Actual triggers always capture audio, even if below the chosen near-trigger score. Scores reaching the near-trigger setting also capture audio. Nearby scores are grouped; a real trigger can upgrade a pending near-trigger clip.
3. Each clip requests three seconds before and two seconds after its event. Grouped clips can extend to 15 seconds. Initial audio, delayed inference beyond the 30-second rolling history, or stopping early can shorten a clip; the table identifies shortened beginnings/endings. Audio positions are tied to captured samples rather than inference completion time.
4. If you deliberately say the wake phrase and it is missed, promptly press **Mark missed wake phrase**. This captures audio regardless of score and initially labels it false negative. Low-score misses cannot be found automatically. **Mark false activation** labels the latest actual trigger within 30 seconds. Undo restores the linked label if it has not since been changed and keeps the clip.
5. Stop, then use **Play** in the review table. The player identifies the approximate event offset. Choose a classification and enter notes, such as what was actually said. Each clip can also be downloaded in its stored format. New clips use mono 64 kbps MP3; existing WAV clips remain readable.
6. Export the **review archive** after a run. It contains audio, metadata, labels, notes and complete logs for stopped runs. It waits for pending compression jobs before exporting. Import restores clips on another browser or after storage loss; existing clip IDs and their edits are kept. Diagnostic JSON and score CSV remain separate, per-run exports. Starting another run resets scores but retains review clips.

| Clip | Intended phrase present | Unrelated sound |
| --- | --- | --- |
| Detector triggered | True positive | False positive |
| Detector did not trigger | False negative | True negative |

Use Unreviewed or Uncertain when appropriate. A near trigger is not automatically a false negative. Grouped clips may contain multiple utterances; their labels are not a count of individual wake events. The selected clips alone cannot estimate total missed phrases or total true negatives. A meaningful miss-rate test also needs a known set of intentional attempts; false activations per hour require the actual monitoring duration, excluding suspended periods.

## Data for parameter optimization

The review archive now includes full score logs for completed runs, not just selected clips. Each clip also carries the available local score trace. Stop normally before exporting to include the complete run log; abrupt closure may retain clips without that final run snapshot.

| Data | What it helps assess |
| --- | --- |
| Raw scores, EMA, actual trigger flag, threshold and input-sample positions | Candidate confidence thresholds and runs of consecutive high scores |
| Original input RMS dBFS per inference window | A possible minimum-level gate, without measuring compressed playback; null plus `inputSilent` denotes digital silence |
| Heed filtered-window RMS, voice-band fraction and gated flag | Existing Heed energy-gate behavior; these differ from unfiltered input RMS |
| Voicute returned word, consecutive-frame requirement and sigmoid field | Interpretation of the engine output; requested metadata may differ from runtime behavior |
| Inference duration and sample backlog | Whether poor streaming performance confounds recognition results |
| Condition/processing/threshold changes, browser/device settings and model information | Separating runs with different inputs or configurations |
| Captured sample count, captured-audio duration and wall-clock duration | Identifying suspension gaps and choosing a defensible false-activation denominator |
| Review labels and notes | Relating detector scores to what was actually said |

The archive is data for analysis; it does not automatically select optimal parameters. Consecutive-frame/cooldown simulations must account for each engine's state and cadence. A different level gate can affect model state, so filtering stored scores is only an estimate of a live change. Heed and Voicute input RMS windows differ in duration. Voicute remains loaded from an unpinned source, explicitly recorded as such, and cannot yet be assumed identical across dates. No claim of bit-exact acoustic replay or complete false-negative discovery is made.

## Storage and testing limits

Review audio is encoded as mono 64 kbps MP3 using pinned `lamejs@1.2.1` in a worker. A typical 5-second clip is approximately 40 KB before archive overhead. Detection continues to use original microphone samples; compression is downstream of inference and does not retune either engine. The original 16-bit PCM WAV is retained as a safety copy until encoding succeeds; failed encoding keeps that WAV and reports the reason. Existing WAV clips are not converted automatically. MP3 is lossy: it is suitable for listening/labeling but cannot reproduce the exact original model input for retraining or acoustic replay. A rolling buffer retains 30 seconds; completed clips, notes, labels and stopped-run diagnostics are saved to the separate IndexedDB database `imuse-wake-review-lab` (schema 2 adds a separate runs store without clearing clips). They do not touch iMuse recording storage. Version 2 review archives carry the audio MIME type; imports still accept earlier version 1 WAV archives. A failed write leaves the clip in memory and displays a warning to export before leaving. Browser storage can be removed or differ between a tab and installed app. The archive is the portable backup; it can still become large because it includes audio as base64 and complete score logs. Models/scripts load from external providers; microphone audio is not intentionally uploaded by this lab.

Keep the tab visible for controlled comparisons. This lab does not overcome the installed iPhone PWA background-capture failure. Long-run scheduling, browser storage, actual microphone capture and native playback remain manual acceptance checks. Existing score history is retained in memory during a run; long sessions can increase memory and rendering costs.

Worker MP3 wiring and original-audio retention on encoder failure are tested with a mock encoder; actual codec download/encoding/playback require browser validation. Controlled regression tests cover sample boundaries, pre/post-roll, grouping, manual low-score misses, unavailable old history, WAV headers/sample conversion, table playback wiring, label/notes persistence, archive export/import, reload and storage-failure retention. All 14 repository test methods pass; these use mock services and do not certify real-device capture.
