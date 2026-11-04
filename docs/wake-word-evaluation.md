# Recorder, wake-word and filename lab

Updated 4 November 2026. The user approved a new standalone `lab.html` after reviewing the comparison archive. Production recording and voice-control code are unchanged.

## Findings from the supplied archive

Reviewed local file `WakeLab-review-2026-11-04T08-04-54.824Z.json` (86 reviewed clips, three Heed runs). The private audio/archive stays outside the repository.

| Finding | Evidence |
| --- | --- |
| Actual wake events | 12 triggers: 2 labeled true positive, 10 false positive |
| Candidate clips without activation | 74 near triggers: 70 labeled true negative, 4 false negative |
| Nature of false positives | Nine annotated “background speech, faint”; one annotated as unrelated conversation |
| Long run | 2,121.5 seconds of captured audio (35.36 minutes); 10 labeled false activations and one true activation |
| Inference speed in long run | Median 1.1 ms, 95th percentile 2.4 ms, maximum 21 ms |
| Input backlog in long run | Median 21.25 ms, 95th percentile 40.38 ms, maximum 42.5 ms |
| Browser-reported processing | MacBook Pro built-in microphone, Chrome; AGC false, noise suppression and echo cancellation true, 48 kHz mono |
| Score overlap | False-positive clip peaks 0.761–0.962; true-positive peaks 0.920 and 0.957 |

The archive does not show a growing inference queue or establish an engine-compute cause for slow audible responses. Its actual false activations are annotated as speech, so adding a speech detector cannot be assumed to reject them. This does not contradict separate observations of noise-only triggers outside this sample. Five “nothing” clips are labeled true negative, not actual activations.

Heed's existing energy gate is a −55 dBFS floor plus a broad voice-band fraction, not a speech classifier. Every actual trigger's recorded band fraction is approximately 0.987–0.998, easily exceeding the configured 0.15. Stronger energy gating is a testable hypothesis, but a single fixed cutoff should not be chosen from two positive examples. Raw input RMS is a 100 ms window, whereas the filtered gate RMS uses approximately one second; rejecting by instantaneous level could reject the quiet end of a genuine phrase.

The four false-negative clips include overlapping audio. They do not establish four independent attempts, so no miss-rate estimate is inferred. About 17 false activations per captured hour describes only the long run and its selected conditions, not expected performance across devices. The whine's origin remains unresolved; valid compressed data/metadata alone cannot establish its acoustic source.

## Current lab

Open the hosted **`lab.html`** address. Choose **Filename suggestions** (default, wake detector off) or **Speech-gated wake testing** (automatic naming off) before recording. The two tasks share recording storage and offline assets. Wake detection currently uses Heed or Voicute; Whisper is used for naming, not wake verification. Rebooting resolved the reported device problem; the user reports two spoken “Hey Doc” phrases were detected.

It provides:

- Record, Pause/Resume and Stop, native browser compressed audio, playback and download. **Lab build 2026-11-04.8** is shown below the heading so cached versions can be identified.
- Per-recording titles and a date/time prefix that filename suggestions cannot replace.
- Local Whisper **tiny.en** transcription of up to 15 seconds beginning near detected speech, executed after Stop. The suggestion considers only the first two sentences and uses a short phrase from the first useful one, preserving word order and removing introductory filler (up to six words / 48 characters). It does not rank words from later topics or load a semantic model. A user must click **Use suggested name** to apply it.
- **Live speech/wake analysis** can be unchecked for a recorder-only comparison: no detector worker or analysis AudioContext is opened for that recording, and titles are manual. With it checked, choose Heed / Voicute / Wake off (speech analysis stays on), with **Require speech** enabled by default. Silero v5 evaluates 512-sample 16 kHz blocks; a candidate needs at least two above-threshold speech blocks in the preceding second. Speech gating filters acceptance, while continuous wake-model ingestion is preserved.
- An optional minimum input-level gate using a one-second window; disabled initially. It may help with faint conversation, but it is not speaker identification.
- Raw candidate/accepted/rejected counts and event rows, with sample-based WAV clips from three seconds before to two seconds after each trigger. Near-trigger clips (default score 0.5, at most one per five seconds) and manual missed-wake / negative samples allow review of non-activations too. Clips shortened by startup, Stop or analysis gaps are flagged. Playback is blocked during recording. Clips, labels and notes are saved with the lab recording and survive reload; deleting that recording deletes its reviews. **Export review audio + labels** produces a portable JSON backup; diagnostic export omits binary audio. Labels are true positive, false positive, true negative or false negative, with the same sampled events compared with and without the speech gate.
- Default wake action is **Mark detection**; **Pause / resume recording** is an explicit alternative. No spoken acknowledgement or command-model startup is inserted.
- Full per-prediction diagnostic export with speech history, scores, input level, analysis/transport timing, gate results and recording settings. This supports comparison; it does not select optimal parameters automatically.

