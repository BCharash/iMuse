# Stage 2 — wake engine selection and isolation

- Voicute and Heed are separately housed and selectable in Settings.
- The selected wake engine and each threshold persist on this device.
- Microphone identification stays visible outside Settings.
- **This is a staged integration:** Voicute retains its previous resume-on-wake behavior during paused recording. Heed detects Hey Doc during paused recording but deliberately does **not** resume; its detection is reported in the wake status. Neither engine starts idle wake listening yet.
- Go/Stop commands, voice responses, and the five-second command window are **not yet implemented**. These belong to Stage 3. Do not rely on voice control for stopping a recording.

## Test
1. Confirm normal manual record/pause/resume/stop and saved audio recovery.
2. Select Voicute; confirm Hey Friday resumes a paused recording as before.
3. Select Heed; confirm Hey Doc is detected in the status, but recording stays paused.
4. Change thresholds, reload, and confirm values and engine selection persist.
5. Switch engines during a paused recording and confirm no crash or lost recording.
6. Verify microphone label remains visible with Settings expanded.

Heed requires an HTTPS or localhost origin and network access for ONNX Runtime. If its model fails to load, use manual controls and report the error.
