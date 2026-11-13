# iMuse documentation

Updated 13 November 2026. Current production source: **2026-11-13.7**. Current guides take precedence over historical journal entries and archived proposals.

| Document | Purpose |
| --- | --- |
| [13 November session summary](2026-11-13-session-summary.md) | Today's completed screen/library changes, production Combine, evidence and remaining checks |
| [Next steps](iMuse%20next%20steps.md) | Active priorities, remaining acceptance and deferred work |
| [Combine recordings](combine-recordings.md) | Current M4A workflow, compatibility, source history and storage behavior |
| [Future waveform/editing project](waveform-editing-project.md) | Separate proposal for waveform playback and later editing; no implementation yet |
| [Recording reliability](recording-investigation.md) | Preservation, ownership, iPhone background findings and focused manual checks |
| [Voice control](voice-control-refactor.md) | Wake/command/Silero settings, startup, prompts, diagnostics and ownership |
| [Wake-word and filename lab](wake-word-evaluation.md) | Retained lab, evaluation evidence and deferred queue investigation |
| [Regression tests](../tests/README.md) | Test commands, current coverage and verification limits |
| [Repository file map](../filemap.md) | Every repository file, organized by folder and task |
| [Build identification](build-versioning.md) | Numbering, diagnostic identity and caching limits |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Recording/transcription ownership and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Separate native feasibility and conditional scope |
| [Design journal](design-journal.md) | Dated decisions and experiments; historical instructions may be superseded |
| [Archive index](Archive/README.md) | Older reviews, roadmaps and experiments |

## Current checkpoint

- Audio-command button and Settings checkbox share one persisted preference. Status below Microphone reports enabled with the selected wake phrase, or disabled.
- Completion says Audio recording successful/unsuccessful, followed by the current player, Download and confirmed Delete. Recovery warnings and structural checks remain.
- Saved and Archived Recordings have View/Hide; opening View silently rereads storage. Archive retains audio, Unarchive preserves original chronology, and Delete permanently removes after confirmation. Recovery copies retain explicit Discard protections.
- Download pulses until initiation. Saved and archived rows report Download requested or Not yet downloaded; neither wording verifies successful external saving. Cancel retains the reminder; downloading again remains available.
- Production Combine creates a new compatible M4A without re-encoding, preserves originals, and embeds original source history. Nested chronology and repeated occurrences are retained. Combined recording is bold, Sources expands its history, and dividers distinguish controls and recordings. The temporary Combine prototype is removed; the wake/Silero lab remains.
- Filename input is 18 px; dialogs are viewport-bounded. Mutations preserve a surviving visible row where possible. Diagnostics opens View/Hide, Copy and Download of one snapshot. Deliberate pinch zoom remains available.
- All six prompts prepare at startup. Recognition models wait until Audio commands is enabled and ready models are reused. Heed / Hey iMuse is first/default at 0.75, preserving saved tuning; Silero defaults to pause evaluation on and recording evaluation off.

## Acceptance and open work

The user reports today's changes and Combine work well. The latest implementation validation is **123 methods across seventeen suites**, plus isolated Chrome checks of real AAC packet preservation, decoded order, nested/repeated history, real library/IndexedDB behavior, cancellation/errors, download markers, archive/unarchive and narrow layout.

Targeted iPhone checks remain for combined playback/seek/Files exports, filename keyboard/zoom if it recurs, and large-combination resource use. The user has already recorded more than 90 minutes; that does not certify every background or export scenario, and does not require another duration run by default.

Installed-iPhone PWA background capture, enabled-model startup responsiveness and the remaining prompt/device combinations are separate open investigations. The intermittent post-update menu issue is currently absent and was not reproduced by single emulated touches; no speculative tap suppression or site-data clearing is prescribed. Screen-lock prevention remains active without routine status text.

Automatic cleanup, waveform/editing, native feasibility, transcription/naming and version-maintenance upgrades remain future work. See Next steps and the individual project briefs before starting implementation. This documentation pass changes no application code or production build.
