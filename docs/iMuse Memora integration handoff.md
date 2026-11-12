# iMuse → Memora integration handoff

Reviewed 12 November 2026. This document owns the integration contract, not the recording investigation or immediate development queue. See the [index](README.md), [current priorities](iMuse%20next%20steps.md), and [platform evidence](recording-investigation.md).

## Objective and scope

The earlier web integration option would incorporate iMuse's independent Record subsystem into the Memora-based application with intended tab order **Record → Transcribe → Edit and Combine → Search**. Reuse Memora's existing desktop/mobile file opening and saving, Whisper runtime/model management, transcription, editing/combining, and search. Record must work independently of transcription, voice models, and network-dependent features.

The iPhone installed-app background failure is unresolved. Safari-tab recording succeeds in the reported warning-free tests; that does not certify installed iOS capture or lock-screen reliability. Combining repositories must not be presented as a fix for host lifecycle behavior. The removed interruption warning must not return during integration.

The user is also considering keeping Memora web-based and building native iMuse with its own transcription and multiple cached models, while retaining web iMuse for other platforms. That expands the native proposal; it does not authorize a repository merger or require this web integration. See the [native scope](iMuse%20Swift%20migration%20plan.md). The transfer contract below applies regardless of UI packaging.

Recording always takes priority over transcription and filename jobs, including during pause/startup/finalization. Future jobs run only when recording is inactive and yield to Record requests. This scheduler is a requirement, not implemented production behavior.

## Ownership and minimum transfer contract

| Owner | Responsibility |
| --- | --- |
| Record | Microphone, manual/silence/voice transitions, ordered chunk persistence, recovery, saved/recently deleted recordings, explicit deletion, capture metadata and playable audio |
| Memora | File open/save/export conventions, Transcribe, Whisper model/runtime management, transcript editing/combining and Search |
| Integration boundary | A Blob/File or retrieval function, actual MIME/container, correct filename/extension, stable source session ID, and honest completed/recovered/interrupted status |

Include duration only when it is reliably known. Keep a future editable title separate from identity. Do not couple Memora to internal IndexedDB object-store layout if a retrieval interface suffices. Determine who owns temporary Blob/object URLs and when they may be revoked.

Passing a recording to Transcribe, exporting, suggesting a title, or creating a transcript must not delete or overwrite source audio. Failure leaves the original available. Newly recorded and externally imported audio should reach the same Memora transcription path. Preserve actual formats: successful WebM import and M4A/AAC preference do not imply interchangeable containers or safe extension relabeling.

## Recording behavior to preserve

- Committed chunks have been recovered after reload in user tests, with playable/downloadable output; a short uncommitted tail may be lost. Recovery is not an absolute crash/eviction guarantee.
- Recovery offers the fullest available audio and retains interruption/error classification. Structural checks do not prove media decoding or continuous capture. Keep emergency memory copies independent of player changes; do not make transcription release them.
- Manual Stop finalizes directly. Spoken Stop requests Yes/No confirmation: Yes finalizes; No/timeout leaves capture paused. Wake during recording pauses before command listening; wake while paused acknowledges “Yes?”. Silence/manual pause do not themselves start a command listener.
- Keep ordinary startup/pause/resume/stopped/confirmation WAV cues and periodic paused reminder tones. The external iPhone background-transition beep is distinct from those application cues.
- Support exposed headset microphones through selection. Physical headset media-button controls were retired on both platforms; do not import the older desktop control pathway.
- Ordinary deletion uses Recently Deleted; permanent deletion is explicit. Writer ownership protects active/finalizing sessions, and unsaved emergency copies cannot be deleted through saved-list controls. The separate saved-player dialog leaves the top in-memory player intact. Integration must retain the storage-coordination boundary.

## Integration sequence, when scheduled

1. Inspect current source in both projects. The iMuse workspace is authoritative; obtain Memora code if it is not available. Earlier ZIP names and previous assistant descriptions are not source revisions.
2. Map iMuse session export/recovery to Memora's actual import/transcription interface. Verify formats, identity, ownership, error propagation and object URL lifetime before implementation.
3. Implement the smallest handoff while preserving Record's own storage and lifecycle. Avoid a concurrent media/storage rewrite or duplicate model/file-picker system.
4. Test one ordinary completed and one interrupted/recovered recording through Transcribe, on desktop and the supported iPhone browser route. Source recordings must remain available after both success and failure. Recheck existing mobile import/save behavior.

Integration is not evidence that background capture or every recovered container is valid. The pending-memory bound does not certify long-file assembly. Broader finalization/metadata work remains in [Next steps](iMuse%20next%20steps.md), not duplicated here.

## Deferred work

Idle voice-start before first Record, command-audio removal, OPFS/storage redesign, native recording, and headset media-button research are independent workstreams. A future native iMuse may transcribe locally and still export audio/metadata to Memora. Model-management and recording behavior can share contracts without sharing runtime files or databases; full native Search/editor parity is not agreed. Nothing in this contract schedules those features automatically.
