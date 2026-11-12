# Native iMuse: feasibility and proposed scope

Reviewed 12 November 2026. Conditional direction, not authorization to build or migrate. No Swift implementation exists here. Xcode/device testing is deferred until the user has a suitable cable. The [earlier detailed proposal](Archive/native-proposal-2026-11-04.md) is historical; its exclusion of native transcription is superseded.

## Product direction under consideration

Keep Memora as a web application and retain web iMuse for desktop and other platforms. Evaluate native iMuse on iPhone because the installed web app loses background microphone capture even in a minimal reproducer. Safari-tab capture is the reported working web route; native capture still needs independent device verification.

If chosen, native iMuse would include transcription with multiple locally cached models, as in Memora. This expands the earlier recorder-only scope. It does not automatically include all of Memora's editing, Combine or Search features. Reuse behavior, recovery rules and interchange contracts; browser libraries, storage and model artifacts may need different native implementations.

## First gate: a small native recorder

1. Build a separate Record/Pause/Resume/Stop prototype with saved playback and export.
2. Verify actual spoken audio during app switching and screen lock, using the built-in microphone and relevant headset routes.
3. Observe file growth during capture, then verify decoding after normal Stop, interruptions and forced termination. Continuous writes do not alone prove that an unfinished container is playable.
4. Test file access while locked, permission refusal, route changes, storage errors and recovery. Retain incomplete originals until a verified final artifact exists.
5. Establish a practical installation/update route before substantial native development. Check current account-specific signing terms when selecting distribution.

Start with AVAudioRecorder; evaluate AVAudioEngine if analysis or encoding requirements justify it. Keep expensive processing away from time-critical capture callbacks. Do not promise capture after force-quit/reboot, every interruption, or indefinite idle wake listening. Siri/Shortcuts and lock-screen/headset controls are later investigations; continuing capture and starting a new recording while locked require distinct tests.

Keep the web app and its IndexedDB preservation intact until native files and recovery are verified. A separate Swift app does not directly share Safari/PWA IndexedDB; a wrapper or migration bridge needs its own design and validation.

## Recording has absolute priority

Agreed requirements for future transcription and filename generation in both implementations:

- Run only when no recording session is active. Paused sessions, startup and finalization also take priority.
- A Record request prevents new inference and suspends or cancels existing work. Verify prompt resource release on-device; a cancellation flag alone does not prove computation stopped.
- Retain source audio, queued work and committed results. Resume/restart later without duplicate results or stale updates to another session.
- Keep wake detection and command recognition needed by recording available. Transcription/model errors cannot block manual recording or redefine its completion status.
- Do not load or warm transcription models during capture. Downloads and verification must also yield if they interfere with recording.

This policy is not an implemented scheduler. The experimental lab permits filename inference to overlap a subsequent recording; do not carry that behavior into production.

## Transcription and model management

Use one service for finished-recording transcription, optional filename suggestions and later cleanup experiments. Keep outputs separate from original audio. Multiple models may remain on disk without being loaded simultaneously. Report download size, verified availability, removal and actual inference readiness separately. Native/browser runtimes may need different artifacts; do not assume shared caches or interchangeable weights. Audit Memora's current implementation before reuse.

Evaluate Base against Tiny on identical recordings: naming quality, transcription errors, elapsed time, peak memory and iPhone stability. The user's Memora experience favors Tiny-to-Base gains; this is not yet established for native iMuse. Larger models remain optional after device evidence. No production Whisper model is integrated.

Whisper stays outside live wake verification. Future cleanup scans the entire finished audio, validates timestamps through playback, and produces reversible audio/transcript derivatives. Missed or misrecognized phrases make destructive automatic removal unsuitable.

## Later gates and scope

After capture/recovery passes, port recording state rules, library/preservation behavior, microphone selection and voice coordination in independently tested steps. Native wake/command runtime compatibility requires separate evaluation. Preserve a non-destructive [Memora interchange](iMuse%20Memora%20integration%20handoff.md), without requiring either application's internal storage layout.

Test Record during model loading/inference, repeated starts/stops, paused sessions, low memory and queued-job recovery. Source recordings must remain playable/exportable after inference failure or model removal. Verify that stale results cannot change another recording's transcript/title.

Earlier conversational estimates of 2–3 development days for a feasibility recorder and 4–8 weeks for recorder parity were rough estimates. The latter excluded Memora-style transcription/model management. Re-estimate expanded scope after the prototype; this is not a schedule commitment.
