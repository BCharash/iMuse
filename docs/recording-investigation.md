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
| Packaging | Manifest uses `display: standalone`; no service-worker implementation was found in this review. An opt-in Audio Session experiment is now implemented; Automatic leaves the type unchanged, while Play and record requests the explicit type before acquisition |

Do not revive the older startup-readiness claim or the proposed `js/voice/` directory from historical reviews. Headset media-button controls were retired on both platforms; microphone selection remains. The application's periodic paused reminder beeps are distinct from the equal-pitch external transition beep.

## Platform evidence and proposed next experiment

External references checked 3 November 2026:

- [WebKit issue 236509](https://bugs.webkit.org/show_bug.cgi?id=236509) describes PWA-specific microphone loss on minimization, absent in Safari; a WebKit engineer reproduced it and suspected a host request to stop capture. It is a historical report, not confirmation of the exact current iOS defect.
- [WebKit capture-policy source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/RealtimeMediaSourceCenterCocoa.mm) bases an iOS visibility-interruption decision on the native host's background-audio configuration. This supports a host-level explanation; it does not reveal the installed iPhone host's actual configuration. The manifest cannot be assumed to configure that native setting.
- [W3C Audio Session draft](https://www.w3.org/TR/audio-session/) defines explicit audio-session intent, including `play-and-record`. It is a draft API and does not promise background-execution permission. No iMuse experiment has yet established that setting it overcomes installed-app capture loss. Earlier headset-button experiments using that value tested a different outcome.

The user authorized the reversible setting experiment. It is implemented in [recording-audio-session.js](../js/recording-audio-session.js), with Settings and recorder integration. Device outcome is still unknown.

### Installed-iPhone experiment instructions

1. Identify the deployed warning-free build containing **Settings → Audio session (experimental)**. Leave Audio commands off for this comparison. Do not clear IndexedDB or reinstall as a generic cache fix.
2. Select **Automatic**, start a fresh recording, say “before”, switch to the same other app for about 20 seconds and say “background”, return and say “after”, Stop, then listen. Record microphone indicator and external beep observations.
3. Select **Play and record**, then repeat identically. After starting, Settings reports whether the browser accepted the choice. Report that message as well as playback. An unsupported/rejected request is not a test of an applied explicit mode.
4. Repeat any apparent success, then test longer app switching and screen lock separately. Use Safari and Mac as regression controls only once there is a candidate benefit. API acceptance is not evidence of retained background speech.
5. If the installed host still stops capture, stop repeating graph/storage toggles or adding silent keep-alive playback. Retain the tested Safari-tab path and bring the native feasibility decision back to the user. Recreate a minimal reproducer only for a specific experiment or WebKit report.

The selection persists on this device and is locked throughout acquisition/recording/pause. Automatic performs no type assignment. Explicit mode captures the previous type, requests `play-and-record` before getUserMedia, and restores the prior type after stream cleanup, including startup failure/cancellation. It does not overwrite a subsequent different type from another audio owner. Unsupported APIs and setter failures are reported without blocking capture. Session-created and existing foreground snapshots include the request/readback; startup diagnostics also record standalone mode. No new polling or automatic recorder restart was added.

Syntax and mocked API/recorder checks cover unsupported/rejected requests, settings fallback, no-write Automatic behavior, restoration/idempotence, and permission/cancellation/constructor/storage startup exits. These checks do not exercise real iOS audio hardware or certify background capture.

A workaround is acceptable only if capture fidelity, persistence, pause/resume, cleanup, export, and supported desktop behavior survive. A native shell merely wrapping the same page is not a demonstrated solution. Native recording remains a conditional alternative, described in the [Swift proposal](iMuse%20Swift%20migration%20plan.md).

## Foreground recovery is a separate work item

Handling `interrupted` as well as `suspended` is a recovery gap worth addressing, but the reviewed failures show context recovery alone may not restart MediaRecorder output. Distinguish intentional pause from stalled acquisition; verify fresh data and an appropriate input signal without treating real silence as failure. Avoid declaring restored capture from `unmute` alone.

Preserve the old recorder's final data before replacing it where possible. If replacement requires fresh recorders, retain each independently encoded segment with explicit interruption history; do not byte-concatenate independent MP4 recordings. Mark unexpected termination/interruption honestly. Recovery can restore future capture, never reconstruct the missing background interval.

## Cleanup completed

Removed `Lab.html`, `BackgroundCaptureLab.html`, `js/labs/background-capture-lab.js`, the interruption-warning setting/code and `audio/recording-interrupted.wav`. Written findings, visual lifecycle notices, normal cues, pre-existing command labs and production recording data remain. Old lab IndexedDB data was not deleted. No capture workaround was added as part of cleanup.
