# Stage 1 — structure, settings, and microphone visibility

- Added settings panel and persistent per-device values in localStorage. Audio commands default **off** because the new voice integration is not yet active.
- Headset opt-in is desktop only and persists. The existing Voicute wake-word behavior remains unchanged in this stage; the new audio-command toggle does not yet control it.
- Microphone name is taken from the actual acquired audio track (including the startup readiness probe). It may be a generic label if the browser withholds the name.
- Reserved isolated Heed and TensorFlow subdirectories. The standalone lab and its assets have **not** been relocated yet, to avoid breaking their relative paths.
- Recorder capture, storage schema, pause/resume, save, and recovery are otherwise unchanged.

## Acceptance check before stage 2

1. Start app, open Settings, change a threshold, reload, verify it persists.
2. On desktop enable headset control, reload, verify checkbox remains checked; on iPhone it remains hidden.
3. Confirm microphone label appears after readiness probe and when recording starts.
4. Record, pause/resume, stop, play, reload, recover and delete a test session as before.
5. Do not expect the new Go/Stop or countdown functionality yet.

## Important

The currently deployed Voicute wake word is **not** replaced in this stage. Stage 2 will explicitly replace it with Heed and connect the Audio commands setting.
