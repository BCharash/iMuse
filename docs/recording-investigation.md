# Recording and iPhone standalone background investigation

Updated 3 November 2026. **Latest result:** the newly installed minimal microphone → MediaRecorder lab also produced the double beep and lost background capture. That test was reverted after use; its result is retained below. This consolidates the former recording handoff, background lab notes, and remaining architecture audit questions. Historical startup regressions and earlier source reviews are in the [archive](Archive/README.md). The [roadmap](iMuse%20next%20steps.md) owns work priorities.

## Conclusion and evidence boundary

Two distinct failures were identified:

1. **iPhone standalone capture loss:** installed iMuse and an installed lab produce an external double beep and lose background audio. This predates the warning and persists with the warning disabled. The precise host/OS mechanism and meaning of the beep remain unverified.
2. **Safari-tab playback-associated loss:** starting the interruption-warning WAV during backgrounding can stall capture, although Safari-tab background recording succeeds without it. Warning playback, setting, and WAV have now been removed completely.

The evidence points toward an iPhone standalone hosting restriction or defect, not a universal PWA limitation or a demonstrated failure in iMuse's chunk storage. A Safari-tab lab is not a valid control for installed-app lifecycle behavior. No workaround is yet established. Foreground recovery cannot restore speech that was never captured.

## User-reported environment matrix

| Environment | Background result |
| --- | --- |
| MacBook Chrome tab | Successful recording |
| MacBook Chrome installed app | Successful recording |
| MacBook Safari app added to Dock | Successful recording |
| iPhone Safari tab, warning disabled | Successful background recording |
| iPhone Safari tab, warning on hidden | Background speech missing; short interruptions may recover foreground capture, longer ones may remain stalled |
| iPhone installed iMuse, warning enabled or disabled | External double beep and background recording loss |
| iPhone installed lab | External double beep and background recording loss |

Deleting/reinstalling the iPhone app and rebooting did not resolve the installed-app failure. Mac desktop success does not predict iOS host behavior. App switching, screen locking, opening Control Center, and another app claiming audio are separate scenarios; only specifically reported tests are established. Long-duration and locked-screen reliability are not certified.

Record device model, Settings-reported iOS version, browser/container, deployed revision, and actual input for future experiments. Do not infer the OS version solely from a user-agent string: reviewed logs contain version tokens that do not reconcile straightforwardly with older device notes. Existing JSON establishes `standalone: false` for the reviewed browser runs; the installed-lab result is user-reported, not a reviewed standalone JSON trace.

## Completed lab comparisons

All initial iPhone browser presets preserved before/background/after speech at a requested **250 ms** timeslice, including combined processing, silent output graph, rolling-buffer work, silence polling, startup speech, and chunk storage. Later separate additions for wake lock, production-style bookkeeping, and startup order also passed, including their combined profile with the warning off.

| Warning comparison in iPhone Safari | Result |
| --- | --- |
| Dedicated player prepared; warning off | Successful |
| Warning on hidden through dedicated player | Capture stalled |
| Warning on hidden through shared speech player | Capture stalled |
| Warning on microphone mute | Successful; no proof playback actually occurred |

Audio commands off did not prevent the original iMuse failure. The installed lab reproduced it without voice recognition. Wake inference and TensorFlow are therefore not necessary for this reproduction. Preparing an audio element alone did not reproduce the separate Safari failure. Microphone-mute-trigger success does not prove that playback during a genuine mute is safe.

### Reviewed diagnostic evidence

| JSON run ID | Configuration | Evidence |
| --- | --- | --- |
| `ee52b17b-7bf7-4fc7-b555-1874366493ad` | Dedicated warning on hidden | Context interrupted at +8.20 s, warning requested at +8.45 s; chunks stalled; all 10 received chunks committed |
| `4c92e268-9ecc-43ef-af95-71dc3c550bcc` | Dedicated player, warning off | Seven hidden-state chunks; continued capture after return; 17 received and committed |
| `5be448e5-a773-47e5-ab58-95a841708f38` | Shared player, warning on hidden | Two hidden-state chunks, then no chunk delivery until Stop; 11 received and committed; later silence pause at +23.89 s followed the stall |

