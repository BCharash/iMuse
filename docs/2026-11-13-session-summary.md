# 13 November 2026 — recording library and Combine

End-of-day production checkpoint: **2026-11-13.12**. The user reports that the changes look good and that Combine works. Automated/browser evidence and remaining device checks are distinguished below. This summary records today's final outcome; earlier proposals are not implementation instructions.

## Main screen and recording library

- Fixed the main audio-command button's unreadable resumed state. It and the Settings checkbox now control one persisted on/off preference, including during recording/pause. Concise command status appears below Microphone.
- Simplified the result to Audio recording successful/unsuccessful, followed by player, Download and confirmed permanent Delete. Underlying structural checks and recovery warnings remain.
- Added gentle Download reminders until initiation. Cancel retains the reminder; a request clears it and persists per recording. A request does not prove successful saving to Files. Download remains repeatable.
- Replaced Recently Deleted terminology with Archived Recordings. Saved and Archived have independent View/Hide controls. Archive retains audio, Unarchive preserves original date/order, and Delete is permanent after confirmation. Emergency memory-only recovery retains its explicit Discard safeguards.
- Removed routine screen-lock status text while retaining prevention behavior and interruption notices. Removed Refresh recordings: opening either View silently rereads storage.
- Changed filename-entry text to 18 px, avoided requested focus scrolling and bounded the dialog to the viewport. Deliberate pinch zoom remains available; no forced full-view zoom or tap suppression was added.
- Shortened list actions to Download, Archive, Delete and Diagnostics. Diagnostics opens View/Hide, Copy and Download for one report snapshot. List mutations preserve the next surviving visible row where possible.
- Added separators between recordings and between Saved controls and the list. Combined recording is bold in both categories. Archived rows show Download requested or Not yet downloaded before deletion.

## Production Combine

The capture-time append selector was superseded by an independent Saved Recordings Combine workflow. Select at least two initially unchecked finished recordings, create a new chronological M4A, preserve originals, and expand Sources to inspect history. New results rise to the top with their own download reminders and ordinary library actions.

Compatible single-track AAC/M4A is remuxed without re-encoding; mismatched configurations and incomplete/unsupported inputs are rejected. Nested sources are flattened by original capture date, and repeated occurrences are retained. Versioned source snapshots and packet/sample boundaries are stored in IndexedDB and embedded in the exported M4A. A worker handles processing, output readback precedes publication, and one transaction saves the new session/Blob under the existing writer lock. Cancel/failure leaves no partial result and does not rewrite originals.

The temporary PCM-WAV Combine prototype was removed after production integration. Its short-clip limits do not apply to production. The existing wake-word/Silero lab remains. See [Combine recordings](combine-recordings.md) for the schema, dependency and complete workflow.

## Evidence and remaining checks

At build .7, **123 methods across seventeen suites passed**. Isolated Chrome checks generated actual AAC clips, verified unchanged packet hashes and decoded source order, nested/repeated sources, real IndexedDB/library behavior, cancellation/error handling, download markers, Archive/Unarchive, bold labels/dividers and a 390 px layout without horizontal overflow. Earlier checks covered preference mirroring during synthetic capture, stop cleanup, diagnostics and list anchoring.

The user's positive reports establish practical acceptance of the exercised workflow; they do not establish every iPhone/browser/storage scenario. Remaining targeted checks: combined-file playback/seek and saving/opening in iPhone Files, filename keyboard/focus behavior if it recurs, and resource measurements for large combinations. Do not require another >90-minute capture merely to repeat the user's existing successful recording. Installed-iPhone PWA off-window/lock-screen capture and lightweight Swift feasibility remain separate work.

## Future work and documentation

[Waveform playback and recording editing](waveform-editing-project.md) is a separately documented future project: waveform/seek first, then trimming into a new copy, with long-file memory and cut precision designed explicitly. The brief subsequently incorporated the reviewed Gemini ideas: peak resolutions, viewport drawing, bounded decoding and an edit decision list, with corrected Safari/storage claims and explicit preview/resource limits. No editor code or dependency was added.

The documentation index, roadmap, recording/voice guides, Combine guide, test guide and file map were synchronized. Removed stale Refresh instructions, conflicting current-build/test counts, obsolete append instructions and prototype resume gates from active guidance. The journal retains dated decisions with superseded status identified. That documentation pass left application code and build .7 unchanged. The subsequent UI change below advances the production candidate to .8.

## Readiness status follow-up — build 2026-11-13.8

Placed an independent 18 px Ready to record status below Stop, followed by Microphone, Suspend/Resume audio commands and enabled/disabled command status with the active phrase. Removed (not listening) from inactive microphone wording. Readiness is visible whenever New Recording is available, including alongside Audio recording successful, and hidden during recording, pause, preparation, finalization and Combine. Recording/storage/voice behavior is unchanged. All 123 regression methods pass; isolated Chrome checks cover initial layout and the capture/finalization/success readiness transition.

## Countdown follow-up — build 2026-11-13.10

Prepared paused browser-driven countdown animations at the same unconditional startup point as spoken prompts. Go/Stop animation previously waited for listener startup before JavaScript updates began, explaining a full circle followed by a jump. Visual progress now starts before listener preparation, with a bounded first-frame presentation opportunity and cancellation guards; the original deadline and Yes/No readiness policy remain. SVG fallback and microphone/model ownership are preserved. Four added tests bring the current total to 127 methods; browser checks verify preparation, timeline progression and cleanup. First-wake iPhone smoothness remains a targeted user check. The earlier .9 update enlarged audio-command status to 16 px; Ready to record remains 18 px.

## Listening-window alignment — build 2026-11-13.11

User clarified that both command phases should display the countdown and that it must approximate actual receptivity. Supersedes the preceding .10 timing: Go/Stop and Yes/No now keep the circle hidden during preparation, then begin command acceptance, a fresh full configured deadline and the visible countdown together after listener startup completes. No preparation message or first-frame waiting delay is added. Paused animation preparation at startup remains. 127 regression tests and isolated delayed-listener browser checks pass; first-use iPhone timing still needs device acceptance.

## Title and palette — build 2026-11-13.12

Displayed the new user-provided iMuse icon next to the main title and matched Memora’s current light gray/white/navy/lavender palette. Applied the colors to panels, text accents, buttons, selected states and dividers, with distinct recording symbols and download reminders retained. No recording, recognition or storage behavior changed. Existing user asset changes were preserved; the file map reflects the available icons. Memora was inspected read-only.
