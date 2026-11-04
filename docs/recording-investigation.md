# Recording reliability and iPhone background capture

Updated 3 November 2026. This is the current recording reference. The four preservation stages and interface cleanup are implemented; no further stage is underway. The [roadmap](iMuse%20next%20steps.md) owns future priorities. Detailed experiment/stage history is [archived](Archive/recording-investigation-stages-2026-11-03.md).

## Current code ownership

[recording-library.js](../js/recording-library.js) now owns the Saved/Recently Deleted lists, selection and confirmation controls, saved-player dialog and its object URL. It receives callbacks for reading sessions, recovery/export, deletion/restore, diagnostics and pausing current playback. Constructing it does not acquire a microphone, open a database, or render the page.

[recording-store.js](../js/recording-store.js) owns recording database initialization, session/chunk reads and writes, delete/restore transactions and diagnostic-event I/O. It receives the existing write coordinator and an idle-session guard. It keeps the database name, version 2, keys, indexes and transaction behavior. Construction is lazy; opening/readiness remain explicit. A blocked open that later succeeds closes the unused connection instead of silently marking failed initialization ready.

[recording-recovery.js](../js/recording-recovery.js) now owns retained emergency assemblies, bounded reads, the finalization watchdog, chunk assembly/checks, saved recovery/export and finalization outcome decisions. It receives storage and presentation callbacks, and imports the existing integrity rules. Its constructor has no storage, timer or DOM effects. It does not own the microphone, audio elements, pending-write queue or writer lease.

[recorder.js](../js/recorder.js) retains capture, recording transitions, pending chunks, wake/silence analysis and the top player. The approved `voice-controller.js` extraction now owns command coordination, countdown presentation and Go/Stop/Yes/No sequencing through recorder-owned session capabilities; [voice-controller acceptance](voice-control-refactor.md) is pending on devices. It creates the three modules and delegates through their interfaces. It updates counters only after a store commit, performs microphone cleanup through a callback when finalization is delayed, and releases the writer lease only after recovery/finalization processing settles. The recovery service marks finalization finished/clears its watchdog at that boundary. Recovery/initialization keep the existing explicitly owned metadata-write path inside the coordinator, avoiding a nested queue. Settings' read-only diagnostics remain separate.

These are approved extractions, not a storage redesign or an implementation of strict durability/OPFS. No schema migration or audio format change was added. The user reported all three extractions and the confirmed Discard correction worked, including on iPhone. The simulated failure's extra memory tail was about one word plus a fraction, consistent with rapid protective stopping; this does not measure a prolonged real storage stall. Broader acceptance limits remain below.

After discussing voice-extraction risks, the user approved a lower-risk unused-code cleanup instead. Removed the uncalled startup capture probe, readiness-tone helpers, audio-context closer and saved-playback alias used only by tests. Ordinary cues, pause reminders and live capture/voice/lifecycle logic remain unchanged. No new module was added by this cleanup; eight controlled tests pass. Export/diagnostic/test-interface extractions remain separate possible work. The subsequently approved command-controller extraction is described in the current ownership paragraph and voice-control plan.

## Current behavior