Audio now prefers AAC/M4A, matching production iMuse. The preferred-format selector also offers Browser default and WebM/Opus for controlled comparisons; unsupported choices fall back to supported alternatives. The filename extension follows the actual encoder, and requested preference and format attempts are exported. If actual start fails before any data or active capture, alternate encoders are tried. A track that ends after startup is not silently restarted or switched to another format. An advertised MIME type is not treated as proof that the encoder can start. Failed never-started attempts are labeled failed, rather than completed recordings. Format attempts and microphone state are included in diagnostics. The new path does not route recording audio through the previous custom PCM-to-MP3 encoder. This is an isolation step, not a claim that the old encoder caused the whine. The AudioWorklet analysis tap transfers 1024-sample mono packets and explicitly outputs silence to its audio sink. ScriptProcessor has been removed from the active lab. The analysis context uses the microphone’s reported input rate when available; its actual rate still configures resampling.

The live analysis branch uses a continuous windowed-sinc resampler with anti-aliasing rather than dropping/interpolating samples independently at callback boundaries. Its queue is bounded; delayed analysis is dropped/reset and reported instead of allowing a growing queue of old wake audio. Recording remains on the independent native MediaRecorder branch. Whisper runs in a separate worker after Stop. Starting another recording while transcription finishes is allowed, so CPU contention remains a device test.

## Offline preparation and distribution

**Prepare offline models** caches approximately **79 MiB** of shipped static assets and preloads Whisper. All model/runtimes are self-hosted; no API key or cloud inference is used. The models are separate files, not base64 inside the HTML. The browser still needs an initial download. Browser-managed caches can be removed; verify offline reload in the same browser before relying on them.

`lab-sw.js` is registered with the narrow **`lab.html` and `js/lab/` URL-prefix scopes**, not the app root. The second scope lets module workers load their dependencies offline. Production iMuse pages are outside both scopes. The lab should be served over HTTPS or localhost. Its module workers are not designed for opening the HTML as a Desktop `file://` document.

Dependencies and license notices are listed in [lab sources](../js/lab/SOURCES.md). Models and runtimes are pinned; the lab deliberately retains Hey Doc and Hey Friday to compare with existing observations. The local Voicute wrapper's nominal three-frame metadata does not override its upstream multi-keyword return value of two frames; this behavior is recorded, not presented as three-frame confirmation.

After any lab-code/asset edit, regenerate `js/lab/manifest.json` with:

```sh
python3 scripts/build-lab-manifest.py
```

Bump the lab cache version when changing pinned vendor/model files.

## Preservation and cleanup

The new lab uses only **`imuse-simple-recorder-lab`** IndexedDB stores `recordings` and `chunks`. Native 250 ms chunks are journaled while recording; Stop assembles the full available memory copy and saves it atomically before removing that recording's journal chunks. Chunk-write failure does not discard the memory tail. Failed final saving keeps downloadable in-memory audio; leaving then loses that memory-only copy. An inactive recorder that previously started is allowed to deliver its final data and stop events; it is not finalized immediately merely because its state became inactive. A delayed Stop produces an interrupted available copy after the watchdog, and a late final event can upgrade it. Empty interruptions explicitly say that no audio was captured. Abruptly interrupted encoded chunks may not be fully playable.

New recordings retain previous recordings. Reload recovers available journal chunks with an interrupted label. Per-recording deletion and **Clear all lab recordings…** require confirmation, and operate only on this lab's storage. Pending finalization protects that recording from deletion; late filename results cannot recreate a deleted record. Production iMuse storage and the older review database are separate.

## Safari microphone-ended comparison

The user reports **interrupted · 0.0 KB · Microphone ended** with live analysis enabled. The following recorder-only comparison also displayed recording for about nine seconds before the same result; no other tab or app was using the microphone. This establishes that the input track ended, but not why; analysis alone does not explain both failures. Previous files used WebM. Build 2026-11-04.7 prefers AAC/M4A, matching production iMuse, to test this format difference without claiming a codec defect. The reported 404 was the favicon, unrelated to model loading; the lab now supplies an inline icon. No claim is made that AudioWorklet or matching the context rate cures the Safari interruption.

After deployment, verify **Lab build 2026-11-04.8** below the heading:

