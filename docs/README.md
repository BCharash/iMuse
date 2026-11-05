# iMuse documentation

Updated 5 November 2026. Start here; current findings take precedence over older plans and journal entries.

| Document | Purpose |
| --- | --- |
| [Recording reliability](recording-investigation.md) | Current behavior, evidence, limitations and one manual acceptance checklist |
| [Wake-word and filename lab](wake-word-evaluation.md) | Wake evidence, current lab use and why live Whisper verification was rejected |
| [Voice-control stabilization](voice-control-refactor.md) | Command controller, 500-event Advanced diagnostics, ownership and device acceptance |
| [Regression tests](../tests/README.md) | One test command, suite purposes and testing limits |
| [Next steps](iMuse%20next%20steps.md) | Current priorities and remaining acceptance work; implementation versus testing status |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Record-to-Transcribe contract, source ownership, and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Conditional native recorder/transcription scope, feasibility gates and recording priority |
| [Design journal](design-journal.md) | Historical decisions; DJ025 records the latest roadmap and documentation checkpoint |
| [Archive index](Archive/README.md) | Superseded reviews, detailed earlier roadmap, installation checklists, and voice/headset experiments |

## Current checkpoint

Recording preservation's four stages, library/store/recovery extractions, command-controller extraction, Advanced diagnostics and the temporary microphone check/countdown are implemented. The user reported the microphone check/countdown and earlier preservation/refactoring checks worked. The latest automated checkpoint is **80 tests across thirteen suites**, including 18 wake-detector characterization/loader methods; full device acceptance remains bounded by the recording brief.

Readable diagnostics helped the user raise command thresholds after observing intended Go/Stop scores at least 0.90 and unintended scores at most 0.88. This is limited tuning evidence, not proof that intermittent false recognition is resolved. Preserve the user's settings.

**Wake-detector refactor:** the user-approved characterization and [first loader-only extraction](voice-control-refactor.md#loader-only-extraction) are complete. Inference routing remains in the recorder as the next separately reviewable step. Keep audio ownership, DSP, models, cadence and thresholds unchanged during extraction. Whisper stays out of the live wake path.

The iPhone installed-PWA capture failure remains unresolved; the Safari tab is the reported working web route. Native feasibility testing is deferred until a suitable cable is available. If native iMuse is chosen, the user wants transcription and multiple cached models while retaining Memora web and web iMuse for other platforms. Recording always takes priority over transcription/naming. These are future requirements, not implemented native features or a production scheduler. The native proposal owns that scope.

The user-approved grouped Settings launcher and temporary Audio commands Suspend/Resume control are implemented. The persisted Audio commands preference remains locked during recording. Suspension blocks voice actions and cancels pending command episodes without stopping capture; see the [voice-control plan](voice-control-refactor.md#temporary-suspension-and-grouped-settings) for semantics, tests and focused device acceptance. Silero remains a separate lab experiment.

## Document maintenance

Keep one authoritative home for each subject. Put new test results in the investigation, priorities in Next steps, and dated decisions in the journal. Link to these rather than duplicating their contents across handoffs. Keep Memora and Swift documents focused on their own contracts. Archive superseded plans with a visible status notice; historical imperative language is not a current instruction.

Use the current repository source when working in this workspace. Ask for uploads or external source only when the required files are unavailable or the deployed build cannot be identified. No documentation update itself authorizes deployment, a storage migration, or a native rewrite.
