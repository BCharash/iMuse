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

### Proposed processing and display architecture

Keep playback, visualization and editing as separate responsibilities. Prefer the existing native media-element playback path while peaks are prepared independently. Native compressed playback still consumes memory and buffering; measure it rather than treating it as free. A display animation may read the player's current time using requestAnimationFrame while visible; stop unnecessary drawing when hidden and resynchronize after seeking, buffering or returning to the foreground. The media timeline remains authoritative.

Store peak summaries at several resolutions and draw only the visible time window. Choose resolution by zoom level; load finer detail for a small selected region rather than rendering a canvas spanning an entire long recording. Set a canvas/backing-store budget that accounts for device pixel ratio. Validate actual device limits instead of relying on a universal canvas-size ceiling. Peak size depends on duration, channels, resolution and binary versus JSON representation; do not promise a fixed 50–100 KB cache. For example, an hour at 10 ms resolution with one pair of 16-bit min/max values per interval is about 1.44 MB per channel before indexes or other resolutions.

For existing local audio, evaluate bounded worker decoding: extract encoded packets from the container, decode a limited queue, aggregate peaks, then release decoded samples promptly. Arbitrary Blob.slice() pieces are not necessarily independently decodable audio. Reuse the existing M4A parser where appropriate; preserve configuration, packet order and timestamps. Bound input reads, decoder queues, peak batches and output writes, with cancellation and progress. A worker alone does not guarantee bounded memory. WebAssembly/FFmpeg decoding is an alternative to evaluate only if needed; it is not automatically lightweight or streaming because it runs in a worker.

At the documented Safari 26 baseline, AudioDecoder/AudioEncoder are available, but availability alone does not establish support for the recording's codec/configuration or reliable long-file processing. Check capabilities and execute representative decoding on each supported device. Older browsers need an explicit fallback or an unavailable-feature state; ordinary recording/playback should remain usable.

