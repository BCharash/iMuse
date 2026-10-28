# iMuse Headset Control

**Last updated:** 28 October 2026  
**Status:** Investigation in progress; no production-code change authorized or made.

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

This is meaningful evidence that the page can receive at least one command. It does not yet explain why later commands stop reaching it, nor prove that the route can control a recording session.

## 4. Current hypotheses — not established facts

### Hypothesis A: playback state is not synchronized after pause

In the iMuse diagnostic, the `pause` handler calls `audio.pause()` but does not set `navigator.mediaSession.playbackState` to `"paused"`. The page can therefore report `"playing"` while its audio element is paused.

That is a concrete state-management defect worth correcting in the diagnostic. It is **not yet proven** to cause iOS/Edge to route subsequent presses to Music.

### Hypothesis B: iOS/browser media-control routing changes after the first press

The first command may be routed to the page, after which the browser or operating system may treat the page's media session as inactive or choose Music as the target. This fits the observations but is not proven. Other lifecycle or browser-routing causes remain possible.

### What is not established

- That iOS blocks all web-based headset controls.
- That Safari behaves the same as Edge.
- That the reference page uses a distinct direct JavaScript headset API. The available clue currently points to Media Session/audio playback, but the exact cause of the first-versus-subsequent press behavior remains unresolved.
- That recreating the audio element or reinitializing the whole session will solve the problem.

## 5. Next steps

### Step 1 — Make one focused standalone experiment

Do not repeat the silent-versus-audible comparison, microphone-only test, or `play-and-record` test unless a new hypothesis requires it.

Modify a copy of the existing standalone diagnostic—not production iMuse—to keep playback state synchronized:

- After `audio.play()` resolves, set Media Session state to `"playing"`.
- In the `pause` handler, pause the element and set state to `"paused"`.
- In the `play` handler, resume the element and set state to `"playing"` only after playback succeeds.
- Log the received action, `audio.paused`, and `navigator.mediaSession.playbackState` after each transition.
- Do not clear handlers or stop/recreate the session after an ordinary pause. Keep the session alive for the repeated-press test.

Test three or more presses in sequence. The key outcome is whether subsequent commands reach the page, not merely whether a tone can be heard. If this does not improve routing, record that result and move to the next hypothesis rather than layering on more changes.

### Step 2 — Inspect lifecycle only if Step 1 fails

Compare the reference page and diagnostic lifecycle in detail: handler registration timing, audio-element lifetime, playback-state updates, metadata, pause/resume behavior, and whether any code clears handlers or ends playback. Use the JavaScript already supplied/inspected; do not ask the user to extract or resend it.

If a new, evidence-based lifecycle difference is found, test that one difference in the standalone diagnostic. Avoid full audio-session reinitialization unless simpler tests show that the session actually becomes inactive and reinitialization restores routing.

### Step 3 — Stop/go decision

If the standalone can receive repeated actions reliably in Edge, consider the route promising but not yet validated for Safari. Then host the same minimal diagnostic on HTTPS and have the user open the URL in iPhone Safari. Do not ask the user to open a local standalone HTML file in Safari.

If no repeated-command route can be demonstrated, state that plainly and weigh alternatives, including keeping headset controls as a desktop-only capability or using the separately explored spoken wake-word approach. Do not integrate an unproven workaround into production.

### Step 4 — Production integration only after proof

If repeated controls work in a diagnostic and Safari validation supports the approach, integrate through a platform-aware design:

- Keep the working desktop Chrome path.
- Detect the runtime/platform at initialization and use a separate mobile pathway only if evidence requires it.
- Reuse the existing recording controller and state machine rather than creating a second recording implementation.
- Ensure pause/resume/finish actions cannot lose, duplicate, or prematurely discard audio.
- Validate that finalization produces one playable file and preserves source data until validation succeeds.
- Remove diagnostic UI/logging when testing is complete.

## 6. Immediate decision

The next action is **not** to rewrite iMuse, repeat generic media tests, or reinitialize the entire audio system. It is to correct the diagnostic's playback-state synchronization and test repeated button presses while leaving the media session alive. This is a small experiment based on a concrete defect, with an explicit caveat that its causal role is unproven.
