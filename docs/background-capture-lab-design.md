# Background capture lab design

Purpose: reproduce the iMuse background capture failure in a separate page, without modifying production modules or accessing production recordings.

## Running the implemented lab

Open the existing `Lab.html` URL through your HTTPS hosting or local development server. The heading must say **revision 2**. The script has a revision query to refresh its cache. `BackgroundCaptureLab.html` redirects here. Serve from the repository root so the existing WAV assets resolve.

All previous presets passed at 250 ms, including Combined, with no external double beep and with the microphone activity indicator staying illuminated. The current numbered tests build on that successful Combined profile:

| Test | Configuration | Comparison |
| --- | --- | --- |
| 1 | Previously successful Combined | Verify the control still passes after replacing the page |
| 2 | Control + screen wake lock | Request after recorder start, reacquire on return, observe system release; never stop capture on release |
| 3 | Control + production-style storage bookkeeping | Update session metadata from committed writes; write sparse diagnostic events in separate transactions; persist pause/resume session updates |
| 4 | Control + production startup order | Acquire microphone, construct recorder, await session write, construct/resume Web Audio, then start recorder |
| 5 | All three additions, warning OFF | Check interactions without the later warning |
| 6 | Test 5 + separate interruption warning | Dedicated original-URL Audio element, load before capture starts, play on hidden or mute, rearm on unmute |

For each test: select the preset; start; say “before”; switch to the same app; say “background”; return and say “after”; stop and listen. Record microphone indicator, external beep, and playback result using the controls, then export JSON. Download audio before reloading. Reload between tests and stop at the first failure; repeat the failing test and Test 1 before interpreting the result. No configuration checkboxes need changing for the numbered sequence.

If wake lock is unsupported or denied, Test 2 has not exercised the acquired-lock path; its event log records that explicitly. Presets 2–4 each change one factor from Test 1. Keep the same browser/container and microphone throughout. The warning cannot explain the original pre-warning failure.

These are explicit replicas, not imports of production code. They still omit paused reminder tones, wake-model initialization, full production UI work, and exact production object lifetime. No preset changes the browser's audioSession type. An unreproduced failure remains unresolved, rather than proof that iMuse or iOS is behaving correctly.

Earlier Reference profiles remain available for comparison; they include automatic silence resume and foreground resume/requestData. Minimal has no Web Audio branch. Numbered Combined profiles retain manual silence resume and only resume suspended contexts, matching iMuse's current behavior.

The page lists persisted lab runs for audio recovery after reload. Diagnostic events are bounded in memory (12,000 newest events, with a dropped-event count); export JSON before reloading. RAM-only recordings remain in memory until the page is closed. Storage runs release committed chunks from memory and stop at 8 MiB pending writes or on a write failure, retaining uncommitted chunks for emergency assembly. No lab recordings are automatically deleted.

Validation: JavaScriptCore syntax check, DOM/asset checks, and mocked capture/storage exercises verify final-chunk handling, committed chunk reload, and preservation after a failed write. The revision 2 mocked checks also exercise single-factor presets, ordered startup, separate warning playback, diagnostic transactions, and wake-lock release/reacquisition. Real iPhone background behavior and audible continuity still require device testing.

## Established observations

- iMuse fails with Audio commands disabled. Wake inference and TensorFlow are not necessary for the observed failure.
- The user identifies the equal-pitch double beep as external to iMuse. Its precise source (iOS, browser, or accessory) is unverified.
- The external beep can occur between words in the interruption warning. Playback acceptance or visibility alone does not establish the ordering of the underlying audio interruption.
- The warning was added after the original failure and cannot be its original cause.
- The original Lab.html worked at 250 ms with all checkboxes except visibility pause/resume enabled. Microphone mode, capture settings, and browser/PWA context must also be recorded. The 250 ms interval itself is therefore not a sufficient explanation for the failure.

## Implementation boundary

Use Lab.html and dedicated lab modules; overwrite lab pages as requested to keep the URL stable. Leave production files unchanged. Do not import recorder.js, settings.js, microphone-manager.js, or audio-response-manager.js: they have application initialization or DOM dependencies. Reproduce the relevant operations explicitly and label them as replicas.

Use an independently named IndexedDB database, imuse-background-lab-v1. No automatic deletion, no writes to production databases, no automatic microphone reacquisition or recorder restart during a diagnostic run.

## Test profiles

Freeze the complete profile at Start; export actual settings and all selected options. Each successive comparison changes one factor. Repeat failures and successes before drawing conclusions.

