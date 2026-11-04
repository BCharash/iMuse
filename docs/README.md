# iMuse documentation

Updated 4 November 2026. Start here; current findings take precedence over older plans and journal entries.

| Document | Purpose |
| --- | --- |
| [Recording reliability](recording-investigation.md) | Current behavior, evidence, limitations and one manual acceptance checklist |
| [Wake-word and filename lab](wake-word-evaluation.md) | Reviewed archive findings, simple offline recorder, speech-gated wake detection, timed Whisper verification and filename suggestions |
| [Voice-control stabilization](voice-control-refactor.md) | Command controller, opt-in Advanced diagnostics, ownership and device acceptance |
| [Regression tests](../tests/README.md) | One test command, suite purposes and testing limits |
| [Next steps](iMuse%20next%20steps.md) | Current priorities and remaining acceptance work; implementation versus testing status |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Record-to-Transcribe contract, source ownership, and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Conditional native alternative; not a decision to migrate or a claim of implemented native behavior |
| [Design journal](design-journal.md) | Chronological decisions; DJ013 records completed preservation work and current document ownership |
| [Archive index](Archive/README.md) | Superseded reviews, detailed earlier roadmap, installation checklists, and voice/headset experiments |

## Current checkpoint

The four recording-preservation stages and interface cleanup are implemented. The user reported Stage 2 and Stage 3 looked satisfactory and supplied browser-specific storage-protection results. Current dialog layout, long-recording and other acceptance limits are listed in the recording brief; this is not blanket device certification.

The iPhone installed-app background microphone failure remains unresolved; Safari-tab capture is the reported working route. The warning and temporary background labs are removed. No further preservation stage, native migration or speculative capture patch is underway. Automatic retries for memory-only emergency audio remain a possible separately approved improvement.

Three approved refactoring steps move library/player UI, database I/O and recovery/finalization into `js/recording-library.js`, `js/recording-store.js` and `js/recording-recovery.js`. The recorder retains capture, pending writes, wake/silence analysis and lease/microphone cleanup. The user reported the third extraction and Discard correction worked on iPhone. A subsequent approved cleanup removes unused helpers without changing live logic or adding a module. The separately approved command-controller extraction now moves Go/Stop/Yes/No coordination and command state to `js/voice-controller.js`; 43 tests pass; intermittent unsolicited Stop confirmations are under investigation with opt-in Advanced diagnostics. MacBook/iPhone acceptance remains pending. Wake detection remains in the recorder. See the [voice-control plan](voice-control-refactor.md).

## Document maintenance

Command-controller extraction is implemented. User-approved opt-in voice diagnostics now live under collapsed Settings → Advanced; further extraction is paused while intermittent Stop confirmations are investigated. One passive RMS dBFS needle meter above the Settings thresholds provides optional measured Quiet/Noisy room references. It observes existing input only; wake gating/model behavior is unchanged. See the recording brief for the evaluation procedure.

Keep one authoritative home for each subject. Put new test results in the investigation, priorities in Next steps, and dated decisions in the journal. Link to these rather than duplicating their contents across handoffs. Keep Memora and Swift documents focused on their own contracts. Archive superseded plans with a visible status notice; historical imperative language is not a current instruction.

Use the current repository source when working in this workspace. Ask for uploads or external source only when the required files are unavailable or the deployed build cannot be identified. No documentation update itself authorizes deployment, a storage migration, or a native rewrite.
