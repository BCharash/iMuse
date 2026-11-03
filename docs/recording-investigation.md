# Recording reliability and iPhone background capture

Updated 3 November 2026. This is the current recording reference. The four preservation stages and interface cleanup are implemented; no further stage is underway. The [roadmap](iMuse%20next%20steps.md) owns future priorities. Detailed experiment/stage history is [archived](Archive/recording-investigation-stages-2026-11-03.md).

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
| Deletion | Ordinary Delete moves saved audio to Recently Deleted. Permanent deletion is explicit. Unsaved emergency copies and sessions still being written cannot be deleted through saved-list actions. |

The IndexedDB schema remains version 2. These changes do not migrate/clear recordings or add a file picker to capture. Normal audio cues remain; interruption-warning code, setting and WAV have been removed completely.

## What is and is not protected

Committed audio can be recovered after reopening. **Memory-only emergency audio cannot survive closure, reload or OS process termination unless it is successfully persisted or exported.** Automatic retries for that tail are not implemented. Download initiation does not confirm a usable file reached Files/Downloads; open important exports and check them.

Structural checks establish storage consistency, not microphone continuity, decodable media, or preservation of every spoken word. The requested 250 ms timeslice does not bound final loss to 250 ms. Audio the OS never delivered cannot be reconstructed.

Persistent storage reduces automatic-eviction risk where granted. It is not a backup, space reservation, or protection against explicit website-data removal/app deletion. Safari and an installed app may use separate storage. WebKit documents browser-controlled grants in its [storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

Web Locks protection covers cooperating updated pages in the same storage scope. Load the current build in all tabs before testing. A browser without usable Web Locks refuses recording/storage mutations with an explanation. Suspension can delay timers; a permanently stalled write cannot be forced to complete by the watchdog. Long-file getAll/Blob assembly and total memory remain unbounded by the pending threshold.

## Evidence and user-reported results

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

Five suites cover emergency preservation/player isolation, the failure control, coordinated writes/ownership, finalization/integrity, and persistence policy/Settings. They share one harness. See [tests/README.md](../tests/README.md) for coverage, prerequisites and limitations. Python is a development test runner, not an application dependency; no real user recording or microphone is accessed.

The suites execute production functions with controlled DOM/storage/lock/timer mocks. They do not prove native player rendering, actual IndexedDB behavior, browser permission decisions, container decoding, background capture or multi-hour memory reliability.

## Focused manual checks

Use disposable recordings in an updated build. Do not clear site data or reinstall to test preservation.

1. **Normal capture:** record, pause/resume, Stop, and check beginning/middle/end. Verify the normal saved status, saved **▶** player, download, and unchanged top player. Close the dialog and check a disposable Delete/Restore round trip, including KB in Recently Deleted.
2. **Storage failure:** enable **Settings → Recording preservation test → Enable failure testing for this page**. Record/count for ten seconds, then tap **Simulate storage failure** while recording. Expect automatic stop and a positive unsaved-byte result. Play/export its single entry, make a second normal recording, then play/export the first again. Keep the page open until exports are checked; disable the test afterward. Starting the second recording must not release the first's emergency audio.
3. **Reload recovery:** separately, without needed memory-only audio in the page, reload during capture. Load committed audio and verify interrupted history remains; some ending loss is possible.
4. **Ownership:** prefer two updated Mac tabs at the same URL. Record in A; B must refuse a competing recording or mutation of A's live session. Stop A, then Refresh recordings in B and verify normal playback/download. Do not confuse this with iPhone background capture.
5. **Protection:** open Settings, read status, close/reopen and check that it refreshes. Grants can differ by browser/container. Refusal does not block recording or mean recordings disappear on normal closure.

Stuck writes, missing stop events, encoder errors and malformed structures are simulated in automated tests. Do not fill storage or manually corrupt saved chunks. For real delayed finalization, export available audio before closure and report the exact notice and whether it eventually finishes.
