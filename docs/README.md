# iMuse documentation

Updated 5 November 2026. Start here; current findings take precedence over older plans and journal entries.

| Document | Purpose |
| --- | --- |
| [Recording reliability](recording-investigation.md) | Current behavior, evidence, limitations and one manual acceptance checklist |
| [Wake-word and filename lab](wake-word-evaluation.md) | Wake evidence, current lab use and why live Whisper verification was rejected |
| [Voice control](voice-control-refactor.md) | Accepted wake refactor/race fixes, command ownership, Settings, diagnostics and regression checks |
| [Regression tests](../tests/README.md) | One test command, suite purposes and testing limits |
| [Build identification](build-versioning.md) | Production numbering convention, runtime display, diagnostic metadata and caching limits |
| [Next steps](iMuse%20next%20steps.md) | Current priorities and remaining acceptance work; implementation versus testing status |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Record-to-Transcribe contract, source ownership, and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Conditional native recorder/transcription scope, feasibility gates and recording priority |
| [Design journal](design-journal.md) | Historical decisions; DJ026 records the accepted wake refactor and documentation cleanup |
| [Archive index](Archive/README.md) | Superseded reviews, detailed earlier roadmap, installation checklists, and voice/headset experiments |

## Current checkpoint

Build **2026-11-05.4** adds download-only filename editing with a fixed local start-time prefix and an editable description. Saved-list titles are unchanged; Whisper naming and a broader file-save workflow remain future work. Automated validation passes 93 methods across fourteen suites; browser/device download acceptance remains pending. See [download naming](recording-investigation.md#download-naming).

Recording preservation's four stages, library/store/recovery extractions, command-controller extraction, Advanced diagnostics and the temporary microphone check/countdown are implemented. The user reported the microphone check/countdown and earlier preservation/refactoring checks worked. The latest automated checkpoint is **89 tests across thirteen suites**, including 26 wake-detector methods and build-identity coverage; full device acceptance remains bounded by the recording brief.

Production build identification uses **YYYY-MM-DD.N**, starting at **2026-11-05.1**, below the Settings selector rectangle and in voice/recording diagnostic exports. The [build guide](build-versioning.md) defines when to increment it and why this display does not certify cache consistency across all assets.

Readable diagnostics helped the user raise command thresholds after observing intended Go/Stop scores at least 0.90 and unintended scores at most 0.88. This is limited tuning evidence, not proof that intermittent false recognition is resolved. Preserve the user's settings.

**Accepted checkpoint: production build 2026-11-05.3.** The user tested the wake refactor and separately approved [race corrections](voice-control-refactor.md#wake-race-corrections), reported they worked as expected and called the work a success. Device/browser and individual test scenarios were not specified. Model loading/inference routing are extracted; outdated load/inference/timer callbacks are rejected and the latest threshold is applied at readiness. Audio ownership, DSP, models, cadence and threshold values are preserved. Detailed intermediate history is [archived](Archive/voice-control-history-2026-11-05.md).

The next discussed assessment is conventional asset fingerprinting/build automation, with readable source filenames and generated deployment assets; it is not implemented. The [active queue](iMuse%20next%20steps.md) and [build guide](build-versioning.md) define that separate scope. Whisper stays out of the live wake path.

The iPhone installed-PWA capture failure remains unresolved; the Safari tab is the reported working web route. Native feasibility testing is deferred until a suitable cable is available. If native iMuse is chosen, the user wants transcription and multiple cached models while retaining Memora web and web iMuse for other platforms. Recording always takes priority over transcription/naming. These are future requirements, not implemented native features or a production scheduler. The native proposal owns that scope.

The user-approved grouped Settings launcher and temporary Audio commands Suspend/Resume control are implemented. The persisted Audio commands preference remains locked during recording. Suspension blocks voice actions and cancels pending command episodes without stopping capture; see the [voice-control plan](voice-control-refactor.md#temporary-suspension-and-grouped-settings) for semantics, tests and focused device acceptance. Silero remains a separate lab experiment.

## Document maintenance

Keep one authoritative home for each subject. Put new test results in the investigation, priorities in Next steps, and dated decisions in the journal. Link to these rather than duplicating their contents across handoffs. Keep Memora and Swift documents focused on their own contracts. Archive superseded plans with a visible status notice; historical imperative language is not a current instruction.

Use the current repository source when working in this workspace. Ask for uploads or external source only when the required files are unavailable or the deployed build cannot be identified. No documentation update itself authorizes deployment, a storage migration, or a native rewrite.
