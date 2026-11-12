# Recording reliability and iPhone background capture

Updated 11 November 2026. This is the current recording reference. The four preservation stages and interface cleanup are implemented; no further preservation stage is underway. The [roadmap](iMuse%20next%20steps.md) owns future priorities. Detailed experiment/stage history is [archived](Archive/recording-investigation-stages-2026-11-03.md).

**Earlier accepted wake checkpoint: build 2026-11-05.3.** The user tested the wake refactor and separately approved race corrections, reported they worked as expected and called the work a success. That wake-refactor checkpoint passed **89 methods across thirteen suites**; the accepted download checkpoint passed **94 methods across fourteen suites**. Production Silero candidate 2026-11-11.1 adds state-specific wake gating, with 106 methods across fifteen suites passing; [device speech acceptance](voice-control-refactor.md#state-specific-silero-speech-checking) remains pending. Model loading/inference delegate through `js/wake-detector.js`; readiness, microphone/audio graph, buffers, session/busy guards and timers remain recorder-owned. At that wake-refactor checkpoint, models and audio delivery were unchanged. Device/browser and individual scenarios were not specified; the report does not establish platform-wide recognition accuracy, latency or background capture. Current behavior is in the [voice-control guide](voice-control-refactor.md#wake-race-corrections), with detailed staged history [archived](Archive/voice-control-history-2026-11-05.md).

## Current code ownership

[recording-library.js](../js/recording-library.js) now owns the Saved/Recently Deleted lists, selection and confirmation controls, saved-player dialog and its object URL. It receives callbacks for reading sessions, recovery/export, deletion/restore, diagnostics and pausing current playback. Constructing it does not acquire a microphone, open a database, or render the page.

[recording-store.js](../js/recording-store.js) owns recording database initialization, session/chunk reads and writes, delete/restore transactions and diagnostic-event I/O. It receives the existing write coordinator and an idle-session guard. It keeps the database name, version 2, keys, indexes and transaction behavior. Construction is lazy; opening/readiness remain explicit. A blocked open that later succeeds closes the unused connection instead of silently marking failed initialization ready.

[recording-recovery.js](../js/recording-recovery.js) now owns retained emergency assemblies, bounded reads, the finalization watchdog, chunk assembly/checks, saved recovery/export and finalization outcome decisions. It receives storage and presentation callbacks, and imports the existing integrity rules. Its constructor has no storage, timer or DOM effects. It does not own the microphone, audio elements, pending-write queue or writer lease.

[recorder.js](../js/recorder.js) retains capture, recording transitions, pending chunks, the shared wake/silence audio graph, buffers/timers and top player. [wake-detector.js](../js/wake-detector.js) owns adapter loading and inference routing; [voice-controller.js](../js/voice-controller.js) owns command coordination, countdown and Go/Stop/Yes/No sequencing through recorder-owned capabilities. The user accepted the wake-refactor/race-fix checkpoint; the [voice regression checklist](voice-control-refactor.md#acceptance-after-a-production-extraction) remains guidance for future changes, not an instruction to repeat completed work. Recorder counters update only after a store commit; delayed finalization uses recorder-owned microphone cleanup, and the writer lease releases after recovery/finalization settles. Recovery marks finalization finished/clears its watchdog at that boundary. Recovery/initialization retain their explicit metadata-write path inside the coordinator, avoiding a nested queue. Settings diagnostics remain read-only.

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

### Download naming

**Accepted download checkpoint: build 2026-11-05.6.** After the retained-player fix, the user reported “okay that worked.” This confirms the reported current-player download scenario after permanent deletion; device/browser and a full scenario matrix were not specified.

A filename dialog appears only when Download is selected, from either Saved recordings or the current recording. The description starts as `iMuse`; the fixed prefix is local recording-start date/time, for example `2026-11-05_14-32-08_iMuse.m4a`. The preview uses the actual audio format's extension. Unsupported filename characters are replaced with hyphens; an empty description falls back to `iMuse`. Cancel/Escape starts no download and retains all audio. Descriptions apply to that download only, without renaming stored recordings or adding editable fields to the list. Whisper suggestions are not implemented.

Once a stopped recording appears in the main player, Download audio file appears beside Delete. The player retains the assembled audio Blob and a snapshot of its default filename. Deleting or permanently deleting the database copy leaves this ordinary current-player copy playable and downloadable, without an additional message. Download no longer reads the deleted session's metadata. Starting the next recording clears this player; clearing/replacing it clears/replaces the retained filename too. This temporary player copy does not provide reload/closure recovery. Explicit emergency Discard remains a separate action that releases the retained emergency copy and its matching player.

Build .4 introduced the naming dialog; .5 corrected the uncalled current-player button creation; .6 removed the download's database-metadata dependency. Those intermediate bugs are corrected.

New recordings store their local start-time prefix alongside the existing UTC timestamp, preserving it across timezone changes. Older recordings lack the original timezone: their prefix uses the stored start instant in the device's current local timezone. No database version change or backfill is needed. Saved-audio assembly releases the storage writer lock before waiting for the filename choice.

Focused acceptance: download an existing and a new recording; edit the description and check the resulting filename/audio; cancel a second download; check the current-player download uses recording-start time and still works after permanently deleting that saved recording. Check the dialog and keyboard on iPhone and desktop. Automated checks do not establish browser/device download behavior.

### Storage and temporary copies

Committed audio can be recovered after reopening. **Memory-only emergency audio cannot survive closure, reload or OS process termination unless it is successfully persisted or exported.** Automatic retries for that tail are not implemented. Download initiation does not confirm a usable file reached Files/Downloads; open important exports and check them.

Structural checks establish storage consistency, not microphone continuity, decodable media, or preservation of every spoken word. The requested 250 ms timeslice does not bound final loss to 250 ms. Audio the OS never delivered cannot be reconstructed.

Persistent storage reduces automatic-eviction risk where granted. It is not a backup, space reservation, or protection against explicit website-data removal/app deletion. Safari and an installed app may use separate storage. WebKit documents browser-controlled grants in its [storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

Web Locks protection covers cooperating updated pages in the same storage scope. Load the current build in all tabs before testing. A browser without usable Web Locks refuses recording/storage mutations with an explanation. Suspension can delay timers; a permanently stalled write cannot be forced to complete by the watchdog. Long-file getAll/Blob assembly and total memory remain unbounded by the pending threshold.

## iPhone stop-announcement output regression

**Older-baseline comparison prepared:** the .4 playback-intent experiment also failed on built-in iPhone output while Bluetooth remained normal, per the user. Do not treat it as a fix. The start-of-4-Nov ZIP's principal runtime files match `b9f3a87` (3 November), before command-controller extraction. Branch `audio-baseline-test` includes its production runtime under [test/](../test/README.md), with only a labelled HTML page/no install-manifest link and separate database/preferences. Intended published URL: `https://bcharash.github.io/iMuse/test/`. Until that directory is deployed, the URL is not live.

The baseline uses its old recorder, old prompt player, original WAVs, old command adapter and old Hey Doc model. Same-origin browser permissions/quota and OS audio state remain shared; separate names protect production database/settings from normal preview reads/writes. Compare manual Record/Stop with Audio commands off, no headset, same phone/volume, and other capture tabs closed. Report the visible baseline label and whether stopped audio reaches the speaker, receiver or neither. Do not swap selected old files into current production, reset site data, or claim refactoring caused the issue without an older-versus-current device result. The current app source/build is not altered by preparing this preview.

**Next reversible experiment — build 2026-11-12.4.** The temporary instrumentation commit was already reverted by the user (`bf3106d`, reverting `e976eb4`). The supplied paired reports from .3 show media reaching the full 1.056 s duration with volume 1, mute false, `ended`/success, original owned tracks ended and AudioContext closed in both runs. Cleanup took 24 ms in the first run and 28 ms in the second. The user heard Bluetooth playback but neither built-in speaker nor receiver. Both reports contain automatic session type; session state was unavailable. These exclude a reported player mute/volume reduction or unreleased owned track in those runs, but do not identify the physical route or prove a root cause. The later JSON contains the earlier run as well; labels were chosen after recording, so audible-route attribution uses the user's stated order.

Candidate .4 changes only the iPhone stopped-message playback intent: after the existing capture cleanup, at actual serialized playback time, request `navigator.audioSession.type = 'playback'` if supported and no recording/level check is active. Retain the original stop WAV, volume and selected physical output. Restore the previous session type on end/error/timeout; release the request before either recording or temporary microphone-level acquisition. Unsupported APIs/setters fall back to ordinary playback. Mac and other prompts are unchanged. This is a separately reversible experiment, not a verified speaker fix; the earlier standalone playback-mode experiment failed and does not establish that the new scoped test will work.

**Next device action:** verify build .4, make a short recording without a headset and Stop; report whether the original stopped message is audible through the speaker. Then repeat with Bluetooth and check that playback remains in the headset. If the built-in output still fails, revert only this experiment rather than adding more session changes. No new lab, instrumentation label or diagnostic-log replay is required. Latest automated checkpoint: 109 methods across sixteen suites, including iPhone/idle/stop-only gating, original WAV, restoration on completion/error/timeout, immediate capture handoff, unsupported APIs/setters and unchanged Mac behavior. These do not simulate an iPhone's physical routing.

**11 November checkpoint — observe; cause unresolved.** The user reports that the original “Recording stopped” message has returned to normal speaker playback on iPhone and will observe it over time. Do not attribute this to a verified fix. The shutdown-wait candidate initially failed, the problem reproduced with Audio commands off, and the isolated playback-mode experiment also failed to restore speaker output. Other websites and other iMuse prompts remained normal; headset output was normal.

The temporary .6 substitution was not a valid audio A/B result: the iPhone displayed .6 but the user distinctly heard the original “Recording stopped” intonation while it played normally. A mixed cache or session-state change is possible, not established. The user subsequently reverted the experiment. Current checkout is `95291db` (revert of `6569436`, temporary stop-audio substitution), with production build **2026-11-11.5** and `stopped: "audio/recording-stopped.wav"`. The isolated output page/test was also reverted (`0639a27` reverted by `eebb6f4`); do not link to or recreate those removed files automatically. Diagnostics improvements, production Silero and the shutdown-ordering correction remain.

**Original report / candidate 2026-11-11.5.** On 11 November the user reported that “Recording stopped” newly plays softly through the iPhone receiver, in both Safari tab and installed app, while headset playback remains normal and MacBook is unaffected. Treat this as a newly reported regression, distinct from the unresolved background-capture problem. The user did not specify whether manual Stop, spoken Stop or both reproduce it.

Source comparison from the pre-Silero checkpoint (`025dbee`) through the reported build found no changes to the stop WAV, spoken-response player, microphone manager, command adapter or controller stop sequence. Silero owns no microphone/output. This does not exclude indirect timing effects and does not identify the root cause or the exact first affected build.

An existing shutdown-ordering gap was identified: microphone tracks were stopped synchronously, but command-listener shutdown and AudioContext closure were requested without awaiting completion before the stop announcement. The candidate observes both shutdowns, waits for actual completion before the announcement, and logs `stopped-audio-ready` with completion status and elapsed time. A two-second deadline or cleanup failure suppresses only that announcement; it does not prevent already-recorded audio from being finalized, retained or exported. It does not impose a fixed delay, change volume, force an audio route or change headset behavior intentionally. A newer capture/level-check owner suppresses the old announcement.

Automated tests cover pending listener/context completion, completed storage while announcement waits, timeout/failure observation and finalization ownership release. These establish ordering and preservation, not iPhone output routing. The latest retained implementation checkpoint is 106 methods across fifteen suites; no implementation tests were rerun for this documentation-only update.

**Resume only if it recurs:** start with `docs/README.md`, this section, `docs/iMuse next steps.md` and Git status. Verify the actual loaded prompt-player module as well as the build label before interpreting an audio substitution. Record iPhone/iOS version, Safari versus installed mode, exact message, manual versus spoken Stop, Audio commands setting, headset state and whether a fresh session changes it. Copy/download Detailed voice diagnostics, preferably full JSON, around Stop. Preserve original audio and browser storage. No threshold tuning, forced route change, cache-clearing reset or new lab is scheduled during observation. Keep the normal Silero lab available for its separate purpose.

## Evidence and user-reported results

### Microphone-level evaluation

The separate [wake-word and filename lab](wake-word-evaluation.md) now provides a simple recorder, local Whisper filename suggestions and Silero speech-gated Heed/Voicute detection. The earlier clip-review lab is archived with its separate storage preserved. Production wake behavior is unchanged.

**Settings → Microphone → Microphone levels → View** shows one needle-style RMS dBFS meter above both thresholds; the initial duplicate readouts were consolidated at the user's request. The dial spans −70 to 0 dBFS, with an exact numeric reading even below that range. Before recording, click **Check microphone level (10 s)**. Its status counts down the seconds remaining until microphone release. The browser-reported processing report is under **Settings → Microphone → Advanced microphone settings**. During recording or pause the same meter automatically uses the recording input. It measures normalized input after browser microphone processing, before Heed's filtering/preprocessing—not model confidence, peak level or calibrated room sound pressure. Less-negative values mean louder input.

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

Continue using the tested Safari-tab route for web recording. Await verified platform evidence or targeted device-system logs when a suitable cable is available; inspection can change timing. Reported OS labels and earlier references to an iOS/Safari 27 comparison are not independently verified device/build evidence. Foreground acquisition repair remains separate from saving received audio. A small native recorder is deferred pending equipment; the [conditional native proposal](iMuse%20Swift%20migration%20plan.md) now includes possible transcription/model management after capture verification. Do not restore warning playback or add speculative keep-alive patches.

## Automated checks

From the repository root:

```sh
python3 -m unittest discover -s tests -v
```

The last verified implementation checkpoint has **fifteen suites and 106 test methods**, covering preservation, storage/recovery, voice control/diagnostics, microphone checks/meter and retained labs. See [tests/README.md](../tests/README.md) for suite responsibilities and limits. Python is a development runner; tests do not access real recordings or a microphone.

The suites execute production functions with controlled DOM/storage/lock/timer mocks. They do not prove native player rendering, actual IndexedDB behavior, browser permission decisions, container decoding, background capture or multi-hour memory reliability.

## Focused manual checks

Use disposable recordings in an updated build. Do not clear site data or reinstall to test preservation.

1. **Normal capture:** record, pause/resume, Stop, and check beginning/middle/end. Verify the normal saved status, saved **▶** player, download, and unchanged top player. Close the dialog and check a disposable Delete/Restore round trip, including KB in Recently Deleted.
2. **Storage failure:** enable **Settings → Storage → Advanced storage settings → Recording preservation test → Enable failure testing for this page**. Record/count for ten seconds, then tap **Simulate storage failure** while recording. Expect automatic stop and a positive unsaved-byte result. Play/export its single entry, make a second normal recording, then play/export the first again. Keep the page open until exports are checked; disable the test afterward. Starting the second recording must not release the first's emergency audio.
3. **Reload recovery:** separately, without needed memory-only audio in the page, reload during capture. Load committed audio and verify interrupted history remains; some ending loss is possible.
4. **Ownership:** prefer two updated Mac tabs at the same URL. Record in A; B must refuse a competing recording or mutation of A's live session. Stop A, then Refresh recordings in B and verify normal playback/download. Do not confuse this with iPhone background capture.
5. **Protection:** open Settings, read status, close/reopen and check that it refreshes. Grants can differ by browser/container. Refusal does not block recording or mean recordings disappear on normal closure.

Stuck writes, missing stop events, encoder errors and malformed structures are simulated in automated tests. Do not fill storage or manually corrupt saved chunks. For real delayed finalization, export available audio before closure and report the exact notice and whether it eventually finishes.

### Short microphone-check acceptance

1. On MacBook and iPhone, open Settings → Microphone → Microphone levels → View, then Check microphone level (10 s). Confirm level response and inspect the microphone-processing report under Advanced microphone settings; no saved recording should appear.
2. Wait for automatic completion and check that microphone access ends. Repeat and stop early, close Settings/disclosure, or background the page.
3. Start Record during a check, then speak, Stop and play. The check must release its input; the recording must retain its own live microphone. Closing Settings while recording must not stop capture.
4. Where permission has not been granted, cancel a pending check by closing Settings or pressing Record. A late response must not resurrect the check or end a newer recording.

The user reported the microphone check and countdown worked. Automated coverage and isolated Chrome checks are reported in the journal; this report does not establish every Safari/iPhone permission race or indicator scenario.
