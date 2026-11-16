# Opening-speech filename suggestions: proposed production plan

Date: 16 November 2026

Status: Deferred proposal for future consideration. No implementation is authorised by this document. Production code has not been changed for this feature.

## Purpose

Bring the local Whisper filename suggestion experiment in `lab.html` into production iMuse as an optional aid to naming downloads. Preserve the timestamp, editable description and actual audio extension.

## Existing behaviour

- Production builds a default filename from the recording date/time followed by `iMuse`.
- `js/recording-download.js` provides the editable Description field and filename preview. Its current sanitizer substitutes `iMuse` when the description is empty.
- The lab captures up to 15 seconds from detected opening speech, including a short lead-in, and transcribes after Stop.
- The lab uses bundled, quantized Whisper **tiny.en** in a worker, with local model loading and remote model loading disabled. The model is English-only; it is not a model called “mini”.
- The lab's keyword rules consider the first two sentences, use the first useful one, remove common words and repetitions, preserve spoken order, and limit the result to six words / 48 characters.

## Requested interface

Add a **Suggest filename from opening speech** checkbox in the Storage settings area.

In the download naming dialog:

- Keep the date/time prefix fixed and the description editable, initially `iMuse`.
- Add a clear **×** button that empties the description while retaining the timestamp.
- Add a **Suggest filename** button, available when the Storage setting is enabled, that inserts an editable suggested description.
- Download using the current description and the actual audio extension.
- Allow a timestamp-only filename when the description is empty; adjust the current empty-field fallback accordingly.

These controls were requested by the user. The processing and lifecycle choices below remain proposals.

## Proposed audio and transcription flow

1. When naming is enabled, reuse production's existing microphone stream and audio analysis branch in `js/recorder.js`.
2. During recording, retain a bounded buffer starting at the first detected speech, with a short lead-in and a maximum of 15 seconds. Stop collecting for naming when the limit is reached. Do not open another microphone stream or decode the entire finished recording.
3. Make opening-speech detection independent of whether voice commands or silence detection are enabled.
4. Save and finalize the recording through the existing recording path.
5. After Stop, run transcription when the user presses **Suggest filename**. This revises the earlier proposal to generate automatically after Stop and avoids inference for recordings that never need a suggestion.
6. Convert the transcript into a short description and insert it into the editable field. Do not overwrite subsequent user edits with a late asynchronous result.

A 15-second, 16 kHz mono Float32 buffer occupies approximately 960 KB, excluding temporary processing buffers. This is separate from the model's memory cost.

If suggestions must work after reloading iMuse, persist the opening clip with its session. That persistence decision is still open. Persisting the suggestion and accepted description would also allow them to survive reopening the recording library. Avoid retaining the full opening transcript by default.

## Model preparation and overhead

Distinguish three states: assets cached in browser storage, model loaded into memory, and model warmed for inference.

The lab's preparation loads the model and runs inference on one second of silence with output limited to one token. The two ONNX weight files total approximately 41 MB; the lab describes roughly 80 MB for first preparation including supporting assets. Neither figure measures runtime RAM.

Loading and warming consume CPU temporarily. Keeping the loaded model ready retains memory but does not require continuous inference. Warm-up duration and peak memory have not been measured on target devices and must be measured before choosing production defaults.

Proposed approach:

- Cache the required assets when the feature is enabled, with download progress and readiness status.
- Load and warm while idle, without delaying Record.
- If memory measurements make idle loading undesirable, load on the first Suggest click instead.
- Release model resources when appropriate, accepting that a later request will need to reload them.

The lab service worker deliberately excludes production pages. Production therefore needs an explicit model caching, versioning, offline readiness and cleanup strategy; it cannot assume lab preparation covers production.

## Better filename quality without another model

Use Whisper for transcription, then improve the title-selection rules to preserve coherent phrases rather than simply removing common words.

Proposed priority:

1. Recognise an explicitly spoken title, such as “Title: November budget review”.
2. Remove introductory speech while preserving a meaningful topic phrase, including relevant connecting words, names, numbers and negations.
3. Choose the strongest usable sentence from the available opening transcript rather than always taking the first sentence containing useful words.
4. Fall back to manual naming when no useful topic is available.

Example:

> Today I want to discuss why we should not renew the office lease.

Possible description: `Do-not-renew-office-lease`.

These rules need evaluation against real recordings; they are not implemented or guaranteed to produce semantic summaries. A separate text summarisation model could support more substantial rewriting, but would add download, memory and processing costs. The recommended first version uses the existing Whisper model with improved phrase-based rules.

## Recording and storage safeguards

- Naming must not block recording finalization, playback or manual downloading.
- Handle unavailable models, timeouts, silence and poor transcription with a clear manual fallback.
- Associate each request with its recording; ignore late results for deleted recordings or obsolete requests.
- Defer new inference while another recording is active. Decide how to cancel or stop already-running inference if recording starts.
- Apply metadata updates through the existing storage coordinator so they cannot race finalization or resurrect deleted sessions.
- Treat the opening clip as recording data, with the same deletion lifecycle as its session.
- Define behaviour for combined and recovered recordings; do not assume they have an opening clip.

## Validation before release

Check silence, music, delayed speech, short recordings, pause/resume, rapid Stop–Record sequences, deletion during inference, edited descriptions, empty descriptions, offline reload and model failures. Measure preparation time, inference latency and memory on representative desktop and mobile browsers. Confirm naming works with voice commands and silence detection disabled.

## Decisions still open

- Default checkbox state and whether enabling it immediately downloads assets.
- Persisting the opening clip for suggestions after reload, and handling older recordings without one.
- Idle prewarming versus loading on first request, based on measurements.
- Exact phrase-selection rules and length limits.
- Button availability and status while recording, preparing or transcribing.
- Naming behaviour for combined and recovered recordings.

## Relevant implementation references

- `lab.html`
- `js/lab/app.js`: model preparation and suggestion orchestration
- `js/lab/whisper-worker.js`: local inference and warm-up
- `js/lab/detection-worker.js`: opening-speech capture
- `js/lab/core.js`: keyword and filename helpers
- `js/lab/manifest.json`: bundled asset sizes and hashes
- `lab-sw.js`: lab-only caching
- `js/recorder.js`: production audio branch, session lifecycle and download flow
- `js/recording-download.js`: description dialog and filename sanitization
- `js/settings.js`: Storage settings
- `js/recording-store.js`: session persistence

External reference: [Transformers.js pipeline API](https://huggingface.co/docs/transformers.js/api/pipelines), including pipeline disposal.