| Area | Implemented behavior |
| --- | --- |
| Incremental saving | Received chunks and counters commit together in IndexedDB. Pending audio is released only after commit. An 8 MiB pending threshold requests a protective stop; it is not a total-memory cap. |
| Session consistency | Serialized updates preserve committed counters and newer lifecycle state. A Web Locks lease protects one writer through finalization; other updated tabs cannot modify its session. |
| Recovery | One entry per session automatically uses the fullest available copy. Recovery keeps interruption/error history and does not turn partial audio into normal completion. |
| Emergency audio | Available committed audio and the pending tail are retained independently of the player. Starting another recording or requesting a download does not release them. A smaller fallback cannot replace a fuller retained copy. |
| Completion checks | Sequences, chunk data, counts, byte totals and known received counts are checked. Unexpected stops, encoder errors, failed checks and delayed finalization retain interrupted/error outcomes. |
| Delayed finalization | A 10-second watchdog offers available audio; relevant reads have a 2-second fallback. Timers need JavaScript execution. Pending writes retain ownership until they settle; a new recording waits rather than competing with them. |
| Browser protection | One nonblocking persistence request at initialization. Opening Settings checks the current grant and displays status; there are no manual protection buttons. |
| Saved recordings | **▶** opens a separate player dialog. The top player retains the current in-memory recording. Rows show KB, Download audio, Delete and a small download button beside Stop diagnostics. Recently Deleted also shows KB. |
| Deletion | Delete moves saved audio to Recently Deleted. Interrupted recovery copies offer **Discard…**, with confirmation that unsaved audio will be lost; the committed prefix moves to Recently Deleted before memory is released. Pending writers remain protected. Permanent deletion is explicit. |

The IndexedDB schema remains version 2. These changes do not migrate/clear recordings or add a file picker to capture. Normal audio cues remain; interruption-warning code, setting and WAV have been removed completely.

Recovery copies already use the recorder's original format, typically M4A/AAC on supported devices. Their difference is storage state, not a conversion requirement. The list explicitly marks interruption and memory-only audio. Confirming Discard clears that recovery copy and its own player, preserving a different current recording. Cancellation or a failed soft-delete leaves it retained; a still-writing session cannot be discarded. Only the previously committed prefix can be restored from Recently Deleted after a successful discard.

## What is and is not protected

Committed audio can be recovered after reopening. **Memory-only emergency audio cannot survive closure, reload or OS process termination unless it is successfully persisted or exported.** Automatic retries for that tail are not implemented. Download initiation does not confirm a usable file reached Files/Downloads; open important exports and check them.

Structural checks establish storage consistency, not microphone continuity, decodable media, or preservation of every spoken word. The requested 250 ms timeslice does not bound final loss to 250 ms. Audio the OS never delivered cannot be reconstructed.

