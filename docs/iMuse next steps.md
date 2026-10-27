# iMuse next steps

**Planning note — 27 October 2026 (revised)**

## Purpose and priorities

iMuse is being developed as a calm, private voice notebook: record spoken thoughts, preserve the original audio, transcribe them, and make them available for later review. In the longer term, its recording functionality is expected to connect with Memora, which already has mature workflows for transcription, editing, combining transcripts, exporting text/DOCX/HTML with linked audio, and lexical and semantic search.

The immediate goal is not to build all of that integration now. It is to establish dependable recording behavior that can become a sound foundation for those later capabilities.

**Core responsibilities:**

- **Preserve audio as it is created.** Continuously write captured audio to IndexedDB so an unfinished session can be recovered after a crash or unexpected shutdown, as close to guaranteed as browser technology permits.
- **Produce one properly merged audio file for each finalized session.** A session with pauses may contain several capture segments internally, but its completed deliverable must be one valid audio file with all captured content in the correct order.
- Provide dependable Pause/Resume, playback, and Delete/reset behavior.
- Transcribe the complete intended recording.
- Investigate optional real-time or parallel transcription only when it cannot compromise capture fidelity, continuity, or stability.

Real-time or parallel transcription is desirable, but audio capture and preservation have absolute priority. If concurrency competes with reliable recording, recording wins.

## What we know from the previous work

### Pause/resume and segmented audio

A first approximation of Pause/Resume was implemented by stopping one `MediaRecorder` and starting another when recording resumed. Each recorder produced an audio Blob, and the code collected those Blobs in a `recordingSegments` array.

The intent was to treat the separate pieces as one logical recording. Playback was inconsistent: sometimes it appeared to play all segments seamlessly, and other times parts were missing or the playback duration/progress display was wrong. Transcription also regressed at one point and returned only the last segment.

The likely technical problem was treating separately recorded WebM/Opus or MP4/AAC Blobs as though they could safely be concatenated into one valid media file simply by creating a new Blob from the segment Blobs. A media Blob is not necessarily a raw sequence of audio samples; it can contain container headers and timing/index information. Concatenating containers this way is not a dependable method of producing one valid recording.

The code was subsequently reset by discarding uncommitted changes. The current `recorder.js` supplied on 27 October 2026 is therefore a baseline with the attempted segment-combining behavior no longer working as intended. It currently:
- collects `audioChunks` for the active `MediaRecorder`;
- resets `audioChunks` and `recordingSegments` whenever `startRecording()` runs;
- stops the recorder and microphone stream when the recorder's `stop` event fires;
- creates `audioBlob` from the current `audioChunks`;
- pushes that Blob into `recordingSegments`;
- assigns only `audioBlob` to `window.lastRecording` and the audio player;
- has a Pause handler that stops the current recorder and sets `isPausing`, but no complete reliable resume/session implementation;
- includes some session state (`recordingSessionActive`) whose meaning and necessity should be reassessed rather than carried forward automatically.

Consequently, the current file should be treated as a known starting point, not as the last working Pause/Resume implementation.

### Delete/reset

The Delete improvements were also discarded. They must be restored deliberately. The desired behavior should be defined before implementation. At minimum, Delete should stop any active capture safely, release microphone resources, clear the saved recording and audio player, revoke any object URL, reset Pause/Resume and recording controls, disable Transcribe, and clear the transcript display. It should not leave a delayed `stop` event recreating UI or recording state after deletion.

Starting a genuinely new recording should also clear the previous transcript and previous recording state, so text from one session cannot be mistaken for the result of another.

### Transcript clearing

A `const transcript = document.getElementById("transcript")` reference was added during the discarded work, but that declaration alone does not clear anything. Clearing requires explicit actions at the start of a new session and in the Delete/reset flow.

## Recommended design: preserve first, merge properly at finalization

Do not make concatenating media containers the foundation of Pause/Resume.

Represent one user recording session as a **logical session containing an ordered list of independently valid audio segments**. Each segment is created by its own recorder run and kept intact. Pausing ends the current segment; resuming starts a new segment in the same logical session.

This internal segmented representation is a preservation and recovery strategy, not the final user-facing deliverable. When the user finalizes a session, iMuse must assemble those segments into **one properly merged, valid audio file**. Simply wrapping the segment Blobs in a new Blob is not sufficient.

Conceptually:

- **Recording session**: identity, creation time, state, ordered segments, persistence status, and finalization status.
- **Audio segment/chunk**: captured audio data, sequence number, MIME type, timing metadata where available, and IndexedDB storage status.
- **Session actions**: start, pause, resume, finish, recover, delete.
- **Recovery store**: durable session metadata and all successfully persisted audio chunks/segments in IndexedDB.
- **Final audio file**: one validated, playable audio file containing all segments in the correct order.
- **Transcription**: a downstream consumer of the preserved session or validated final file.

