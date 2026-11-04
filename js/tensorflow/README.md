# TensorFlow command adapter

`commands-adapter.js` loads TensorFlow.js and Speech Commands through its configured CDN URLs. Go/Stop and Yes/No inference is used in bounded command windows owned by `js/voice-controller.js` through recorder-owned session capabilities; Whisper is not involved.

Listener startup temporarily intercepts `navigator.mediaDevices.getUserMedia` to supply a clone of the active recording track, restoring the original method in `finally`. Generation guards and serialized startup/shutdown reject late callbacks. This does not prove all microphone-lifecycle races are resolved; preserve the recording track when changing adapter ownership.

`labs/iMuseCmd.html` and its worklet are pre-existing voice-command diagnostics. They remain distinct from the removed temporary background-capture labs. See the [documentation index](../../docs/README.md) for current work; Stage 3 is no longer an unimplemented reservation.
