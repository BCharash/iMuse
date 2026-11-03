# Recording and iPhone standalone background investigation

Updated 3 November 2026. **Latest checkpoint:** the separate-button microphone activation experiment is implemented and awaiting device testing; see [instructions below](#corrected-direct-button-test--implemented-awaiting-device-result). The earlier Automatic / Play and record and asynchronous declaration experiments were reverted. This consolidates the former recording handoff, background lab notes, and remaining architecture audit questions. Historical startup regressions and earlier source reviews are in the [archive](Archive/README.md). The [roadmap](iMuse%20next%20steps.md) owns work priorities.

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

## Cleanup completed

Removed `Lab.html`, `BackgroundCaptureLab.html`, `js/labs/background-capture-lab.js`, the interruption-warning setting/code and `audio/recording-interrupted.wav`. Written findings, visual lifecycle notices, normal cues, pre-existing command labs and production recording data remain. Old lab IndexedDB data was not deleted. No capture workaround was added as part of cleanup.

## Microphone-declaration test rejected; timing needs correction

On 3 November the user reported that the temporary `mediaSession.setMicrophoneActive(true)` experiment was rejected in both installed iPhone iMuse and the Safari tab. The repository shows experiment commit `ea8563b` reverted by `8da486e`; the helper/setting are absent. Rejection is not evidence of an accepted configuration failing to preserve background capture.

Subsequent [WebKit source inspection](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/mediasession/MediaSession.cpp) found that `updateCaptureState` requires activation to run in a current user-gesture handler, as well as a visible, fully active document. The tested implementation invoked it after asynchronous microphone, storage and Web Audio setup. Loss of user-gesture context is therefore a plausible implementation-level reason for rejection; the actual saved error has not yet been reviewed and the inspected main branch is not proof of exact shipped-version behavior. The initial test checked visibility but did not ensure a current user gesture.

Before another change, inspect the `microphone-declaration` event's error in the recording's existing Download stop diagnostics JSON. If that confirms the gesture requirement, the corrected test would use an explicit button pressed after recording starts, calling the method synchronously in that click handler. Do not automatically restore the reverted experiment or interpret the rejection as proof that all Media Session approaches fail. No new application code was added for this finding.

The user prefers web development before native work. Automatic / Play and record previously showed no benefit and was also reverted. An iOS 27 same-build test by another person remains useful direct evidence; the official Safari 27 notes establish inclusion of a relevant audio-session fix, not a verified repair of this installed-PWA behavior.

### Rejection confirmed by saved production diagnostics

Reviewed `iMuse-stop-diagnostics-2084d719-74dc-4151-8e98-6b52c70aaadd.json` on 3 November 2026. This is a standalone run (`standalone: true`). The method was available (`supported: true`) but rejected at +142 ms with **InvalidStateError: Activating capture must be called from a user gesture handler.** This confirms the tested call failed the gesture requirement; it did not exercise an accepted microphone declaration. Earlier API-support uncertainty should not be treated as the explanation for this run.

Capture reached 22 received/committed chunks (536,798 bytes) with zero pending bytes. Track mute was logged at +23.475 s, preceding the hidden visibility event at +26.007 s; that ordering does not identify which user/system action initiated interruption. On foreground return the track briefly unmuted and the context ran, but snapshots remained at 22 chunks with zero analyser input, then the track muted again. No stop-request/recorder-stop event is present in this export. Session metadata was marked interrupted on a later initialization; do not describe this as a clean user Stop or a proven application crash.

A corrected experiment would issue the activation synchronously from a separate button while recording is already active. The reverted experiment remains absent; no further application change was made while reviewing this JSON.

## Corrected direct-button test — implemented, awaiting device result

After the diagnostic confirmed the user-gesture rejection, the user authorized a separate-button test. The temporary settings checkbox remains removed. A button **Test microphone activation** now appears below microphone status, enabled only during an active recording and disabled while pending, accepted, paused or finalizing. Each recording creates an inert test handle; no capture-state API is accessed or called until the button is tapped.

The synchronous click handler calls [microphone-activation-test.js](../js/microphone-activation-test.js) directly, with no await, timer or Promise continuation before `setMicrophoneActive(true)`. The exact resolved/rejected result and error are displayed beside the button and stored in existing diagnostic events. No background retries, warning playback, silent keep-alive audio or recorder replacement were added. Pause does not clear an accepted declaration, since the microphone remains in use; stream cleanup clears it once after acceptance. Delayed acceptance is cleared after Stop unless a newer recording owns capture, in which case stale cleanup is skipped and the status requests a reload before further comparison.

Test on the user's iPhone 12 Pro Max, reported iOS 26.7.2:

1. Keep Audio commands off and microphone/processing settings fixed. First record without tapping the test button: say before, switch apps for about 20 seconds and say background, return and say after, Stop and listen.
2. Save the control recording, reload, start a fresh recording and tap **Test microphone activation** while iMuse is visible. Wait for **Browser accepted microphone activation**. If rejected, retain the exact displayed error or export that session's stop diagnostics; do not interpret this as an applied-configuration comparison.
3. After acceptance, repeat identical before/background/after speech, Stop and listen. Report the message, beep/indicator and whether each spoken section survived. Save/export diagnostics before deleting the recording. Reload before another comparison if cleanup fails or is superseded.

Static/mocked checks passed for direct synchronous invocation through the actual click handler, no untapped API calls, rejection details, support/visibility checks, retries after rejection, duplicate suppression, delayed responses, newer-recording ownership, cleanup, and button availability in idle/pause/finalizing states. These are implementation checks, not proof of real-device acceptance or background continuity.

The user prefers web completion before native development, but is willing to consider an iOS update with relevant evidence. [Safari 27's official notes](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) include audio-session capture-continuity fix 180505014 and confirm shipping with iOS 27; this does not establish that iMuse's standalone loss is repaired or whether the fix is backported to 26.7.2. A volunteer iOS 27 test should use the same warning-free iMuse build **without tapping the new button**, compare browser and installed modes separately, and verify actual background speech. No volunteer result is recorded.