Persistent storage reduces automatic-eviction risk where granted. It is not a backup, space reservation, or protection against explicit website-data removal/app deletion. Safari and an installed app may use separate storage. WebKit documents browser-controlled grants in its [storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

Web Locks protection covers cooperating updated pages in the same storage scope. Load the current build in all tabs before testing. A browser without usable Web Locks refuses recording/storage mutations with an explanation. Suspension can delay timers; a permanently stalled write cannot be forced to complete by the watchdog. Long-file getAll/Blob assembly and total memory remain unbounded by the pending threshold.

## Evidence and user-reported results

### Microphone-level evaluation

The separate [wake-word and filename lab](wake-word-evaluation.md) now provides a simple recorder, local Whisper filename suggestions and Silero speech-gated Heed/Voicute detection. The earlier clip-review lab is archived with its separate storage preserved. Production wake behavior is unchanged.

**Settings → Microphone levels → View** shows one needle-style RMS dBFS meter above both thresholds; the initial duplicate readouts were consolidated at the user's request. The dial spans −70 to 0 dBFS, with an exact numeric reading even below that range. Before recording, click **Check microphone level (10 s)**. During recording or pause the same meter automatically uses the recording input. It measures normalized input after browser microphone processing, before Heed's filtering/preprocessing—not model confidence, peak level or calibrated room sound pressure. Less-negative values mean louder input.

**Mark quiet room** and **Mark noisy room** place Q/N reference markers at the current measured level. No universal room-to-dBFS bands are assumed. Markers last until reload, do not affect thresholds and should be remeasured after microphone/gain changes. They are available only for finite live readings. The dial includes text/shape identifiers rather than relying on color, and respects reduced-motion preferences.

The user requested damping after the initial dial felt too rapid. Displayed dBFS now uses an exponential average (25% of each new sample every 200 ms), settling about 94% of a change in two seconds, with a short needle transition. The number and Q/N markers use the same smoothed value; let it settle before marking. Inactive/unavailable states clear immediately and reopening starts fresh. This is display-only: the analyser samples, silence threshold and wake processing are unchanged.

Polling runs every 200 ms only while Settings, the disclosure and the page are visible. The meter uses a reusable separate buffer and never acquires audio itself. The explicit check action opens a temporary stream/analyser through the microphone manager, using the selected device and the same processing requests. It creates no MediaRecorder, voice models or recording data. Invalid, muted, suspended/interrupted or inactive input clears stale readings; digital silence displays −∞ dBFS. Closing Settings or the level disclosure, hiding/leaving the page, or reaching the ten-second measurement deadline stops the temporary check, releases its tracks and closes its context. Recording start cancels it immediately and awaits existing resource cleanup before acquiring recording input; a late canceled permission result is released without becoming the recording owner. Closing Settings during an actual recording stops only meter polling, not capture. Silence threshold remains active; **wake-word minimum remains evaluation-only** and does not filter activations.

The microphone-processing report preserves the actual successful acquisition request separately from browser-returned settings. **iMuse requested** shows preferences (or Not requested), **Browser reports** shows available settings, and **Browser control** distinguishes Exposed, Not exposed and Unknown when the support query fails. Not exposed does not mean processing is off. The user’s Chrome reports AGC off; the iPhone omits AGC/noise-suppression controls and settings, so their state cannot be verified. Last acquired identifies the previous stream’s snapshot. Reporting changes do not strengthen constraints or change capture behavior.

Use the check to measure/mark the quiet room, then household conversation/noise, then compare your intended wake phrase at the usual microphone distance. Let the damped meter settle before placing a marker. Verify readings while paused and after Stop. Check browser-reported AGC rather than assuming the request was honored. An eventual gate can reject quieter distant conversation, but cannot identify the speaker or reject equally loud voices. No gate, streaming fix, model change or voice refactor is included. The reviewed Heed buffering and upstream Voicute concerns remain hypotheses, not established causes of the separate standalone app's false activations. Native dial layout still requires device inspection.

| Environment | Background capture | Storage protection |
| --- | --- | --- |
| MacBook Chrome tab | Successful | Granted |
| MacBook Chrome installed app | Successful | Not separately reported |
| MacBook Safari Dock app | Successful | Not separately reported |
| MacBook Safari tab | Not separately established by the installed-app test | Not granted |
| iPhone Safari tab, warning removed | Successful | Not granted |
| iPhone installed iMuse | Double beep and capture loss | Granted |
| iPhone installed minimal recorder | Same double beep and capture loss | Not tested |
| Edge | Not reported | Not granted |

The user reported Stage 2 seemed to work and Stage 3 looked okay. During the failure test, emergency audio remained accessible after another recording: 233,965 bytes versus an eight-chunk committed prefix of 213,314 bytes. Endings sounded alike; extra bytes do not establish an audible improvement. A separate exported-file comparison was not explicitly confirmed. Disappearing PWA recordings were not established as a regression: previous deletion/reinstallation made the baseline uncertain, and Safari still held its recordings.

These are reported outcomes, not full device certification or traces for every acceptance step. Long-duration, locked-screen and current dialog-layout acceptance remain distinct checks. Record exact deployed revision, device/OS, container and microphone when reporting new results.

## iPhone background problem: separate and unresolved

Installed-iPhone loss predates the spoken warning. Independently, playing that warning during backgrounding could stall Safari-tab capture; removing it restored the reported Safari route. Reinstalling and rebooting did not resolve installed loss. Mac success does not establish iPhone installed behavior.

The installed capture-only lab reproduced the loss without production processing, cues, voice models, silence logic, wake lock, persistence writes or audio-session controls. Explicit Automatic/Play and record selection provided no improvement. A corrected direct-tap microphone declaration was accepted but also provided no improvement. These experiments were reverted; do not repeat or restore them without a new hypothesis. The minimal reproducer remains in commit `1cf3423` (reverted by `a739a57`).

Reviewed Safari logs showed all received chunks committed, even when background speech was missing. Context resuming, a live track, recorder state or the microphone indicator alone did not establish acquisition. The exact OS/host mechanism and meaning of the beep remain unverified. [WebKit issue 236509](https://bugs.webkit.org/show_bug.cgi?id=236509) is a historical close match, not proof of a current fix. The prior forum search found no verified same-PWA iOS 26→27 repair comparison; a Safari 27 release note is not such a test.

Continue web-first on the tested Safari-tab route. Await an actual iOS 27 comparison or targeted device-system logs when a suitable cable is available; inspection can change timing. Foreground acquisition repair remains separate from saving received audio. Native recording remains a [conditional proposal](iMuse%20Swift%20migration%20plan.md), not scheduled work. Do not restore warning playback or add speculative keep-alive patches.

## Automated checks

From the repository root:

```sh
python3 -m unittest discover -s tests -v
```

Six suites (nine test methods) cover emergency preservation/player isolation, direct library/recovery components, fault controls, store schema/open failures, coordinated writes, finalization/integrity, persistence policy and the passive meter. Meter checks cover RMS arithmetic, paused/unavailable input and visibility/timer lifecycle. Recovery/store coverage retains late-write, fullest-copy, abort and ownership checks. See [tests/README.md](../tests/README.md) for limits. Python is a development test runner; no real recording or microphone is accessed.

The suites execute production functions with controlled DOM/storage/lock/timer mocks. They do not prove native player rendering, actual IndexedDB behavior, browser permission decisions, container decoding, background capture or multi-hour memory reliability.

## Focused manual checks

Use disposable recordings in an updated build. Do not clear site data or reinstall to test preservation.

1. **Normal capture:** record, pause/resume, Stop, and check beginning/middle/end. Verify the normal saved status, saved **▶** player, download, and unchanged top player. Close the dialog and check a disposable Delete/Restore round trip, including KB in Recently Deleted.
2. **Storage failure:** enable **Settings → Recording preservation test → Enable failure testing for this page**. Record/count for ten seconds, then tap **Simulate storage failure** while recording. Expect automatic stop and a positive unsaved-byte result. Play/export its single entry, make a second normal recording, then play/export the first again. Keep the page open until exports are checked; disable the test afterward. Starting the second recording must not release the first's emergency audio.
3. **Reload recovery:** separately, without needed memory-only audio in the page, reload during capture. Load committed audio and verify interrupted history remains; some ending loss is possible.
4. **Ownership:** prefer two updated Mac tabs at the same URL. Record in A; B must refuse a competing recording or mutation of A's live session. Stop A, then Refresh recordings in B and verify normal playback/download. Do not confuse this with iPhone background capture.
5. **Protection:** open Settings, read status, close/reopen and check that it refreshes. Grants can differ by browser/container. Refusal does not block recording or mean recordings disappear on normal closure.

Stuck writes, missing stop events, encoder errors and malformed structures are simulated in automated tests. Do not fill storage or manually corrupt saved chunks. For real delayed finalization, export available audio before closure and report the exact notice and whether it eventually finishes.

### Short microphone-check acceptance

1. On MacBook and iPhone, open Settings → Microphone levels → View, then Check microphone level (10 s). Confirm level response and the microphone-processing report; no saved recording should appear.
2. Wait for automatic completion and check that microphone access ends. Repeat and stop early, close Settings/disclosure, or background the page.
3. Start Record during a check, then speak, Stop and play. The check must release its input; the recording must retain its own live microphone. Closing Settings while recording must not stop capture.
4. Where permission has not been granted, cancel a pending check by closing Settings or pressing Record. A late response must not resurrect the check or end a newer recording.

Automated coverage and isolated Chrome checks are reported in the journal. Native Safari/iPhone permission timing and indicator behavior remain device checks.