Both successful and failing runs showed AudioContext `interrupted` during app switching. In failed runs the context could return to `running` and briefly show nonzero analyser input while the recorder still emitted no new chunks. Context state, `MediaRecorder.state === 'recording'`, a live/unmuted track, and the OS microphone indicator are individually insufficient evidence of continued recorder acquisition.

Received chunks were saved in these runs. That excludes failure to commit those received chunks, not every possible storage problem. Chunk callback gaps alone do not prove lost speech because delivery can be batched; missing background speech was established by the user's playback checks. The 250 ms request did not guarantee 250 ms callback spacing.

These JSON files were reviewed from local Desktop paths after restoration; they are not bundled with the repository and their continued availability is not guaranteed. An IDE attachment can reference a local file rather than upload a durable copy. Preserve future evidence until it has been read and its findings recorded.

### Earlier, separate regressions

A 2 November handoff records two flight-recorder versions that caused startup lockups, resolved by reverting the instrumentation. Their exact runtime failure was not established. It also records a separate stale-cache/deployment incident. Do not diagnose the installed-app limitation as either historical issue, or reintroduce broad instrumentation to rediscover existing received/committed counters. Original timelines and version caveats remain in the [archived handoff](Archive/recording-investigation-handoff-2026-11-02.md).

## Current source observations

Checked against the repository on 3 November; these are static observations, not a fresh device acceptance pass.

| Component | Current behavior / remaining question |
| --- | --- |
| [Microphone manager](../js/microphone-manager.js) | Acquires on Record, prefers identifiable headsets in automatic mode, supports exact selection, owns release; no startup readiness microphone capture |
| [Recorder](../js/recorder.js) | Starts MediaRecorder with 250 ms; receives and queues chunks, persists chunks/session atomically, releases committed pending audio, uses an 8 MiB pending limit |
| Capture graph | Source feeds analyser and ScriptProcessor → zero gain → destination; samples copied into rolling buffer; inference enabled only by active voice settings, not required for manual capture |
| Voice adapter | [TensorFlow adapter](../js/tensorflow/commands-adapter.js) still temporarily intercepts global getUserMedia to return a cloned recording track during listener startup; listener generation and start/stop serialization exist |
| Speech | [Response manager](../js/audio-response-manager.js) preloads/serializes normal WAV cues; startup, pause, resume, confirmation and stopped cues remain; the interruption-warning player is gone |
| Startup | Initializes database/recovery and selected wake model; TensorFlow warmup checks Audio commands; preloads normal response audio. No active idle wake listening before Record |
| Visibility | Logs transitions and foreground snapshots, reacquires screen wake lock, resumes AudioContext only when `suspended`; does not explicitly stop or pause recorder merely because page is hidden |
| Capture health | Existing snapshots record received count (`sequence`), committed count (`metadata.chunkCount`), last-chunk age, pending bytes and signal; no robust stalled-capture recovery controller |
| Finalization | Unexpected stop is logged, but a nonempty assembly can still be marked `completed`; the status can conceal missing capture. This remains an actionable correctness issue |
| Scaling | Finalization/playback/recovery still retrieve chunks and assemble a Blob; bounded pending capture memory does not establish bounded total memory for long recordings |
| Packaging | Manifest uses `display: standalone`; no service-worker implementation was found in this review. No current production audioSession type override was found |

Do not revive the older startup-readiness claim or the proposed `js/voice/` directory from historical reviews. Headset media-button controls were retired on both platforms; microphone selection remains. The application's periodic paused reminder beeps are distinct from the equal-pitch external transition beep.

## Platform evidence and proposed next experiment

External references checked 3 November 2026:

