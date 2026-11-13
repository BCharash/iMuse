# Combine saved recordings

Implemented in production build **2026-11-13.6**; current UI checkpoint **2026-11-13.15**. The separate PCM-WAV Combine
prototype has been removed. The wake-word/Silero lab is unchanged.

## Using Combine

1. Open **Saved Recordings → View → Combine**. Every checkbox starts unselected.
2. Select at least two finished recordings. **Combine selected (N)** becomes enabled.
3. Combine creates a new M4A recording at the top of Saved Recordings. Originals
   remain available. The result has the normal playback, Download, Archive,
   Delete and Diagnostics controls, plus **Sources (N)**.
4. Expand Sources to see the original capture dates, names and segment durations.
   Download reminders work independently for the new result. The **Combined recording**
   designation is bold in Saved and Archived Recordings. A divider separates Saved
   controls from the list, and neighboring recordings have separators. Archived
   rows show Download requested or Not yet downloaded before deletion.

Cancel exits selection or stops processing before saving. The final database
transaction cannot be cancelled halfway through. A failed combine preserves
originals. Stop and finish active recording before combining; New Recording is
unavailable while a combine is processing/saving.

## Audio and ordering

Combine supports compatible **single-track M4A/AAC** recordings. It checks actual
container/codec configuration, sample rate and channels, not just the filename.
Different configurations, non-M4A inputs, unfinished/interrupted recordings and
missing stored chunks are rejected; there is no automatic transcoding or mixing.
Existing incompatible recordings remain playable/downloadable as before.

Audio packets are copied into a new valid M4A container without decoding or
re-encoding. This preserves the compressed audio; independent file bytes are not
simply concatenated. Calendar-time gaps are not inserted. AAC encoder padding can
remain at joins; this is not a sample-accurate gapless audio editor.

Original capture dates determine order. Nested results are flattened first:
A/C combined with B produces A/B/C. Selecting original A together with A/B/C
retains A twice, giving A/A/B/C. Equal dates retain selected-input order followed
by segment order. Creating a combined result does not change any source date.

## Source history and storage

The new session has its own UUID and creation date (used to place it first in the
list). `combineMetadata` is a versioned `imuse-combined-recording` v1 snapshot:

- `parents`: the directly selected recordings, their IDs, names, creation dates
  and packet counts.
- `sources`: original IDs, names, capture dates, MIME labels, packet/sample counts.
- `segments`: unique occurrence ID, source ID/date, source/output packet offsets,
  packet/sample counts, and immediate parent ID/occurrence/packet offset.
- `sampleRate`, `channels`, total `packetCount` and `sampleCount`.

Packet boundaries allow lossless reuse of nested M4A results. Durations are sample
counts divided by sample rate. Repeated occurrences are retained separately from
unique sources. Snapshots remain readable after source recordings are deleted.

The same JSON is stored in IndexedDB and embedded in a private top-level MP4
`uuid` box (`694d7573-6543-6f6d-6269-6e6500000001`). The box is appended after
muxing so media offsets remain valid. Unknown boxes are ignored by normal media
players. History has a 1 MiB limit and is validated against the actual audio when
reused. The [example](examples/combine-metadata-v1.json) is generated from a nested
three-tone browser check. There is no new external-file import screen.

All source reads, processing and publication hold the existing writer coordinator
and Web Lock. The worker has no database or microphone access. It parses the new
output and checks its configuration, total packets/samples and embedded JSON
before publication. One IndexedDB transaction adds the session and one Blob chunk;
an abort leaves neither half. No database schema upgrade or source rewrite is
needed. Diagnostics includes session metadata, including the source history.

## Performance and verification

The pinned local [Mediabunny dependency](../js/vendor/README.md) loads only when
Combine starts. Processing runs in a module worker, using Blob-backed input and
compressed output chunks; it does not allocate full decoded PCM. The prototype's
30/90-second limits are gone. Browser memory/storage limits still apply, and the
new recording requires additional storage. Long combinations on iPhone have not
yet been measured. Closing the app cancels unfinished processing.

Run `python3 -m unittest discover -s tests -v` for provenance, worker lifecycle,
transaction and existing regressions. Run `python3 tests/browser_combine_check.py`
for generated AAC files, exact packet hashes, decoded chronological tones, nested
and repeated sources, real IndexedDB/UI, cancellation, incompatible-input failure,
download request, Archive/Unarchive and narrow layout. Chrome uses an isolated
profile, synthetic audio and denied filesystem downloads; this does not certify
iPhone playback or successful saving into Files.

On iPhone, use three disposable recordings: combine all three, play/seek and
download the result; then combine A/C with B and expand Sources. Confirm original
files remain and the new M4A plays in Files. The existing successful >90-minute
recording need not be repeated solely for this change.

Waveform playback and trimming are separate future work; see the [project brief](waveform-editing-project.md). Today’s full changes and acceptance report are in the [13 November summary](2026-11-13-session-summary.md).