This design preserves original captured media, supports recovery, and avoids corrupting audio merely to create a convenient combined Blob. It also fits Memora's future model of files, transcripts, and audio links.

### Proper final-file assembly

The required end state is one properly merged audio file, not merely a playlist of segments. Playing segments separately can be useful during development, but it does not satisfy the finalization requirement.

Investigate the available approaches before selecting one:
- **Media-container-aware assembly:** use a muxing approach that understands the captured format and timing information.
- **Decode and re-encode:** decode segments to audio samples, join them in order, and encode a valid output file. This offers control but costs processing time and may affect quality.
- **A different capture strategy:** investigate whether the target browsers can provide reliable pause/resume without creating incompatible independent containers, but do not assume this is possible or dependable.

Choose based on browser compatibility, audio fidelity, file validity, memory use, and offline operation. Preserve the source segments until the merged file has been validated and safely persisted. If finalization fails, the recoverable source data must remain available. A `Blob` constructor alone is not a media muxer.

### IndexedDB preservation and crash recovery

IndexedDB preservation is a core responsibility, not a later enhancement. Captured audio should be persisted incrementally throughout the session, rather than waiting until Stop or file export.

The storage design should include:
- A durable session record with a unique ID, timestamps, state, and schema/version information.
- Ordered audio chunks or segments, each associated with its session and sequence number.
- MIME type and timing metadata needed to reconstruct and process the session.
- Explicit write status and handling for quota, transaction, and storage errors.
- Recovery logic that identifies sessions interrupted before finalization and offers a way to recover or finalize them.
- A cleanup policy that never deletes the only recoverable copy before the final file is validated and persisted.

Wait for IndexedDB transaction completion before treating a chunk as stored. Request persistent storage with the browser API where available, monitor quota and write failures, and keep the interval between capture and durable persistence as short as practical. Browser storage cannot guarantee survival of every device failure, eviction, or abrupt shutdown, so the implementation must be candid about limits while minimizing the loss window.

## Suggested implementation sequence

Keep each step small, testable, and independently reviewable. Do not make a large multi-file change before the baseline behavior is confirmed.

Before editing:
- Confirm the current working tree and last commit in GitHub Desktop.
- Preserve the current `recorder.js` as the explicit starting point (for example, by making a normal Git commit once the user is satisfied with the baseline, or by retaining a separate local copy outside the working tree).
- Review the current `index.html`, `recorder.js`, `audio.js`, `whisper.js`, and relevant CSS before making changes. Ask the user for current versions of any file that needs editing; do not assume an earlier conversation copy is still authoritative.
- Keep the existing single-segment record → play → transcribe workflow as the reference behavior.

### Restore Delete/reset without Pause/Resume changes

Implement and test Delete on a single uninterrupted recording first. Ensure it:
- stops active recording safely, if applicable;
- stops all microphone tracks and releases the stream;
- clears the current session and all segment/chunk arrays;
- pauses and unloads the audio player;
- revokes the current object URL;
- clears the transcript;
- restores the controls and status to a clean ready state;
- prevents asynchronous recorder events from repopulating deleted state.

Also clear the prior transcript and recording when starting a fresh session. Test both ordinary completion followed by Delete, and Delete while recording. Keep this change separate from Pause/Resume architecture.

### Verify the single-segment baseline

Test recording, stopping, playback, transcription, a second recording, and Delete. Confirm the second recording contains no audio or text from the first. Test on desktop Chrome and iPhone Safari/GitHub Pages where practical, since the browsers may produce different formats.

Do not proceed until the uncomplicated workflow is dependable.

### Specify session state transitions

Before coding Pause/Resume, agree on what each control means:
- **Start Recording** begins a new session.
- **Pause** closes the current segment but keeps the session open.
- **Resume Recording** starts another segment in that same session.
- **Stop Recording** finalizes the session, not merely the most recent segment.
- **Delete** abandons the session and removes its in-memory results from the UI.

Define which controls are enabled in each state and what happens if microphone access fails. Ensure final Stop and Delete cannot be confused with Pause.

### Implement segmented capture without merging Blobs

Store each valid segment in an ordered session object. Keep session state separate from the current recorder instance and its `audioChunks`. A new segment should reset only the current segment's chunks; it must not erase already completed segments in the same session. A new session, by contrast, must start with an empty segment list.

Avoid global state where a clear session object would make ownership and lifecycle more explicit. Do not retain unused flags merely because they existed in an earlier iteration.

