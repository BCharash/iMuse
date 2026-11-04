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

Open the hosted **`lab.html`** address. It provides:

- Record, Pause/Resume and Stop, native browser compressed audio, playback and download.
- Per-recording titles and a date/time prefix that filename suggestions cannot replace.
- Local Whisper **tiny.en** transcription of up to 15 seconds beginning near detected speech, executed after Stop. The suggestion uses up to seven sanitized transcript words, not a generative summary. A user must click **Use suggested name** to apply it.
- Heed / Voicute / Off, with **Require speech** enabled by default. Silero v5 evaluates 512-sample 16 kHz blocks; a candidate needs at least two above-threshold speech blocks in the preceding second. Speech gating filters acceptance, while continuous wake-model ingestion is preserved.
- An optional minimum input-level gate using a one-second window; disabled initially. It may help with faint conversation, but it is not speaker identification.
- Raw candidate/accepted/rejected counts and event rows. Default wake action is **Mark detection**; **Pause / resume recording** is an explicit alternative. No spoken acknowledgement or command-model startup is inserted.
- Full per-prediction diagnostic export with speech history, scores, input level, analysis/transport timing, gate results and recording settings. This supports comparison; it does not select optimal parameters automatically.

Audio first uses the browser’s default MediaRecorder format and its matching extension. If actual start fails before any data or active capture, it tries supported AAC/MP4, WebM and Ogg alternatives. An advertised MIME type is not treated as proof that the encoder can start. Failed never-started attempts are labeled failed, rather than completed recordings. Format attempts and microphone state are included in diagnostics. The new path does not route recording audio through the previous custom PCM-to-MP3 encoder. This is an isolation step, not a claim that the old encoder caused the whine. The analysis branch explicitly outputs silence to its audio sink.

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

The new lab uses only **`imuse-simple-recorder-lab`** IndexedDB stores `recordings` and `chunks`. Native 250 ms chunks are journaled while recording; Stop assembles the full available memory copy and saves it atomically before removing that recording's journal chunks. Chunk-write failure does not discard the memory tail. Failed final saving keeps downloadable in-memory audio; leaving then loses that memory-only copy. A delayed Stop produces an interrupted available copy, and a late final event can upgrade it. Abruptly interrupted encoded chunks may not be fully playable.

New recordings retain previous recordings. Reload recovers available journal chunks with an interrupted label. Per-recording deletion and **Clear all lab recordings…** require confirmation, and operate only on this lab's storage. Pending finalization protects that recording from deletion; late filename results cannot recreate a deleted record. Production iMuse storage and the older review database are separate.

## First device check

1. Open hosted `lab.html`, click **Prepare offline models**, and wait for completion.
2. Record a short subject, for example “Garden irrigation plan,” then stop. Confirm playback and a proposed date/time filename. Apply or edit its suffix.
3. Repeat with **Heed / Require speech**. Leave a quiet interval, say “Hey Doc,” then Stop. Inspect candidate/accepted/rejected events and export diagnostics. Repeat with Voicute/“Hey Friday.”
4. Compare **Require speech** on/off in separate recordings. Ordinary background speech can still pass the speech gate.
5. Reload offline in the same browser. Confirm saved playback, then a fresh recording with model loading. Try deletion only with disposable recordings.

The Safari startup follow-up also makes AudioContext cleanup idempotent: failed startup and normal Stop share a single close operation. ScriptProcessor remains in this experimental analysis branch and is deprecated; its warning alone does not establish the cause of a MediaRecorder startup failure. Native Safari retesting is required.

Desktop controlled tests and isolated headless Chrome verify filename/DSP/gate helpers, recorder recovery/late tail, script parsing and offline asset hashes. Real-model browser checks additionally cover both wake engines, Silero inference, compressed recording, pause/resume, Whisper transcription, scoped caching and offline reload. Device-specific performance, the reported whine, true/false wake rates and iPhone installed-app background microphone loss still require user testing. No wake engine fixes an OS-suspended microphone source.

## Previous lab

The comparison/review lab is preserved at [archived comparison lab](Archive/wake-word-comparison-lab-2026-11-04.html). It still uses the separate `imuse-wake-review-lab` database, so previously saved clips remain accessible from the same site/browser context. Its [archived instructions](Archive/wake-word-review-notes-2026-11-04.md) describe MP3 review clips, labels, portable archives and raw/encoded comparison. Private recordings and the supplied JSON were not committed.