1. Uncheck **Live speech/wake analysis** and select **AAC / M4A**. Record speech for 15 seconds, Stop, and play it. Check that the filename ends in .m4a. This is the native-recorder baseline, with manual titles.
2. Only if that succeeds, check **Live speech/wake analysis** and repeat with AAC/M4A unchanged.
3. If either run fails or falls back to a different filename extension, export diagnostics immediately. Requested preference, encoder attempts, analysis stage, input/context rates and interruption reason are recorded. Safari acceptance remains pending.

The current status shows the actual interruption reason and distinguishes available audio from a genuinely empty recording. Recordings are listed newest first. A separate stop-order bug was found: when a track ended and the native recorder was already inactive, early finalization could miss its queued final data. The fix waits for that data/stop sequence or the existing watchdog. This fixes a preservation race, not the underlying Safari track ending.

## First device check

1. Open hosted `lab.html`, click **Prepare offline models**, and wait for completion.
2. Record a short subject, for example “Garden irrigation plan,” then stop. Confirm playback and a proposed date/time filename. Apply or edit its suffix.
3. Repeat with **Heed / Require speech**. Leave a quiet interval, say “Hey Doc,” then Stop. Inspect candidate/accepted/rejected events and export diagnostics. Repeat with Voicute/“Hey Friday.”
4. Compare **Require speech** on/off in separate recordings. Ordinary background speech can still pass the speech gate.
5. Reload offline in the same browser. Confirm saved playback, then a fresh recording with model loading. Try deletion only with disposable recordings.

After Safari reported that the microphone ended during preparation, startup was reordered: model initialization completes without a microphone or AudioContext; only then is a fresh stream acquired and the native recorder started. The analysis AudioContext is created afterward and its actual sample rate is sent to the prepared worker. An analysis setup failure leaves native recording running. Cancellation before model readiness never acquires the microphone, and a permission grant arriving after cancellation is immediately released.

The Safari startup follow-up also makes AudioContext cleanup idempotent: failed startup and normal Stop share a single close operation. The earlier ScriptProcessor warning was not evidence of the startup cause. Subsequent code replaces it with AudioWorklet and adds an explicit recorder-only comparison. Native Safari retesting is required.

Desktop controlled tests and isolated headless Chrome verify filename/DSP/gate helpers, recorder recovery/late tail, script parsing and offline asset hashes. Real-model browser checks additionally cover both wake engines, Silero inference, compressed recording, pause/resume, Whisper transcription, scoped caching and offline reload. Device-specific performance, the reported whine, true/false wake rates and iPhone installed-app background microphone loss still require user testing. No wake engine fixes an OS-suspended microphone source.

## Previous lab

The comparison/review lab is preserved at [archived comparison lab](Archive/wake-word-comparison-lab-2026-11-04.html). It still uses the separate `imuse-wake-review-lab` database, so previously saved clips remain accessible from the same site/browser context. Its [archived instructions](Archive/wake-word-review-notes-2026-11-04.md) describe MP3 review clips, labels, portable archives and raw/encoded comparison. Private recordings and the supplied JSON were not committed.

### Comparing the speech gate

In build 2026-11-04.8:

1. Select **Speech-gated wake testing**, leave **Mark detection** selected, and Record. Keep the level gate off for an initial comparison isolating speech gating.
2. Run quiet/noise, ordinary speech/TV and deliberate wake phrases. Each detector trigger automatically collects a review clip. Near triggers are sampled too. Tap **Mark missed wake phrase** immediately after a missed phrase; tap **Capture negative sample** after ordinary noise/speech you want to review. Manual timing is approximate.
3. Stop, then play each clip. A full clip has the detector event at 3 seconds, followed by 2 seconds of audio. Short windows are flagged. Audio is the 16 kHz analysis input, not a seek into the compressed recording, so pause/resume does not displace clips. An analysis gap ends pending clips and clears pre-roll history to avoid splicing unrelated audio.
4. Label the actual result: TP means accepted with the phrase; FP accepted without it; FN phrase present but no acceptance; TN no phrase and no acceptance. For the on/off comparison the label establishes phrase presence; the recorded candidate and gate outcomes determine each counterfactual result. Near/manual negatives are sampled examples, not every second of silence, so these counts do not establish whole-session accuracy rates. Overlapping events may have overlapping clips.
5. Export review audio + labels before deleting recordings or clearing browser storage. Reviews persist in this lab's recording database without changing its schema. The archived lab and its separate database remain untouched. Diagnostic JSON still excludes audio; the review export contains base64 WAV clips, labels, notes, recording metadata and available run events. Older diagnostic-only exports cannot reconstruct clips that were never captured.

Heed / Voicute supplies wake candidates; Silero supplies the speech gate. Whisper still only transcribes filename audio. No new wake model is trained or installed by this change.
