# Documentation archive

Reviewed 12 November 2026. These are retained investigations, design decisions and implementation snapshots. Their imperative wording, “current” labels and test counts describe their original dates. Use the [active index](../README.md) for present work; archived checklists do not authorize restoring retired features or repeating completed stages.

| Snapshot | Why retained / what supersedes it |
| --- | --- |
| [Wake evaluation evidence, 12 November](wake-evaluation-evidence-2026-11-12.md) | Historical Hey Doc replay/label/threshold measurements; current lab use remains in the active evaluation guide. |
| [Voice-control extraction history, 5 November](voice-control-history-2026-11-05.md) | Detailed pre-acceptance characterization, staged extraction, original race observations and prior UI/diagnostic validation. Current accepted architecture is in the voice-control guide. |
| [Native proposal snapshot, 4 November](native-proposal-2026-11-04.md) | Earlier recorder-only scope and system-integration detail; current native guide includes possible transcription/model management and recording priority. |
| [Recorder lab guide snapshot, 4 November](recorder-lab-guide-2026-11-04.md) | Detailed startup/build history and earlier live Whisper procedures; current evaluation guide records rejected latency and detector-aligned Silero work. |
| [Recording investigation/stage history, 3 November](recording-investigation-stages-2026-11-03.md) | Lab evidence, negative experiments and preservation-stage implementation notes; current behavior and manual checks live in the recording brief. |
| [Architecture stabilization review](architecture-stabilization-review.md) | Earlier source audit and unique microphone/adapter questions; historical findings are not current defects without reproduction. |
| [Recording handoff, 2 November](recording-investigation-handoff-2026-11-02.md) | Startup-instrumentation regressions, cache incident and older hypotheses; later installed-host evidence supersedes the iMuse-specific hypothesis. |
| [Roadmap, 1 November](roadmap-2026-11-01.md) | Detailed UUID/provenance, naming and Combine requirements; current priorities live in Next steps. |
| [Wake-word experiments](wake%20word%20implementation.md) | Early Voicute/Heed phrase/model/threshold evidence; pause-only and Whisper-command proposals are superseded. |
| [Headset experiments](headset%20control.md) | Media-button/keep-alive findings; those controls were retired on both platforms. Microphone selection remains supported. |
| [Voice-control integration plan](iMuse%20voice-control%20integration%20plan.md) | Original proposed component/state separation and test gates; current owners and interfaces are in the voice-control guide. |
| [Comparison lab, 4 November](wake-word-comparison-lab-2026-11-04.html) | Still-available earlier review tool and its separate saved-review database; not an instruction to restart that experiment. |
| [Comparison lab review instructions](wake-word-review-notes-2026-11-04.md) | Companion instructions for opening/reviewing that retained tool's data. |

Removed during this review: `stage-1-checklist.md`, `stage-2-checklist.md`, `voice-command-stage-checklist.md` and `root-cleanup-checklist.md`. These were obsolete ZIP-installation/rollout instructions, not unique measured evidence. They described removed readiness/headset behavior, incomplete command integration, direct spoken Stop or already-completed file relocation. Current settings/voice behavior and regression checks replace them; Git history retains their contents.

Private audio/Desktop exports and old ZIPs may no longer be available. Current workspace source is authoritative. Keep the archived lab and its regression tests while it remains available; its **imuse-wake-review-lab** database is separate from production and the current lab. See [current wake evaluation](../wake-word-evaluation.md).
