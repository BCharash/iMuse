# Voice command integration — test checklist

This stage connects Heed/Voicute wake detection during an **active or paused** recording to TensorFlow Go/Stop inference. It does **not** enable always-on listening while no recording exists; that requires a separately managed idle microphone stream and browser permission/lifecycle handling. Manual recording remains available.

## Install

Copy the ZIP's files into the repository, preserving paths. The four MP3 responses live under `audio/`; existing `yes.wav` stays at the repository root. Do not remove the Heed model files or Voicute adapter.

## Tests

1. Enable **Audio commands** in Settings; choose Voicute or Heed. Verify recording and pause/resume still work without voice recognition.
2. While recording, say the selected wake phrase. Recording should pause and play “Pause”; the Go/Stop countdown should appear once TensorFlow is ready.
3. Say Go within the window: hear “Recording” and resume the same recording. Repeat for both engines.
4. While manually paused, say wake phrase: hear “Yes?”; say Go to resume or Stop to finalize.
5. Say the wake phrase and remain silent: countdown expires, recording stays paused, periodic reminder beeps continue, and wake recognition rearms.
6. Say Stop during the window: recording finalizes and plays “Recording Stopped.” Check saved chunks, playback, download, and recovery after reload.
7. Change thresholds, overlap, and window length; reload to verify saved values. Disable Audio commands and confirm no wake detection.
8. Check MacBook and iPhone microphone labels and check the browser console for errors. Test Bluetooth separately.

## Caveats

- Browser microphones and audio playback may require a user gesture; locked-screen iPhone listening is not guaranteed.
- The command recognizer may have a startup delay on its first use, since its model loads lazily. The five-second window begins after loading.
- No automated browser/device microphone tests were run here; only static JavaScript syntax checks.
- Existing recording persistence code was not redesigned; verify crash recovery before relying on this build.
