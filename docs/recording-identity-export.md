# Recording identity in exported audio

Candidate build: 2026-11-16.2.

Each new recording receives a cryptographically generated UUID before it is saved. Downloads embed that same UUID; they never generate a replacement. Current-player, saved, archived and emergency downloads use the same exporter. Filenames and the filename dialog are unchanged. Stored audio is not rewritten.

## Version 1 contract

UTF-8 JSON:

```json
{"format":"imuse-recording","version":1,"recordingId":"12345678-1234-4234-8234-123456789abc"}
```

Memora should recognize the format and version, validate the UUID, and use it as the Recording ID. Apple Voice Memo IDs remain a separate supported input convention in Memora. Unsupported versions, duplicate or conflicting identities and invalid payloads must be reported rather than guessed. Metadata is bounded to 4 KiB.

| Audio container | Storage |
| --- | --- |
| M4A / MP4 | Top-level UUID box, user type `91c3892e-57a4-4f78-a983-3a19947c9c01`; payload is the JSON above |
| WebM | Native SimpleTag named `IMUSE_RECORDING_METADATA`; string is the JSON above |
| Ogg Opus / Vorbis | Comment named `IMUSE_RECORDING_METADATA`; value is the JSON above |
| RIFF WAVE | `imID` chunk containing the JSON above, with RIFF padding |

Container detection uses file signatures, not filename extensions. The independent codec in `js/recording-identity.js` exports both embedding and readback functions. It preserves encoded audio bytes and does not decode or re-encode audio. Necessary container lengths, Ogg sequencing and checksums are updated. Existing comments are preserved. Existing combined-recording provenance remains unchanged, and its ID must match the export ID.

If the container is incomplete, unsupported or cannot safely accept metadata, iMuse downloads the original audio and explicitly reports that no recording ID was embedded. This keeps emergency audio export available. It does not claim such an export carries identity metadata. Export readback validates successful embedding before download.

## Validation

`test_recording_identity.py` covers M4A, WebM, Ogg Opus/Vorbis and WAV, audio-byte preservation, repeated export, conflicting IDs, combined provenance, malformed containers, metadata limits and Ogg comment page growth. Download tests cover identity forwarding, cancellation and the unchanged-audio fallback warning.

Real iPhone Safari recording, playback and download validation is required before declaring cross-platform readiness. Files passed through third-party editors or converters may lose private metadata; retaining it is outside iMuse control. Memora still needs its separate reader integration.
