# Heed wake adapter

`heed-adapter.js` loads the Hey Doc ONNX model and exposes detection to the recorder; it does not acquire the microphone or own recording/storage transitions. Model, preprocessing and engine implementation remain in this directory. ONNX Runtime is loaded through the adapter's configured CDN URL.

The recorder feeds samples during an active session when Audio commands enables detection. Idle wake before first Record is deferred. Failure to load recognition must leave manual recording usable. `js/voice-controller.js` now owns command-window coordination through guarded recorder capabilities. Wake-model loading/inference routing now live in `js/wake-detector.js`; microphone ownership, the shared analysis graph, buffers and timing guards remain in `js/recorder.js`. The extraction and subsequent race fixes are complete and user-accepted.

For current platform findings and priorities, see the [documentation index](../../docs/README.md). Earlier stage-1 placeholder instructions and root-lab relocation plans are historical.