- [WebKit issue 236509](https://bugs.webkit.org/show_bug.cgi?id=236509) describes PWA-specific microphone loss on minimization, absent in Safari; a WebKit engineer reproduced it and suspected a host request to stop capture. It is a historical report, not confirmation of the exact current iOS defect.
- [WebKit capture-policy source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/RealtimeMediaSourceCenterCocoa.mm) bases an iOS visibility-interruption decision on the native host's background-audio configuration. This supports a host-level explanation; it does not reveal the installed iPhone host's actual configuration. The manifest cannot be assumed to configure that native setting.
- [W3C Audio Session draft](https://www.w3.org/TR/audio-session/) defines explicit audio-session intent, including `play-and-record`. It is a draft API and does not promise background-execution permission. No iMuse experiment has yet established that setting it overcomes installed-app capture loss. Earlier headset-button experiments using that value tested a different outcome.

Recommended bounded investigation, not an approved production implementation:

1. Keep the warning-free build as the control and identify the exact deployed revision. Do not clear browser storage or reinstall again as a generic troubleshooting step.
2. Verify availability and current behavior of the Audio Session API on the actual iPhone. If supported, test **one** isolated explicit `play-and-record` session-intent variant against automatic selection, set before acquisition and restore after cleanup. Keep input, processing, cues and app-switch duration identical; log support, assignment result, host mode, and actual saved audio. This is a hypothesis, not a promised fix.
3. Validate any candidate first in the **installed iPhone host**, then Safari and Mac regression controls. Test app switching separately from screen lock and other audio apps. Require repeated before/background/after playback success; inspect stored audio rather than relying on icon/beep/state.
4. If the installed host still stops capture, stop repeating graph/storage toggles or adding silent keep-alive playback. Retain the tested Safari-tab path as the practical option and bring the native feasibility decision back to the user. Recreate a minimal reproducer only for a specific experiment or a WebKit report, not the old broad lab matrix.

A workaround is acceptable only if capture fidelity, persistence, pause/resume, cleanup, export, and supported desktop behavior survive. A native shell merely wrapping the same page is not a demonstrated solution. Native recording remains a conditional alternative, described in the [Swift proposal](iMuse%20Swift%20migration%20plan.md).

## Foreground recovery is a separate work item

Handling `interrupted` as well as `suspended` is a recovery gap worth addressing, but the reviewed failures show context recovery alone may not restart MediaRecorder output. Distinguish intentional pause from stalled acquisition; verify fresh data and an appropriate input signal without treating real silence as failure. Avoid declaring restored capture from `unmute` alone.

Preserve the old recorder's final data before replacing it where possible. If replacement requires fresh recorders, retain each independently encoded segment with explicit interruption history; do not byte-concatenate independent MP4 recordings. Mark unexpected termination/interruption honestly. Recovery can restore future capture, never reconstruct the missing background interval.

## Recording preservation — approved Stage 1

Implemented 3 November 2026 after separate user approval. A storage-failure emergency assembly is now retained in a collection independent of the current player. Starting another recording, loading another recording, clearing playback, and requesting a download do not release it. Each emergency has its own visible load/download controls. Saved-session playback, recovery and export prefer the retained emergency assembly over the committed-only browser copy; recovery does not promote that partial copy to completed while emergency audio remains in memory.

The collection is page memory, not persistent storage. Closing/reloading the page or OS process termination can still lose its unsaved audio. Multiple emergency recordings consume additional memory; the existing pending-write threshold does not bound their total size. Download initiation does not establish that a file was saved, so emergency copies remain retained after download requests. If committed chunks cannot be read, only the available pending fragments may be retained, and their playability is not guaranteed.

Validation: `python3 tests/test_emergency_recordings.py` exercises production functions with controlled DOM/storage mocks, including actual failure finalization, the new-recording playback-clear path, multiple emergencies, rendered load/download controls, full-prefix-plus-tail exports, download failure/retry, recovery precedence, and unavailable-storage fallback. It checks recorder syntax. It does not exercise a real microphone, actual browser IndexedDB, file-picker completion, or iPhone behavior; those remain device acceptance work.

Stage 1 added no database schema, audio-capture policy, persistent-storage request, or iPhone background workaround. Stage 2 below adds serialized updates, ownership and the consolidated interface. Completion validation and persistent-storage requests remain separate stages requiring approval.

### Stage 1 device test: controlled storage failure

An optional **Settings → Recording preservation test** section now provides an explicit failure-injection control. It defaults off on every page load and is not saved as a preference. Enabling it alone does not inject a failure: the user must press **Simulate storage failure** during an active recording after at least one chunk has committed. That button arms only the current recording, requests recent audio, and fails its next chunk write before opening a database transaction. Existing recordings and committed chunks are unchanged. The ordinary storage-error handler stops capture and retains the failed chunk plus the final recorder tail. This tests application error handling, not a real quota failure or browser transaction abort.

Use the updated build in the same PWA or browser throughout. Keep it foregrounded and do not reload, close, reinstall or clear website data during this test.

1. Open **Settings → Recording preservation test** and check **Enable failure testing for this page**. Close Settings if needed to reach Record.
2. Start a disposable recording. Count aloud for about ten seconds. The simulation button is available once some audio has saved.
3. Open that Settings section again while recording, continue counting, and tap **Simulate storage failure**. Continue until recording stops automatically. It may stop almost immediately; there is no guaranteed post-click speaking interval.
4. The test result should say **Simulated failure completed**, with a positive number of **bytes not saved to browser storage**. Close Settings and find the recording marked **Includes unsaved audio** in **Saved recordings**. Use **Load audio**, play it, and note its ending. Use **Download audio** and check the downloaded file. Stage 1 originally displayed a separate Emergency recordings section; Stage 2 consolidates these entries.
5. Make a second disposable recording and stop it normally. It should save normally without another injected failure; there is no need to disable the control first. Both the emergency entry and the second saved recording should remain accessible.
6. Load the first emergency recording again and download it again. Its audio and ending should match the earlier emergency playback/download. Both downloads should include the retained unsaved tail, rather than only the stored prefix. Listen to the exported files; the browser cannot confirm successful file saving merely from a download request.
7. Uncheck **Enable failure testing for this page** when finished. This does not remove emergency audio. Preserve any needed emergency exports before closing or reloading.

Pass criteria: a reported positive unsaved-byte count, accessible/playable emergency audio, a normally saved second recording, and unchanged first emergency playback and export after the second recording. A missing emergency entry, zero unsaved bytes, a truncated later export, an unplayable export, or an unintended failure of the second recording requires investigation before Stage 2. Report the container (PWA or Safari), counts/result message and the failed step. A new test-created interrupted/storage-error saved entry contains only its committed prefix after page closure; that is not a durable copy of its emergency tail.

Automated control coverage: `python3 tests/test_preservation_failure_control.py` checks the default-off and active/committed/paused guards, production chunk-write/error/stop functions, retention/export of failed and final chunks, normal writes by the next session, cancellation, and requestData failure. The existing Stage 1 test remains `python3 tests/test_emergency_recordings.py`. Both use controlled mocks; the device procedure above remains outstanding.

### Stage 2: one recovery interface and coordinated storage writes

Implemented 3 November 2026 after user approval. Each session now has one Saved recordings entry with **Load audio** and **Download audio**. Retained emergency copies override committed-only entries by session ID, including when storage reads fail; their notice identifies unsaved audio and the need to export before closure. No emergency data is released by loading another recording, downloading, or disabling the test. Deletion is blocked while an emergency copy remains unsaved. **Refresh recordings** updates the list without reloading or releasing emergency data.

All session/chunk mutations use a serialized coordinator. Lifecycle updates read current session metadata in their transaction and retain committed counters. Chunk writes read current metadata, update chunks and counters atomically, account for replacement of an existing sequence, and update only the in-memory counters after completion. They do not overwrite a newer pause/finalizing state. Pause/resume callbacks recheck session ownership after awaited writes before changing the UI.

A single database writer lease is held from microphone preparation through final chunk storage and finalization. Other cooperating pages cannot start a recording or mutate session data during that interval. Startup recovery takes the same lock, so it cannot mark another page's live session interrupted. Recovery, deletion and restoration take the lock through their entire read/modify/write operation; the current page additionally blocks actions on sessions still finishing. The lease is released after queued operations finish, on failed/cancelled startup, or by the browser on page termination. This follows the [Web Locks lifetime and coordination model](https://www.w3.org/TR/web-locks/).

Scope and compatibility: coordination applies to updated pages sharing the same browser storage bucket; Safari and installed apps with separate storage are not a cross-tab test. Older open builds do not honor the lock, so load the updated code in all test tabs before recording. There are deliberately no expiring timer leases that could mistake a backgrounded page for a dead writer. Browsers without usable Web Locks cannot start recording or perform storage mutations; they receive an explicit compatibility message rather than uncoordinated writes. The schema remains version 2; no recordings are migrated or cleared. This does not fix iOS standalone capture loss, add durable emergency-tail retries, validate media completeness, or request persistent storage.

The user reported Stage 1 emergency audio still accessible after making another recording: committed prefix 213,314 bytes (8 chunks), emergency assembly 233,965 bytes. Endings sounded alike; that is compatible with a short final tail and does not establish an audible improvement. Successful downloaded-file verification was not explicitly reported. No disappearance attributable to Stage 1 was established; earlier PWA deletion/reinstallation made the prior storage baseline uncertain.

Stage 2 validation: all three controlled suites pass: `python3 tests/test_emergency_recordings.py`, `python3 tests/test_preservation_failure_control.py`, and `python3 tests/test_recording_storage.py`. Coverage includes one entry per session, emergency fallback during storage read failure, full-tail exports, failed/cancelled startup release, competing initialization/deletion, lifecycle/chunk ordering, counter consistency, duplicate-sequence accounting, transaction abort and subsequent queue recovery, deletion/restore, ownership through pending writes, and unavailable-lock behavior. These are source-function tests with simulated transactions and lock managers, not actual browser/device certification.

Stage 2 device/browser acceptance:

1. Repeat the controlled failure test above in one updated page. Expect one entry for the first recording, marked with unsaved audio, whose Load/Download actions use the fullest copy. Make a normal second recording and confirm both remain accessible. Keep the page open until emergency exports are checked.
2. Prefer a Mac browser for the ownership test to avoid confusing it with the separate iPhone background-capture defect. Open two updated tabs at the exact same site address. Start recording in A, then open/reload B. B must leave A's session active and must refuse a second recording or recovery/deletion while A owns storage. Return to A and stop normally. In B, press Refresh recordings; the saved recording should load/download normally.
3. In a separate disposable run, reload A while it records, then reload B after A has finished reinitializing. Its orphaned session should be loadable from committed chunks. Some ending loss remains possible; a timeslice is not a maximum-loss guarantee.
4. In A, test pause/resume followed by Stop, then load/download the result. Counts should not roll backward when lifecycle state changes. Check normal Recently Deleted/Restore using a disposable completed recording; do not delete emergency audio to test this.

Stage 3 (completion validation and stalled-finalization handling) remains unapproved. Stop at this checkpoint for user testing.

## Cleanup completed

Removed `Lab.html`, `BackgroundCaptureLab.html`, `js/labs/background-capture-lab.js`, the interruption-warning setting/code and `audio/recording-interrupted.wav`. Written findings, visual lifecycle notices, normal cues, pre-existing command labs and production recording data remain. Old lab IndexedDB data was not deleted. No capture workaround was added as part of cleanup.

## Direct-button result and investigation while awaiting iOS 27 comparison

The user subsequently reported that the corrected direct-tap activation was **accepted** and cleanup was confirmed in both Safari-tab and installed iPhone runs. Installed mode still produced the external double beep and lost background acquisition; Safari-tab background recording remained successful. This is a valid negative result for the accepted declaration, unlike the prior user-gesture rejection. The user reverted the corrected experiment (`2ae6f9c`, revert `0502fa3`); no test button/helper remains. Automatic / Play and record also showed no benefit. Do not repeat either declaration approach without a new reason.

The iOS 27 volunteer comparison may take several days. The next recommended diagnostic is a short **device-system log comparison** using Mac Console and the connected iPhone, reproducing one standalone failure and one Safari-tab success with matching microphone/action/duration. Record the approximate switch/beep times and look for capture interruption, audio-session deactivation, process suspension or host stop-capture messages. [Apple documents connected-device logging in Console](https://support.apple.com/en-mide/guide/console/cnsl1012/mac). Logs may omit the relevant details; do not promise a definitive cause or identify the beep without evidence. No native build or extra capture instrumentation is required for this collection.

Safari Web Inspector can also inspect installed Home Screen apps ([WebKit instructions](https://webkit.org/web-inspector/enabling-web-inspector/)), but any debugger-attached result must be checked against an unattached control because inspection can change execution conditions. Prefer device-system logging first.

That configuration gap has now been tested: the dedicated minimal installed recorder also failed. See the latest result below; do not repeat the capture-only comparison. Foreground recovery/truthful session completion can be developed on the working browser route while the OS investigation remains unresolved, without promising that it restores missing background audio.


## Minimal installed recorder failed — component isolation complete

The user tested the new minimal lab on the installed iPhone and reported the same external double beep and microphone loss on backgrounding. The page used getUserMedia({audio:true}) → MediaRecorder at a requested 250 ms, retaining chunks in RAM, with no production imports, Web Audio graph, cues, models, silence handling, wake lock, storage writes or audio-session controls. This closes the remaining question about whether those iMuse subsystems are necessary for reproduction. The exact OS/host mechanism and meaning of the beep remain unverified; this does not prove every possible web workaround impossible. No diagnostic JSON or new Safari minimal-control result accompanied this latest report.

The repository shows the lab commit `1cf3423` reverted by `a739a57`; lab.html and lab.webmanifest are currently absent. Do not silently restore them. The exact minimal reproducer remains retrievable from commit `1cf3423` if needed for the iOS 27 comparison or a WebKit report. Production recording code is unchanged by this result update.

Keep the known successful Safari-tab route for continued web development. No further production graph/storage/activation patches are justified by these results alone. Await an actual iOS 27 comparison or a specific new platform-level hypothesis; native development remains deferred per the user's web-first preference. Mac device-system logging is also deferred because no suitable cable is available.

For an iOS 27 volunteer, retrieve the same minimal page/manifest from its historical commit when needed, explicitly confirm Standalone mode, then compare saved before/background/after speech in installed and browser runs. Record device/OS, exact served code, beep and audio result. A release note or microphone indicator cannot substitute for this test. Do not call an upgrade a verified cure: a related Safari 27 audio-session fix is documented, but this exact installed-host outcome remains untested there.


## Final discussion search — 3 November 2026

At the user's request, searched indexed Reddit, Apple Developer Forums, Stack Overflow, GitHub discussions/issues and WebKit reports for installed-PWA microphone/background recording, including iOS 26 versus iOS 27, standalone/Home Screen wording, getUserMedia and MediaRecorder. No reviewed discussion supplied a firsthand same-app comparison establishing that updating from iOS 26 to iOS 27 repaired installed-PWA background microphone recording. This is a search result, not proof no such experience exists.

Closest relevant discussion: [a developer on r/foss](https://www.reddit.com/r/foss/comments/1wh7nsd/looking_for_help_how_would_you_build_the_mobile/) reports PWA/WebRTC microphone loss on screen lock and background WebView loss, but does not identify an iOS version or report an upgrade fixing it. The linked [WebKit issue 241480](https://bugs.webkit.org/show_bug.cgi?id=241480) concerns WKWebView capture and is not an iOS 27 PWA validation. The historical [standalone-specific issue 236509](https://bugs.webkit.org/show_bug.cgi?id=236509) remains a close behavioral match without a reviewed iOS 27 success report.

Explicit iOS 27 hits included unrelated microphone permission persistence, speaker crackling during capture, streaming playback, native apps, and system screen recording. These were not counted as evidence of installed background recording success or failure. The [official Safari 27 audio-session fix](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) remains relevant release evidence but supplies no same-PWA background before/after outcome. A volunteer test of the identical minimal recorder is still stronger than the discussion evidence found. No upgrade is asserted to solve this problem, and no application changes were made for this search.
