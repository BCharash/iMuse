# iMuse next steps

**Updated:** 1 November 2026 (end-of-day checkpoint)  
**Status:** Agreed development roadmap and architectural handoff. Planning document, not a runtime certification.  
**Source rule:** `iMuse(9).zip` was an earlier confirmed baseline, not necessarily the current patched build. Obtain the latest relevant source files from the user before any subsequent code change.

## Current checkpoint — 1 November 2026 (supersedes the older “first implementation” instruction below)

**Implemented/reported today:** redesigned Record/Pause/Resume and separate Stop controls; direct manual Stop versus Yes/No-confirmed spoken Stop; bounded **8 MB** pending-audio RAM queue with incremental IndexedDB persistence; Settings storage/heap/pending diagnostics with readable KB/MB/GB formatting; retained peak pending audio after Stop; saved-chunk count accompanied by active recorded seconds; and successful-recovery state promoted from **Recover audio** to **Play saved recording** while retaining interruption history.

**Observed on MacBook:** seven-minute recording with approximately **27 KB peak pending audio** (earlier 8.986 KB), usually zero pending chunks/audio; no demonstrated accumulating pending backlog. Recovery after page reload yielded playable/downloadable audio. The latest post-recovery button persistence change was syntax-checked but has **not yet received a reported reload-after-recovery acceptance test**. Heap fluctuation alone is not a leak indicator. These results are encouraging, not a multi-hour or iPhone certification.

**Immediate next action:** perform the focused recovery-button persistence test, then the 10–15-minute iPhone normal recording, iPhone interrupted-recording recovery, and 30-minute iPhone finalization tests. Evaluate `getAll()`/Blob final assembly only after collecting those results. **Do not restart Phase 1 or redo the bounded-queue implementation.**

**Current scope correction:** headset media-button controls were retired on both desktop and mobile on 31 October. Shokz microphone selection remains supported; remove headset-button regression requirements from active testing. Recently Deleted and bulk permanent deletion exist; bulk deletion still needs its own focused acceptance test.

---

## 1. Goal and non-negotiable invariants

Develop iMuse's Record capability for eventual integration into Memora (which already has Transcribe, Edit/Combine, and Search). Record is an independent, robust audio-capture subsystem. Whisper, wake detection, speech commands, naming, and combining are never prerequisites for recording or crash recovery.

- Persist audio incrementally in IndexedDB while recording. Preserve completed and interrupted recordings; never delete source audio as a side effect of transcription, combining, naming, export, or integration.
- Recording, pause/resume, manual Stop, voice commands, silence detection, and recovery must remain functional on MacBook and iPhone.
- Minimize loss of already captured audio. Browser/OS crashes, delayed MediaRecorder events, quota exhaustion, and browser storage eviction prevent an absolute guarantee.
- Preserve actual MIME/container/codec metadata. Do not assume that a 250 ms MediaRecorder timeslice yields independently playable files, or that WebM/Opus can be losslessly merged into AAC/M4A.
- Keep components cleanly separated for eventual native iOS/Android implementations and Memora integration.
- Implement in small, independently tested phases, with stable Git commits and rollback between phases. Do **not** attempt all changes in one patch.

## 2. Current implementation checkpoint — preserve during changes

- Selectable wake engines: **Heed / “Hey Doc”** and **Voicute / “Hey Friday”**. Both have been reported working on MacBook; field reliability needs further testing.
- After wake, a bounded TensorFlow.js command window recognizes Go/Stop, with Yes/No confirmation for spoken Stop. Spoken Stop must **not** finalize without Yes; No or timeout leaves the recording paused. Manual Stop does **not** need confirmation.
- Wake during recording pauses first; wake while paused acknowledges “Yes?”. Automatic silence pause and manual pause do not themselves launch TensorFlow.
- Command window uses a small solid light-blue circular countdown, emptying counterclockwise from 12 o'clock. Preserve existing thresholds, window, overlap settings, and tested recognition sequencing.
- Spoken cues: “New recording” on initial start, “Pause” on pause, “Recording” on resume, “Recording stopped” on stop, and “Yes?” for wake while paused. Retain periodic **double beep approximately every 4.5 seconds** while paused.
- Microphone manager selects available input, with manual override; maintain Shokz/built-in microphone selection and microphone release (headset media-button control has been retired). Shared spoken-response manager serializes WAV cues. Existing settings include silence duration and wake/command thresholds.
- Current paths include `js/heed/`, `js/voicute/`, `js/tensorflow/`, `js/microphone-manager.js`, and `js/audio-response-manager.js`; do not revive obsolete `js/voice/` proposal.
- Idle wake before first Record remains **deferred**; do not add it as part of the present roadmap without a separate decision.
- Existing code was reported to persist chunks and session metadata in IndexedDB, reconstructing Blobs for playback/finalization; an in-memory `memoryChunks` fallback may grow throughout recording. Re-audit the exact latest implementation before changing it. Do not treat prior conversational code descriptions as formal verification.