### Make playback predictable

First test the segment list and segment metadata independently. Then implement playback of segments in order, with clear behavior at segment boundaries and accurate overall completion handling. Validate:
- one segment;
- two segments with a short pause;
- several segments;
- repeated play of the same session;
- pause/resume near the beginning and end of a segment;
- Delete while playing;
- desktop Chrome and iPhone Safari.

Use known test phrases at the start and end of every segment so missing sections are obvious. Do not rely only on the browser's displayed duration as proof of integrity.

### Transcribe all segments in order

The first dependable implementation can transcribe the segments one at a time, then combine their text in session order. This avoids requiring the transcription pipeline to decode a fragile concatenated container. Decide how to handle punctuation and sentence boundaries across pauses; do not assume a pause must always create a new paragraph.

Test that every segment's distinctive spoken words appear in the final transcript, in order, and that repeated transcriptions do not accumulate text from older sessions.

### Consider real-time or parallel transcription only after capture is stable

Possible future approaches include transcribing a completed segment while the next segment is being recorded, or running transcription concurrently with capture. Evaluate these only after the segmented session model is reliable.

Any such work must be tested for:
- dropped or truncated audio;
- recorder timing and memory pressure;
- CPU/GPU contention and device heat;
- microphone interruptions and browser lifecycle changes;
- ordering of transcript results;
- cancellation and error recovery;
- mobile behavior, especially Safari.

If concurrency degrades capture, defer it. Capturing the audio correctly and preserving the originals is more important than immediate text.

## Test and acceptance checklist

A feature is not complete just because it works once. For each stage, use repeatable tests and record the results.

### Capture integrity
- [ ] One uninterrupted recording plays from beginning to end.
- [ ] A multi-segment session preserves every segment.
- [ ] Distinct phrases spoken at the beginning, middle, and end are all audible.
- [ ] Replaying the same session multiple times produces the same complete result.
- [ ] The source segment Blobs remain intact and have appropriate MIME types.
- [ ] A new session does not include previous-session audio.

### Pause/resume
- [ ] Pause ends the current segment without discarding it.
- [ ] Resume starts a new segment in the same session.
- [ ] Final Stop finalizes the whole session, not merely the most recent segment.
- [ ] The UI accurately communicates recording, paused, and completed states.
- [ ] Repeated pauses/resumes do not lose or duplicate segments.

### Delete and reset
- [ ] Delete clears the audio player and transcript.
- [ ] Delete stops capture and releases microphone tracks.
- [ ] Delete revokes any object URL and clears session state.
- [ ] Late recorder events do not restore deleted content.
- [ ] Starting a new recording clears the previous transcript and recording state.

### Transcription
- [ ] Every segment is transcribed.
- [ ] Text is combined in segment order.
- [ ] No earlier session's text is appended accidentally.
- [ ] Errors in one segment are reported without silently presenting a partial transcript as complete.

### Cross-browser
- [ ] Desktop Chrome / WebM-Opus.
- [ ] iPhone Safari / MP4-AAC.
- [ ] Repeat playback and multiple sessions on both platforms.

## Relationship to Memora

Keep the recording layer loosely coupled to transcription and export. iMuse should produce a clear session representation containing audio segments and metadata. A future integration with Memora can then decide how to persist the original audio, transcribe the segments, edit text, combine sessions, export documents with audio links, and index the transcript for lexical and semantic search.

Do not duplicate Memora's mature file-processing and export functionality prematurely inside iMuse. Define a stable handoff format or interface later, once the capture/session model is proven. Preserve original audio rather than replacing it with a derived combined file.

## Working method

- Make one focused change at a time.
- Before editing any file, obtain its current version if it has not been supplied in the current working session.
- For a small one-line change, give the exact location and surrounding code. For multiple changes in one file, provide a complete replacement file. When code files are updated, provide a ZIP containing the changed file(s) under their original filenames.
- Test each change before moving on.
- Remove temporary diagnostic logging and UI once it is no longer needed.
- Commit at stable, known-good checkpoints.
- Avoid speculative patches to media-container handling. First define the intended behavior, then test the smallest implementation against known audio examples.

## Immediate next action

Start by verifying the current baseline and current file versions. Then restore and test Delete/reset and clearing the transcript on a new session, without changing Pause/Resume in the same edit.

Next, define and implement the IndexedDB session/chunk data model and crash-recovery path. Validate incremental persistence before undertaking the new Pause/Resume design. After that, implement ordered segments and reliable final-file assembly, preserving all original segments until the merged file has been validated and persisted.

Only after preservation, recovery, and final-file creation are dependable should real-time or parallel transcription be considered.
