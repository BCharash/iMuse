# iMuse → Memora integration handoff

Updated 3 November 2026. This document owns the integration contract, not the recording investigation or immediate development queue. See the [index](README.md), [current priorities](iMuse%20next%20steps.md), and [platform evidence](recording-investigation.md).

## Objective and scope

Incorporate iMuse's independent Record subsystem into the Memora-based application with intended tab order **Record → Transcribe → Edit and Combine → Search**. Reuse Memora's existing desktop/mobile file opening and saving, Whisper runtime/model management, transcription, editing/combining, and search. Record must work independently of transcription, voice models, and network-dependent features.

The iPhone installed-app background failure is unresolved. Safari-tab recording succeeds in the reported warning-free tests; that does not certify installed iOS capture or lock-screen reliability. Combining repositories must not be presented as a fix for host lifecycle behavior. The removed interruption warning must not return during integration.

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
- Current recovery promotes successfully rebuilt audio to normal saved-recording behavior while retaining interruption history. The follow-up reload-after-recovery label test remains unreported; see the roadmap.
- Manual Stop finalizes directly. Spoken Stop requests Yes/No confirmation: Yes finalizes; No/timeout leaves capture paused. Wake during recording pauses before command listening; wake while paused acknowledges “Yes?”. Silence/manual pause do not themselves start a command listener.
- Keep ordinary startup/pause/resume/stopped/confirmation WAV cues and periodic paused reminder tones. The external iPhone background-transition beep is distinct from those application cues.
- Support exposed headset microphones through selection. Physical headset media-button controls were retired on both platforms; do not import the older desktop control pathway.
- Ordinary deletion uses Recently Deleted; permanent deletion is explicit. A new recording does not disturb other sessions. The normal Delete control is hidden during active capture; that historical UI statement is not a guarantee against every asynchronous deletion race.

## Integration sequence, when scheduled

1. Inspect current source in both projects. The iMuse workspace is authoritative; obtain Memora code if it is not available. Earlier ZIP names and previous assistant descriptions are not source revisions.
2. Map iMuse session export/recovery to Memora's actual import/transcription interface. Verify formats, identity, ownership, error propagation and object URL lifetime before implementation.
3. Implement the smallest handoff while preserving Record's own storage and lifecycle. Avoid a concurrent media/storage rewrite or duplicate model/file-picker system.
4. Test one ordinary completed and one interrupted/recovered recording through Transcribe, on desktop and the supported iPhone browser route. Source recordings must remain available after both success and failure. Recheck existing mobile import/save behavior.

Integration is not evidence that background capture or every recovered container is valid. The pending-memory bound does not certify long-file assembly. Broader finalization/metadata work remains in [Next steps](iMuse%20next%20steps.md), not duplicated here.

## Deferred work

Idle voice-start before first Record, custom wake training, command-audio removal, OPFS/storage redesign, native recording, and headset media-button research are independent workstreams. A future native recorder exports audio/metadata to Memora rather than reproducing its entire transcription/search stack. Nothing in this contract schedules those features automatically.
