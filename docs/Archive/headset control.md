# iMuse Headset Control

**Last updated:** 29 October 2026  
**Status:** Research archived; desktop-only opt-in implementation subsequently tested, mobile integration deferred.

## Current decision — 29 October 2026

The earlier investigations below are preserved as technical history, **not as an active instruction to implement iPhone headset support**. A desktop-only opt-in headset pathway was subsequently implemented in iMuse and the user reported that it seemed to work, with some variable responsiveness. Mobile headset controls were intentionally removed/disabled because reliable routing during microphone capture was not demonstrated. The user also observed similar button limitations while recording in iPhone Voice Memos. Near-silent keep-alive experiments were useful diagnostics but did not validate a production mobile route. Preserve the desktop behavior and defer further iPhone investigation. Do not add silent/near-silent playback to mobile production code without fresh evidence and explicit agreement. Earlier proposed 'next tests' in this document are historical, not current priorities.

## Principal finding — iPhone microphone capture and headset media controls

**Observed limitation:** On the tested iPhone 12 Pro Max (iOS 26.7.2), Bluetooth Shokz media-button presses did **not reliably reach browser JavaScript while the microphone was actively capturing audio**. This is the central reason mobile headset control was deferred, not a failure to register Media Session handlers or a general inability of the headset buttons to generate commands.

**Evidence and boundaries:**

- In iPhone Edge, microphone-only `MediaRecorder` capture succeeded and Media Session action handlers were registered, but headset presses did not produce the expected action logs.
- Setting `navigator.audioSession.type = "play-and-record"` was accepted and microphone chunks were captured, yet headset presses still did not reach the registered handlers.
- Outside that microphone-recording configuration, separate diagnostics with a continuously playing near-silent audio element delivered repeated `pause`, `nexttrack`, and `previoustrack` actions. Thus the buttons and JavaScript action-handling mechanism *can* work under some iPhone conditions; this does **not** establish that they work during actual microphone recording.
- The user observed similar media-button limitations while recording in Apple's Voice Memos. This supports the concern that the issue is broader than iMuse, but is not a controlled test of the underlying iOS mechanism.
- The detailed browser experiments above were conducted in **Edge on iPhone**, not a validated production Safari/PWA recording session. Do not generalize the exact failure mode to every browser, iOS release, headset, or audio-session configuration.

**Interpretation, not proven mechanism:** Activating microphone capture appears to change iOS/Bluetooth audio-session or media-control routing/ownership in a way that prevents dependable delivery of headset transport commands to the browser. We did **not** establish which internal iOS component is responsible, nor prove that the microphone invariably blocks media commands. Describe this as a reproducible limitation in the tested setup, **not** a documented universal iOS rule.

**Engineering consequence:** Preserve the desktop opt-in controls. Leave mobile headset integration disabled/deferred. Do not treat a silent/near-silent playback workaround as validated during microphone recording, and do not compromise audio capture, persistence, or finalization to force media-button support. If revisited, test headset-command delivery **with actual microphone capture active**, comparing against the same configuration without capture, and then validate Safari/PWA separately.

## 1. Goal

Determine whether a Bluetooth headset's physical media button can reliably control iMuse recording in an iPhone browser/PWA, while preserving the known-working desktop behavior. Keep iMuse as a cross-platform web app; do not move to a native iOS app merely to solve this without first establishing the browser limitations.

The desired controls are:

- While idle, a suitable headset action starts recording.
- While recording, a suitable action pauses or resumes capture.
- A designated action can finish/finalize the recording safely.

Exact action mapping can be decided after event routing is reliable. Capture durability and valid finalization take precedence over convenience.

## 2. Confirmed working behavior

### Desktop Chrome on MacBook

After the user selected **Activate headset controls** in the test, the Shokz controls worked:

- Pause while idle started recording.
- Pause/resume controlled the active `MediaRecorder` session.
- Next-track finalized and saved the recording.

This is a successful observed result for that desktop setup, not proof of iPhone behavior.

## 3. iPhone findings so far

The device used is an iPhone 12 Pro Max on iOS 26.7.2. The user's normal iPhone browser/PWA environment is Safari. Edge is used for standalone HTML diagnostics because the user's workflow does not allow JavaScript in locally opened standalone HTML files to run in Safari. A Safari-specific diagnostic must therefore be hosted over HTTPS and opened by URL.

### Generic approaches that did not provide reliable button control in Edge on iPhone

1. **Media Session handlers alone:** `navigator.mediaSession` existed and handlers registered, but presses did not reliably reach JavaScript.
2. **Generated silent WAV:** rejected by Edge with `NotSupportedError` / media error code 4. This was an invalid test-media result, not evidence about event routing.
3. **Valid silent MP3:** playback succeeded (`play()` resolved; `readyState` 4). A Shokz press caused the audio element to emit a `pause` event, but no Media Session action handler was logged. The button could route to/control Music instead.
4. **Microphone-only recording:** mic capture and chunks worked; handlers registered, but headset presses produced no action logs.
5. **Microphone with `navigator.audioSession.type = "play-and-record"`:** the browser accepted the type, microphone capture worked and 14 chunks / 178,412 bytes were captured over about 22 seconds, but no headset action reached the handlers. This did not solve routing.

### Hosted Web Device Test clue

Reference page tested by the user:

https://webdevicetest.com/en/tools/media-session-key-test?utm_source=chatgpt.com

The user inspected and supplied the page's JavaScript previously. The page registers Media Session action handlers, creates a looping two-second 220 Hz tone in 8 kHz mono 16-bit WAV at low volume, starts playback, and sets `navigator.mediaSession.playbackState = "playing"` after `audio.play()` resolves.