## 3. Agreed implementation sequence

### Phase 1 — Record button redesign (**implemented; regression testing remains**)

Make a focused UI/state change without changing audio capture, persistence, or speech recognition.

- Large, prominent **Record** icon is the primary button. A separate large **Stop** icon is below it.
- Idle: heading **“New Recording”**, main button Record, Stop disabled.
- Recording: heading **“Recording in progress”**, main button changes to Pause, Stop enabled.
- Paused (manual, automatic silence, or voice-triggered): heading **“Paused”**, main button changes to Record/Resume, Stop enabled.
- Stopping/finalizing: clearly indicate processing, disable conflicting actions; after successful stop return to ready/new state. Handle errors without falsely indicating completion.
- Button, heading, and status always derive from **one authoritative recorder state**, not from separate UI flags. Voice commands and auto-pause must update the same UI.
- Manual Stop finalizes without Yes/No confirmation; **spoken Stop retains confirmation**. Preserve cues, double beep, wake behavior, command-window timer, microphone selection, and settings.
- No New/Append radio buttons. **Appending during capture is abandoned**; combining is a separate post-recording operation.

**Acceptance:** MacBook and iPhone manual Record/Pause/Resume/Stop; silence pause; wake/Go/Stop/Yes/No; repeated transitions; reload recovery; no regression in audio or cues. Freeze a stable commit.

### Phase 2 — Memory management and persistence audit (**bounded queue implemented; targeted validation remains**)

Audit and then replace unbounded in-memory retention with a **bounded pending-write queue**:

- Each MediaRecorder chunk is assigned a stable session UUID and monotonically increasing sequence number; persist the Blob plus associated metadata in IndexedDB.
- Hold an uncommitted chunk in RAM until its IndexedDB transaction **completes successfully**. Then release its in-memory reference. Do not rely on a timer alone to declare a chunk safe.
- Bound pending byte count, pending write count, and retry/backlog behavior. Measure write latency, quota errors, long recordings, and browser suspension on iPhone.
- On write failure, retain uncommitted chunks within a defined temporary limit, alert the user, retry safely, and transition to a safe state if the backlog cannot be persisted. Never silently discard chunks or accumulate unlimited RAM. Specify exact safe-stop behavior after inspecting MediaRecorder semantics.
- Maintain sequence integrity and session metadata atomically where practical. Ensure stop/finalization waits for pending writes, handles the final data event, and does not race pause/resume or command callbacks.
- Avoid `getAll()` of the entire recording for long files where possible; examine cursor/streaming assembly and browser Blob memory behavior. A cursor alone does not guarantee bounded memory if all Blob references are accumulated.
- Preserve recovery of interrupted sessions and the ability to reconstruct the saved audio after a forced reload. Test long sessions and multiple pause/resume cycles.

**Current evidence:** The 8 MB bounded pending-write queue and diagnostics were implemented. Seven-minute MacBook test peaked around 27 KB pending audio, usually returning to zero. This does not validate storage failure paths, iPhone behavior, or long recording finalization.

**Acceptance:** No indefinitely growing JS-managed audio-chunk array; stable memory over extended recording within realistic browser limits; successful recovery after forced reload; explicit handling of storage failure; no lost committed chunks. Freeze a stable commit.

### Phase 3 — Durable finalized recordings, UUIDs, validation, and safe cleanup

Decide and implement a clear two-stage lifecycle: **incremental recovery chunks → validated finalized recording**. Do not delete recovery chunks until the final recording has been durably committed and independently read back. Use versioned IndexedDB migration; never destructively migrate existing sessions.

**Identity and metadata**