| Comparison | Fixed baseline | Single difference |
| --- | --- | --- |
| Reference | Existing successful lab settings | Reproduce in new lab before further experiments |
| Storage | Direct stream recorder, successful reference configuration | Transactional chunk/session persistence rather than RAM-only storage |
| Startup speech | Capture-only reference | Play the actual new-recording WAV after recorder.start, through a reusable HTMLAudioElement |
| Output sequence | Startup speech enabled | Preload and reuse the same response element for later cues |
| Capture processing | Matched input and graph | Change AGC, noise suppression, or echo cancellation individually |
| Graph | Direct recording unchanged | Add source → analyser and source → ScriptProcessor → zero gain → destination |
| Callback work | Graph enabled | Fill a rolling sample buffer, with inference disabled |
| Silence action | Matched graph and polling | Enable the production-like silence pause action; record all pause/resume events |
| Warning behavior | A configuration already known to fail or survive | No warning versus warning on hidden versus warning on actual track mute |
| Foreground recovery | Identical capture setup | Observe only versus resume suspended/interrupted context versus requestData |

Do not begin with every new option enabled. Once isolated tests pass, construct a cumulative iMuse-like profile: microphone acquisition, graph, rolling buffer, silence polling, durable storage, startup playback, visibility bookkeeping. When a cumulative addition fails, remove that addition and repeat. Interactions may require two-factor comparisons after a specific boundary is found.

Default chunk interval is 250 ms for iMuse parity; preserve a 1000 ms control. Match iMuse's MIME preference and report the actual MIME. Support system default, iMuse-like automatic headset preference, and exact device selection; report actual track settings. Distinguish requested constraints from settings actually applied.

## Evidence collection

Collect timestamped, bounded events in memory, exportable as JSON. Never await diagnostic persistence on the capture path. Render diagnostics at a low frequency only while visible; do not continuously rebuild the log DOM for every chunk.

Record:

- Run ID, profile, user agent, standalone display mode, user-entered iOS version, microphone/accessory, and test action. No web API reliably provides every item.
- visibilitychange, pagehide/pageshow, AudioContext statechange, track mute/unmute/ended, recorder start/pause/resume/error/stop, output playing/pause/waiting/ended/error, and devicechange.
- Where available, navigator.audioSession state/type changes, initially observed without assigning a type. Any explicit type setting is a separate experimental factor.
- For each nonempty dataavailable: receipt time, sequence, byte count, pending bytes. In persistence mode, separately record completed commits and transaction errors. Bound diagnostics, not captured audio silently.
- Foreground snapshots: chunks received/committed, last chunk age, recorder/track/context states, analyser RMS/peak, processor callback count, and context currentTime progression. Silence is not evidence of failure by itself.
- Playback play() request and resolution separately from playing/ended. A resolved play promise does not prove uninterrupted audible playback.

Background JavaScript can be suspended. Missing callbacks or timer ticks do not alone prove missing captured audio. A periodic timer is not a reliable background watchdog.

## Test procedure and outcome

Run the same profile in the same browser/container and with the same microphone as iMuse. Test browser and installed standalone modes separately. Switching apps, locking the screen, and opening an app that uses audio are separate scenarios.

For each run, record spoken markers before backgrounding, during a fixed background period, and after return. Use an external speaker or another person if needed. Stop normally and inspect playback for all three markers and continuity. Record whether the external beep occurred and its approximate time; browser logs cannot identify an OS sound directly.

Report outcomes separately: continuous audio; delayed/batched chunk delivery with intact audio; gap in captured audio; recorder output stalled after return; persistence-only failure; unexpected stop. Do not infer an audio gap from chunk timestamps alone, and do not label a session successful merely because recorder.state remains recording.

## Recovery experiment, separate from diagnosis

Only after capturing an unrecovered run, enable a distinct recovery profile. Attempt context resume once on return and confirm state and data progress; allow a user-gesture retry. requestData is a flush probe, not proof of fresh audio or a repair.

If testing recorder replacement, keep each MediaRecorder instance as a separate segment, preserving its final data before release when possible. Bound stop waits and retain the old session if stopping times out. Never discard buffered data to force recovery. Do not concatenate independent MP4 segments as though they were one recording.

## Decision rules

- Storage-only failure: compare receipt events with commits before changing capture.
- Startup-speech-only failure: investigate audible output/capture session interaction, independently of the later warning.
- Graph-only failure: isolate graph connections and callback work before changing recording architecture.
- Failure only in standalone mode or with an accessory: repeat the successful reference under that exact condition.
- All isolated factors pass but the combined profile fails: use cumulative additions and pairwise tests to locate the interaction.
- New lab cannot reproduce despite parity: retain that result and list remaining differences; do not claim a root cause.