In the user's iPhone Edge test, silent and audible sessions behaved alike: the first Shokz press reached the page and logged `ACTION FIRED: pause (#1)`, followed by an audio `pause` event. Later presses were not logged by the page and appeared to be routed to Music. The logged user agent was `EdgiOS/155.0.4283.61` on iOS 26.7.2, so these are Edge results, not direct Safari results.

This was meaningful evidence that the page could receive at least one command, but did not explain why later commands stopped reaching it.

### Successful near-silent keep-alive tests

A separate keep-alive diagnostic deliberately ignored pause commands and kept its audio actively playing. The user received repeated `pause` events and `nexttrack` / `previoustrack` actions. This showed that repeated commands can reach JavaScript when the media element remains playing.

The subsequent recording-control simulation used a looping tone and mapped Media Session actions to a simulated recording state. Repeated commands were received, but the simulation did not keep the audio state synchronized with the simulated recording state; the tone stayed playing after the simulated session was marked Finished.

The latest **minimum-volume** test further confirmed that audio does not need to be meaningfully audible for this to work. It used a generated waveform amplitude of 0.01% of full scale, with the audio element's volume property at 1% and `muted=false`. The log showed:
- 7 `pause` actions received.
- 3 `nexttrack` actions received.
- 2 `previoustrack` actions received.
- No independent audio interruption reported in the supplied log.

Several commands after the simulation was marked Finished were correctly logged but ignored by the simulation's state logic. This is evidence that repeated event delivery works at near-silent volume while playback remains active. It does **not** yet prove how to maintain command delivery while switching between simulated Recording and Paused, nor does it validate Safari.

## 4. Current conclusions and remaining unknowns

### Supported by the tests

- Repeated headset media-button commands can reach JavaScript in Edge on this iPhone when a looping media element remains actively playing.
- The media element can be near-silent; a normally audible tone is not required in the tested setup.
- Pause, next-track, and previous-track actions can be distinguished by Media Session handlers.
- Desktop Chrome on the user's MacBook has a working headset-control route that should be preserved.

### Still unknown

- Whether Edge/Safari continues delivering commands when the simulated recording alternates between Recording and Paused while the keep-alive audio continues playing.
- Whether Safari on iOS behaves the same as Edge.
- Whether the exact same approach remains reliable during actual microphone capture, and across a long recording.
- Whether any browser/iOS lifecycle events interrupt the media element or microphone capture during screen locking, app switching, or other interruptions.

Do not treat the successful Edge diagnostic as proof of Safari support or production readiness.

## 5. Historical proposed validation plan (deferred; not current work)

### Historical Step 1 — Test simulated Recording/Paused transitions with audio kept playing

Make one focused change to the standalone simulation only; do not modify production iMuse yet.

- Keep the near-silent media element playing continuously.
- Map each `pause` action to toggle the **simulated** state between Recording and Paused.
- Do not call `audio.pause()` or change Media Session playback state to `"paused"` when the simulated recording pauses.
- Log each action, the simulated state before and after, `audio.paused`, and `navigator.mediaSession.playbackState`.
- Keep `nexttrack` as a simulated Finish action, but test repeated pause/resume toggles before finishing.
- Keep the **Copy log** control.

Test several Recording → Paused → Recording transitions, followed by a finish action. Confirm that the audio element remains playing and every command continues to reach JavaScript. This isolates whether the keep-alive approach supports state toggling without confusing recording state with media playback state.

### Historical Step 2 — Validate on iPhone Safari

If Step 1 succeeds in Edge, host the same minimal diagnostic over HTTPS and test it in iPhone Safari. Do not ask the user to open a local standalone HTML file in Safari. The Safari result is required before calling the route validated for the user's normal iPhone browser/PWA environment.

### Historical Step 3 — Production design if validation succeeds

Use **two platform-specific pathways with one shared recording controller/state machine**:

- **iPhone/iOS pathway:** keep the near-silent media element playing through both actual Recording and Paused states. Pause/resume the `MediaRecorder` independently; do not pause the keep-alive element merely because recording pauses. Finish should safely finalize the recording, then stop and release the keep-alive media session.
- **Desktop Chrome pathway:** preserve the existing working headset-control behavior. Do not introduce persistent keep-alive audio on desktop unless testing demonstrates that it is necessary.
- Keep platform detection and the media-session policy isolated, while reusing the same start/pause/resume/finalize recording functions. Avoid maintaining two independent recording implementations.

Before production integration, verify that pause/resume/finish actions cannot lose, duplicate, or prematurely discard audio; verify finalization produces a playable file and preserves source data until validation succeeds. Also test actual microphone capture, long-session behavior, and relevant lifecycle interruptions.

### Historical Step 4 — Stop/go decision and cleanup

If the simulation or Safari validation fails, document the observed failure and reassess the pathway before touching production. Do not add layers of speculative workarounds. Once testing is complete and any proven behavior is integrated, remove temporary diagnostic UI and logging from production code.

## 6. Historical working hypothesis (superseded by current decision)

The latest minimum-volume test changes the working hypothesis: the most promising iPhone pathway is to **keep a near-silent media element actively playing even when the recorder is paused**, while keeping the recorder's state separate from the media session's playback state. The next test is to verify repeated simulated Recording/Paused toggles with that keep-alive audio left running.

The desktop pathway should remain unchanged. Production integration is still gated on the transition test and an HTTPS-hosted Safari test.

## 7. Handoff for future investigation

Current disposition: preserve the opt-in desktop pathway, which worked in the reported MacBook test but later showed variable responsiveness. Do not assume mobile headset control is available. The near-silent keep-alive route was only demonstrated in Edge diagnostics, not as a Safari/PWA recording solution. If the project later reopens this investigation, begin with the recorded observations above and the then-current production code; require fresh user approval before adding keep-alive audio. Recording durability and finalization remain non-negotiable.