A waveform library is optional. [WaveSurfer's documentation](https://github.com/katspaugh/wavesurfer.js#questions) supports precomputed peaks for large recordings and warns about full-file decoding memory. It provides visualization and selection tools, not the actual audio-edit/export implementation. Evaluate touch behavior, accessibility, licensing, dependency size, timing accuracy and long-file memory before selecting a dependency. No library has been adopted for this project.

## Editing and provenance

Production Combine supplies a useful foundation: reading AAC/M4A packets, creating a new valid container, working outside the UI thread, retaining source snapshots and publishing a new artifact atomically. It does not already provide an editor.

### Edit decision list and preview

Represent in-progress edits as an ordered list of kept source ranges, rather than rewriting audio after each handle movement. Each range needs the source recording identity and start/end boundaries. Reordering or repeating a range must retain distinct occurrences. This edit decision list can drive waveform mapping, edited-duration display and a bounded undo/redo history. Preview time must map explicitly to source time across all ranges.

Only Save edited copy should render and publish a new artifact. Discarding the edit leaves source audio unchanged. Decide separately whether drafts/history persist across reloads and how source audio is retained while a draft references it; draft references must not silently permit required audio to be permanently deleted.

For simple preview, media-element seeks may be adequate, but skipping between ranges can introduce delay or audible gaps. Do not promise seamless playback from currentTime jumps. Test preview/export agreement and choose a different scheduling/preview strategy if the required experience cannot be achieved. Undo history and edit metadata have real resource costs; define limits rather than promising unlimited undo or zero-memory editing.

Prefer local/offline export built on production Combine for compatible M4A. Do not introduce uploads or a server dependency as the default. A server-assisted exporter would require a separate product/privacy decision. Audio copy/remux also does not imply arbitrary cuts are exact or that processing takes milliseconds.

AAC packet boundaries limit the precision of a simple lossless trim. Exact cuts within a packet may require decoding/re-encoding some audio. Select and explain the supported cut precision before implementation; distinguish visual selection precision from the actual saved boundaries. Preview and export must agree. Account for encoder padding and avoid promising seamless or sample-accurate joins without verification.

An edited artifact needs its own UUID/creation date, original capture identity/date, selected source ranges, ordered occurrences, and offsets/durations in the new output. Review the current packet-based Combine schema before extending it; do not assume arbitrary trims fit unchanged. Preserve repeated sources and understandable history after originals are deleted. Keep file names separate from identity.

## Storage, platform and gesture decisions

Retain the existing IndexedDB recording store while evaluating the editor. OPFS may be useful for seekable temporary output or caches, but choose it only after measuring quota, write/read performance, cleanup and failure behavior against the current approach. It is not a required migration. Keep recoverable source audio separate from reproducible peak caches and temporary exports; handle quota failure without deleting originals or publishing partial edited results.

Use storage estimates/persistence reporting and test the actual supported Safari/PWA versions. Current WebKit storage policy covers Cache API, IndexedDB and File System storage under origin limits; an old approximately 50 MB Cache API figure is not a current general rule. Quotas are not guaranteed free space or retention. Home Screen first-party apps are exempt from ITP's seven-day script-storage cap, but installation is not an external backup and does not eliminate other deletion/eviction risks. Describe Safari's ITP rule in its browser-use/user-interaction context, not as an unconditional seven-calendar-day wipe.

Preserve the app's existing prompt/microphone ownership behavior. Verify user-gesture playback, silent-switch/ringer/media volume, speaker/Bluetooth routing and background playback on target devices rather than applying one universal audio-routing rule. Media Session metadata/controls may improve system integration; they do not guarantee lock-screen playback or repair the separate background-recording issue.

Scope gesture handling to the waveform and editing handles. Preserve page scrolling and accessible controls, including alternatives to pinch/drag. Evaluate touch-action choices with iPhone edge navigation and deliberate page zoom; do not apply blanket touch-action:none as an assumed solution.

## Technical review sources

These references support the corrected architecture proposed after reviewing the user's Gemini excerpt on 13 November 2026. The excerpt is design input, not an adopted specification. Recheck platform behavior when implementation starts.

- [WebKit: Safari 26 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) — AudioEncoder/AudioDecoder were added in Safari 26; the excerpt's Safari 16.4 audio claim is incorrect.
- [WebCodecs specification](https://www.w3.org/TR/webcodecs/) — codec configuration, encoded chunks and decoded audio; container extraction remains a separate responsibility.
- [WebKit: storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) and [tracking prevention](https://webkit.org/tracking-prevention/) — modern quotas and Home Screen exemption from the ITP seven-day cap.
- [HTML specification: seeking](https://html.spec.whatwg.org/multipage/media.html#seeking) — seeking may involve waiting; it is not a guarantee of seamless edit preview.

The excerpt's decoded-audio calculation is useful: 60 minutes × 48,000 samples/s × 2 channels × 4 bytes is 1,382,400,000 bytes (about 1.38 GB, or 1.29 GiB), before other memory. Use this to justify avoiding whole-file PCM. A universal 1–1.5 GB per-tab crash threshold or guaranteed crash is not established and should not be a design constant. Compressed recording/export sizes and processing times likewise depend on actual format, bitrate and device.

## Acceptance and resume boundary

Before implementation, agree on the first-stage screen layout, scrolling/zoom behavior, waveform-generation strategy, resource budget and touch/accessibility controls. Before trimming, agree on cut precision, edit decision list/source retention, draft/undo limits, preview scheduling and the provenance extension.

Validate Mac and iPhone Safari/PWA playback/seek alignment, rapid scrubbing, zoom, startup responsiveness, cancellation, app backgrounding and missing waveform data. Measure memory and preparation time on a representative existing long recording; the earlier successful long capture does not prove editing performance. Test mono/stereo, pauses, silence, short prompts, combined recordings and old recordings without peaks.

For editing, verify the first/last audible sounds, selected duration, preview/export agreement, original retention, interrupted processing, insufficient storage, atomic publication, reload persistence, source history, and the downloaded file in iPhone Files. Keep recording reliability, installed-PWA background investigation, native feasibility and version maintenance as separate workstreams.
