# Background capture investigation — findings retained after lab removal

Status: the temporary lab pages and dedicated lab script were removed at the user's request. The spoken interruption warning, its setting, and its WAV were also removed from iMuse. This document retains the findings for the next investigation; it is not a runnable lab guide.

## Device and execution-mode results

These are user-reported device tests, not automated validation.

| Environment | Background recording |
| --- | --- |
| MacBook Chrome tab | Successful |
| MacBook Chrome installed app | Successful |
| MacBook Safari Dock web app (as described by user) | Successful |
| iPhone Safari tab, interruption warning disabled | Successful |
| iPhone installed iMuse, warning enabled or disabled | External double beep; background recording lost |
| iPhone installed lab | External double beep; background recording lost |

The original background failure and external beep predated the warning feature. Successful Safari-tab labs did not establish that an installed iPhone web app could record in the background. The installed-lab reproduction narrows the remaining issue to the iPhone standalone environment rather than a PWA problem across all platforms. The exact operating-system trigger and meaning of the beep remain unverified.

## Separate warning-playback failure

In iPhone Safari-tab lab tests:

- All initial presets, including the combined iMuse-like configuration, recorded before/background/after speech at a requested 250 ms chunk interval.
- Wake lock, production-style storage bookkeeping, and startup order additions passed with the warning off.
- Preparing a dedicated warning player without playing it passed.
- Playing the warning on visibility hidden reproduced lost capture with either the dedicated or shared audio player.
- Warning off and warning on microphone mute passed. Without a warning actually playing in response to a mute, the latter does not establish that playback during an interruption is safe.

Reviewed JSON showed an interrupted AudioContext in both a successful and failed run. The successful run continued emitting chunks while hidden. In the failed run, chunks stalled after background warning playback and did not resume when the AudioContext returned to running. Every received chunk was committed, excluding failure to save those received chunks as the explanation. A later silence auto-pause followed the stall rather than causing its onset.

The user additionally observed that Safari-tab capture could resume after a short warning-associated interruption, with the background interval missing, whereas longer interruptions prevented recovery. This is distinct from the installed-iPhone failure, which occurred regardless of the warning setting.

## Cleanup boundary

Removed: Lab.html, BackgroundCaptureLab.html, js/labs/background-capture-lab.js, audio/recording-interrupted.wav, warning preparation/playback/deduplication code, and the warning settings control.

Retained: recording and storage paths, visual lifecycle notices, existing recording diagnostics, unrelated audio cues, and the pre-existing TensorFlow command labs. Existing lab IndexedDB data is not deleted; production recordings and stored audio are not cleared. An old warning property in localStorage is ignored and is omitted the next time settings are saved.

## Next investigation

Use the warning-free production build as the baseline. Investigate iPhone standalone capture restrictions and potential workarounds separately from foreground recovery. Compare the same minimal capture configuration in a Safari tab and installed web app if a targeted reproducer becomes necessary; do not repeat the broad component matrix without a specific hypothesis. No PWA workaround has yet been established.