- Use `crypto.randomUUID()` (UUIDv4) for each new capture session **before the first chunk** and a **new UUID** for each combined output. Audit fallback handling on supported secure contexts; avoid relying on timestamp-based identifiers for production identity.
- Distinguish immutable **recording UUID**, original **capture UUID/source UUID**, and **segment occurrence** (order and offset; repeated use of one source is allowed). Store parent recording references for provenance.
- Persist capture timestamp, finalization timestamp, media format, duration, display title, source relationships, and versioned segment history. A user-editable title is never an identity key.
- Embed identity and segment history in the final M4A where supported, in addition to IndexedDB. Preserve source recording dates and original identifiers when combining; new combined output gets its own UUID. Ensure exported/reimported M4A retains metadata.
- Existing recordings require a nondestructive migration/backfill strategy; verify behavior when old recordings have incomplete metadata.

**Validation tiers**

1. **Storage:** verify chunk counts, sequence continuity, nonzero sizes, byte totals, pending-write completion, and readback; optional SHA-256 for later integrity comparison.
2. **Container:** for M4A, check ISO BMFF box structure, track/sample tables, offsets, durations, codec configuration; WebM requires its own validation path. Do not conflate Blob concatenation with remuxing independently finalized files.
3. **Decode/playback:** perform practical browser-native duration/seek/limited-decode checks where supported, including iPhone. Browser autoplay restrictions and memory limits mean silent full-file playback/decoding cannot be assumed. Structural validation and limited decode do not prove every spoken word was captured.

**Commit and cleanup**

- Build final output without overwriting source data. Commit completed Blob + metadata, read it back, validate, then mark source chunks eligible for cleanup. Handle interruption between every step with a recoverable state machine and idempotent restart behavior.
- Do not keep two full permanent copies by default. Keep old recovery chunks until successful commit/readback, and avoid deletion if finalization fails.
- Consider browser storage quotas, eviction, persistent-storage requests, and iOS process termination; document residual risks honestly.
- Distinguish **file finalized**, **file structurally valid**, and **audibly complete**; never claim perfect audio validation.

**Acceptance:** Short and multi-hour MacBook/iPhone recordings, pause/resume, interrupted stop, forced reload at different commit stages, storage failure, successful playback/export, UUID consistency, metadata readback, and safe cleanup. Freeze a stable commit.

### Phase 4 — Whisper Tiny assisted naming (only after finalization)

- Run **only after** a recording is safely finalized and persisted; never compete with active capture. Prefer reuse of Memora's Transformers.js/model registry when integrated, avoiding a duplicate model system.
- Transcribe approximately the opening **15–30 seconds** with a lightweight multilingual Whisper Tiny model, subject to device capability and performance testing. Whisper transcribes speech; simple text processing initially derives a concise suggested title. A separate title-generation language model is optional, not required.
- Always create a safe timestamp-based fallback title immediately. Offer an editable suggestion; never overwrite a title the user manually entered. Naming failure never changes recording status or audio.
- Store `displayTitle` separately from UUID, timestamps, original filename, and embedded metadata; choose a consistent export filename and sanitization policy. Do not rename files in a way that changes identity.
- Consider postponing naming while another recording is active, or cancelling/suspending it under memory pressure, especially on iPhone.

**Acceptance:** Good-enough suggestions, editable names, fallback for silence/other languages/model failures, no recording interruption, bounded memory. Freeze a stable commit.

### Phase 5 — Combine Recordings below Saved Recordings (last)

**No separate Combine tab in iMuse.** Memora already has a Combine tab; iMuse's standalone UI places a **“Combine Recordings”** button **below the Saved Recordings list**. This opens a selection-and-ordering workflow, not an append mode in Record.

- Select **two or more** saved library recordings, arrange their explicit order, preview durations, and create a **new** combined recording. Originals are never overwritten, renamed, or deleted by combining.
- New output gets a new UUID, editable title (e.g. `- combined`), source references, and flattened segment history with accurate offsets/dates. A source may itself be a combination; repeated sources are permitted.
- The function accepts recordings **from iMuse's library only**. Later Import can add external audio to that same library, so Combine itself never needs a separate external-file picker or import pathway.
- Use the previously tested **lossless AAC/M4A remuxing approach only for compatible inputs**. Check actual codec, sample description, timescale, channels, and container. WebM/Opus or incompatible M4A inputs require an explicitly designed conversion/remux path or a clear unsupported message; never byte-concatenate independently finalized M4A files.
- The prior standalone lab successfully demonstrated three-segment compatible M4A merging and embedded segment-history metadata, including repeated appending; this is **not yet proof of production support** for every iMuse recording format or device.
- Generate and validate output before committing it as a new Saved Recording. On failure, retain all originals and leave no misleading completed entry. Avoid large in-memory allocations for multi-hour files.
- Design the combining engine as a reusable module so Memora can later call it from its existing Combine tab without duplicating logic or adding another tab.

