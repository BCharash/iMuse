# Recording and iPhone standalone background investigation

Updated 3 November 2026. This consolidates the former recording handoff, background lab notes, and remaining architecture audit questions. Historical startup regressions and earlier source reviews are in the [archive](Archive/README.md). The [roadmap](iMuse%20next%20steps.md) owns work priorities.

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

The user reports **iPhone 12 Pro Max, iOS 26.7.2**, and prefers to remain on that version unless there is relevant fix evidence supporting an iOS 27 update. No upgrade is a prerequisite for the next web experiment. The OS build number is not recorded; public release evidence checked here did not establish whether WebKit fix 317747 is included in this release.

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

### Audio Session comparison completed; experiment reverted

The user authorized a temporary Automatic / Play and record setting, applied before microphone acquisition with previous-type restoration during cleanup. Static/mocked checks passed. The user then reported **identical installed-iPhone performance in both modes**: external double beep and capture-pipeline loss after more than a few seconds backgrounded. No benefit was demonstrated. Browser acceptance/readback of the explicit request was not supplied with that report, so the conclusion is limited to the tested implementation; do not claim every possible Audio Session configuration has been ruled out.

The user reverted the entire experiment commit (`d132ac5`, reverted by `7bdec07`), including its pending-result documentation. The setting/helper are absent again; warning removal, lab removal and documentation consolidation remain. This entry restores the result without reintroducing experimental application code.

### Recommended next decision

The user prefers to finish the web app before considering native development and does not want a recurring development-signing installation workflow. Native is deferred, not the default next action. Continue web development using the demonstrated Safari-tab route while investigating specific installed-host leads. Foreground recovery and truthful interruption status remain independent web tasks.

New research leads, checked 3 November 2026 (none demonstrated as a workaround):

1. [WebKit fix 317747](https://bugs.webkit.org/show_bug.cgi?id=317747), [commit 5801e5e98a3e](https://github.com/WebKit/WebKit/commit/5801e5e98a3e), landed 2 July 2026. It addresses capture/session bookkeeping, including session removal during capture; its description also discusses process suspension, but the patch retains special suspension behavior. Do not claim it fixes standalone background capture. The user reports iOS 26.7.2; the build number and inclusion of this change remain unverified. Establish whether relevant changes shipped there before attributing this failure to that bug. A main-branch fix is not proof of availability in a particular iOS release. Subsequent release-note research confirms that [Safari 27.0 includes this specific fix, issue 180505014](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/#webrtc), and that Safari 27 ships with iOS 27. This is verified release inclusion, not verification that installed-iMuse capture loss is fixed. The same source does not establish whether the fix was backported to iOS 26.7.2. The underlying patch still treats process suspension specially, so do not equate this fix with unrestricted standalone background capture.
2. [Media Session setMicrophoneActive](https://www.w3.org/TR/mediasession/#dom-mediasession-setmicrophoneactive) is distinct from the reverted audioSession.type setting. It declares desired microphone capture state and can affect user-agent mute controls. The user authorized this new opt-in experiment; implementation is complete and device results are pending. It is not background-execution permission or a proven fix. Activation can reject, particularly while hidden; there is no polling or repeated forced activation in the background.
3. Clarify which profile was installed for the earlier lab reproduction. If it already used only getUserMedia → MediaRecorder without Web Audio or playback, do not repeat it. Otherwise a genuinely output-free installed control can distinguish host capture loss from remaining normal cue/media-session interactions. This is a focused gap check, not another broad preset matrix.

The microphone-declaration experiment below is the only application change for these leads. Do not restore the rejected type-setting experiment, warnings, silent keep-alives, or broad labs by default. A Safari-opening Home Screen shortcut could preserve convenient launch while retaining the working browser host; it would be an installation/launch compromise, not a repair of standalone capture. Do not assume Safari and standalone storage are interchangeable or move/delete recordings to implement that compromise.

### Microphone declaration experiment — implemented, awaiting device test

Settings → **Declare microphone active (experimental)** defaults off, persists per device, and is locked during recording preparation, capture and pause. With it off, no Media Session capture-state calls are made. With it on, [the helper](../js/microphone-capture-declaration.js) requests `setMicrophoneActive(true)` once after MediaRecorder starts and only while visible. It does not block recording on the request promise. Settings and existing diagnostic events report unsupported, skipped-hidden, accepted or rejected outcomes. Existing foreground snapshots include declaration state; no extra polling or background activation retries are added.

On stream cleanup the helper requests `false` after an accepted activation, including late acceptance after Stop. Repeated cleanup is idempotent. Stale cleanup is skipped if a newer recording has taken ownership, with an instruction to reload before comparison. Pause retains the active declaration because the microphone remains live for the existing processing/voice graph; this does not resume paused MediaRecorder capture. API failures do not alter audio persistence or invoke playback.

Test procedure on the installed iPhone:

1. Leave Audio commands off and keep microphone/processing settings fixed. With the new checkbox **off**, record before/background/after speech, spending about 20 seconds in the same other app. Stop and inspect playback; note the external beep and indicator.
2. After saving and cleanup, reload. Check **Declare microphone active**, start while visible, and wait for the Settings status to say **browser accepted** before switching apps. If unsupported/rejected, report that; an applied-declaration comparison has not occurred.
3. Repeat the identical before/background/after sequence. Report status, beep/indicator and actual saved audio. Reload before another comparison if cleanup reports failure or supersession. Browser acceptance is not proof of background capture.

Syntax and mocked behavior checks passed for disabled/unsupported/hidden cases, accepted/rejected and throwing API calls, cleanup failure, delayed response after Stop, newer-recording ownership, settings persistence/locking and recorder stream cleanup. Device outcome remains unreported.

A separate iOS 27 device test by another person would be useful direct evidence. Use the warning-free baseline with this new experiment off, the same app-switch procedure and actual background spoken markers. Test Safari-tab and installed modes separately; report exact iOS version and device. No external test or result has yet been obtained. The known Safari 27 release fix is relevant evidence but not proof of the standalone outcome.

A workaround is acceptable only if capture fidelity, persistence, pause/resume, cleanup, export, and supported desktop behavior survive. A native shell merely wrapping the same page is not a demonstrated solution. Native recording remains a conditional alternative, described in the [Swift proposal](iMuse%20Swift%20migration%20plan.md).

## Foreground recovery is a separate work item

Handling `interrupted` as well as `suspended` is a recovery gap worth addressing, but the reviewed failures show context recovery alone may not restart MediaRecorder output. Distinguish intentional pause from stalled acquisition; verify fresh data and an appropriate input signal without treating real silence as failure. Avoid declaring restored capture from `unmute` alone.

Preserve the old recorder's final data before replacing it where possible. If replacement requires fresh recorders, retain each independently encoded segment with explicit interruption history; do not byte-concatenate independent MP4 recordings. Mark unexpected termination/interruption honestly. Recovery can restore future capture, never reconstruct the missing background interval.

## Cleanup completed

Removed `Lab.html`, `BackgroundCaptureLab.html`, `js/labs/background-capture-lab.js`, the interruption-warning setting/code and `audio/recording-interrupted.wav`. Written findings, visual lifecycle notices, normal cues, pre-existing command labs and production recording data remain. Old lab IndexedDB data was not deleted. No capture workaround was added as part of cleanup.
