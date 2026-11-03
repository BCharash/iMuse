# iMuse documentation

Updated 3 November 2026. Start here; current findings take precedence over older plans and journal entries.

| Document | Purpose |
| --- | --- |
| [Recording reliability](recording-investigation.md) | Current behavior, evidence, limitations and one manual acceptance checklist |
| [Regression tests](../tests/README.md) | One test command, suite purposes and testing limits |
| [Next steps](iMuse%20next%20steps.md) | Current priorities and remaining acceptance work; implementation versus testing status |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Record-to-Transcribe contract, source ownership, and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Conditional native alternative; not a decision to migrate or a claim of implemented native behavior |
| [Design journal](design-journal.md) | Chronological decisions; DJ013 records completed preservation work and current document ownership |
| [Archive index](Archive/README.md) | Superseded reviews, detailed earlier roadmap, installation checklists, and voice/headset experiments |

## Current checkpoint

The four recording-preservation stages and interface cleanup are implemented. The user reported Stage 2 and Stage 3 looked satisfactory and supplied browser-specific storage-protection results. Current dialog layout, long-recording and other acceptance limits are listed in the recording brief; this is not blanket device certification.

The iPhone installed-app background microphone failure remains unresolved; Safari-tab capture is the reported working route. The warning and temporary background labs are removed. No further preservation stage, native migration or speculative capture patch is underway. Automatic retries for memory-only emergency audio remain a possible separately approved improvement.

Two approved recorder refactoring steps move saved-list/player UI into `js/recording-library.js` and recording database I/O into `js/recording-store.js`. Capture, emergency memory, recovery decisions and finalization remain in `recorder.js`. The first step's device checks were reported successful; the second awaits focused device verification. Further extractions require separate approval.

## Document maintenance

Keep one authoritative home for each subject. Put new test results in the investigation, priorities in Next steps, and dated decisions in the journal. Link to these rather than duplicating their contents across handoffs. Keep Memora and Swift documents focused on their own contracts. Archive superseded plans with a visible status notice; historical imperative language is not a current instruction.

Use the current repository source when working in this workspace. Ask for uploads or external source only when the required files are unavailable or the deployed build cannot be identified. No documentation update itself authorizes deployment, a storage migration, or a native rewrite.