**Acceptance:** Ordered selections, nested combinations, duplicate sources, correct duration/offsets/UUIDs, metadata surviving export and reimport, playable output on MacBook/iPhone, failure without source loss. Freeze a stable commit.

## 3A. Next test sequence — actionable checklist

1. **MacBook recovery UI:** interrupt during active recording → reload → Recover audio → play/download → reload again → verify **Play saved recording** remains, with no lost previously committed segments.
2. **iPhone 10–15 minutes:** normal recording with manual and auto-pause; verify new Record/Stop states, Stop, playback, download, and audio throughout. Note peak pending audio, but do not overinterpret rapidly changing heap.
3. **iPhone recovery:** interrupt during active recording, recover, reload again, verify playback and persisted button label.
4. **iPhone 30 minutes:** evaluate finalization time, responsiveness, seek/playback near the end, downloaded media, and memory. Record actual failure details if any.
5. **Only then:** decide whether `getAll()` and `new Blob(parts)` need replacement. Avoid equating browser playback with validated container structure; preserve recovery chunks through any migration or finalization failure.
6. **Separate low-risk check:** confirm Recently Deleted multi-select, cancellation, Select all, and one-confirmation permanent deletion of selected items, without touching unrelated recordings.

**Stop confirmation acceptance:** manual Stop finalizes directly; spoken Stop requires Yes; No or timeout must not finalize. Preserve the existing cue and countdown behavior.

---

## 4. Cross-cutting tests and architecture audit

Before or alongside each affected phase, review: single-owner microphone acquisition/disposal; temporary `getUserMedia` interception by TensorFlow adapter; stale callbacks and races between pause/stop, cue playback, confirmation, command-window generation, and manual actions; microphone-status accuracy; storage queue backpressure; cleanup on failures. Recognition must never block or invalidate durable capture.

Regression matrix: MacBook built-in and Shokz microphones; iPhone supported browser/PWA; both wake engines; manual and automatic pause; voice Go/Stop/Yes/No; command timeout; spoken cue ordering; periodic double beep; timer sweep; microphone release; recovery after forced reload and subsequent reload; recording playback and download; short and long recordings; browser storage errors. Headset media-button controls are retired and are not a regression requirement. Capture reproducible failures with steps, actual states, and device/browser details. Do not treat syntax checks as device certification.

## 5. Memora integration and future items

- Use the active `iMuse Memora integration handoff.md` when planning integration. Record remains a first-class independent subsystem; Memora owns Transcribe and its model registry, and already has Edit/Combine and Search. Avoid duplicate file pickers, model downloads, and inconsistent UUID handling.
- The standalone iMuse Combine button may later delegate to Memora's existing Combine UI while reusing the same underlying engine/library interfaces.
- **Deferred, not part of these five phases:** idle wake before first Record; custom universal “Hey iMuse” wake word; reversible removal of spoken commands from exported audio; native Swift/Android development; iPhone headset media buttons; unsupported cross-codec conversions without dedicated tests.
- For deferred idle wake, the earlier design was: when Audio commands is enabled and app is foregrounded, wake phrase → “Yes?” → Go starts a new recording; Stop/timeout returns idle. Must separately design microphone handoff and not promise background/locked-screen iPhone operation.

## 6. Working rules and immediate next action

- **Next implementation/test:** Phase 1 UI and the Phase 2 bounded queue are already implemented. First verify recovered-recording button persistence after a second reload; then run the iPhone 10–15-minute normal, interrupted-recovery, and 30-minute finalization tests. Do not start a new storage migration before reviewing those results.
- User provides latest authoritative source before any later modifications; do not assume an older ZIP remains current.
- Deliver **only changed code files**, bundled in a ZIP with exact original filenames and relative paths; no suffixes/parentheses added to filenames inside the ZIP. Provide complete file replacements. Remove temporary diagnostics after tests.
- For each phase, explain the change and test checklist; user verifies on MacBook/iPhone before next phase. Maintain stable commits and update this roadmap when decisions change.
- This roadmap supersedes earlier priority ordering where it conflicts, while retaining the earlier voice-control and crash-recovery invariants. Historical experiments remain in the design journal.
