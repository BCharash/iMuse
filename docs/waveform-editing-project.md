# Future project: waveform playback and recording editing

Proposed 13 November 2026. **Documentation only; not implemented or authorized for implementation.** This is a separate project from the completed Saved Recordings Combine feature. No library, recording-path change, or Swift migration is selected by this proposal.

## Purpose

Provide a Voice Memos-style view of loud and quiet portions of a recording, with a moving playback position. Let the user find a passage visually and eventually make simple edits while preserving the original recording. Browser-based iMuse is a feasible target; a native iOS version is not a prerequisite.

## Proposed stages

1. **Waveform playback.** Display audio levels over time, elapsed/total time and a moving playhead. Support touch seeking, scrubbing and zooming to locate speech or silence. A scrolling waveform versus a fixed waveform with moving playhead remains a UI choice. Keep ordinary playback available while waveform data is being prepared or if preparation fails.
2. **Trim and save a copy.** Select start/end handles, preview the kept passage, then Save edited copy as a new recording. Preserve the original. The edited result should use normal library playback/download/archive/delete controls and retain source history.
3. **Optional later editing.** Select a section to remove or keep; expand to multiple sections only if useful. This stage needs a separate scope decision after playback and trimming work well on iPhone.

This is not a proposal for multitrack mixing, effects, automatic silence removal, destructive overwriting, or live capture replacement. Those features would require separate decisions.

## Long recordings and iPhone resources

The user has already recorded more than 90 minutes. Designing solely around short-file full-audio decoding would be unsuitable. Store a compact, time-indexed summary of minimum/maximum levels (often called peaks) and draw from that, with enough resolution for the supported zoom levels. Avoid keeping an entire long recording as decoded PCM merely to draw its waveform.

Choose how to obtain peaks before implementation: incrementally during capture, incrementally after finalization, or through a bounded background analysis path. Audit capture overhead before choosing the first option. Existing recordings need an on-demand generation path; display a preparation state and retain playback/cancellation. Waveform caches should be reproducible from audio, versioned and disposable independently of the source recording. Combine/edit outputs need correctly ordered/rebased summaries or regeneration.

A waveform library is optional. [WaveSurfer's documentation](https://github.com/katspaugh/wavesurfer.js#questions) supports precomputed peaks for large recordings and warns about full-file decoding memory. It provides visualization and selection tools, not the actual audio-edit/export implementation. Evaluate touch behavior, accessibility, licensing, dependency size, timing accuracy and long-file memory before selecting a dependency. No library has been adopted for this project.

## Editing and provenance

Production Combine supplies a useful foundation: reading AAC/M4A packets, creating a new valid container, working outside the UI thread, retaining source snapshots and publishing a new artifact atomically. It does not already provide an editor.

AAC packet boundaries limit the precision of a simple lossless trim. Exact cuts within a packet may require decoding/re-encoding some audio. Select and explain the supported cut precision before implementation; distinguish visual selection precision from the actual saved boundaries. Preview and export must agree. Account for encoder padding and avoid promising seamless or sample-accurate joins without verification.

An edited artifact needs its own UUID/creation date, original capture identity/date, selected source ranges, ordered occurrences, and offsets/durations in the new output. Review the current packet-based Combine schema before extending it; do not assume arbitrary trims fit unchanged. Preserve repeated sources and understandable history after originals are deleted. Keep file names separate from identity.

## Acceptance and resume boundary

Before implementation, agree on the first-stage screen layout, scrolling/zoom behavior, waveform-generation strategy, resource budget and touch/accessibility controls. Before trimming, agree on cut precision and the provenance extension.

Validate Mac and iPhone Safari/PWA playback/seek alignment, rapid scrubbing, zoom, startup responsiveness, cancellation, app backgrounding and missing waveform data. Measure memory and preparation time on a representative existing long recording; the earlier successful long capture does not prove editing performance. Test mono/stereo, pauses, silence, short prompts, combined recordings and old recordings without peaks.

For editing, verify the first/last audible sounds, selected duration, preview/export agreement, original retention, interrupted processing, insufficient storage, atomic publication, reload persistence, source history, and the downloaded file in iPhone Files. Keep recording reliability, installed-PWA background investigation, native feasibility and version maintenance as separate workstreams.
