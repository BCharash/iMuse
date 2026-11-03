# iMuse documentation

Updated 3 November 2026. Start here; current findings take precedence over older plans and journal entries.

| Document | Purpose |
| --- | --- |
| [Recording investigation](recording-investigation.md) | Authoritative environment matrix, background-capture evidence, current source observations, unresolved issues, and proposed experiment |
| [Next steps](iMuse%20next%20steps.md) | Current priorities and remaining acceptance work; implementation versus testing status |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Record-to-Transcribe contract, source ownership, and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Conditional native alternative; not a decision to migrate or a claim of implemented native behavior |
| [Design journal](design-journal.md) | Chronological history; DJ011 records the November background investigation and documentation consolidation |
| [Archive index](Archive/README.md) | Superseded reviews, detailed earlier roadmap, installation checklists, and voice/headset experiments |

## Current checkpoint

The interruption-warning playback, warning setting, WAV, and temporary background labs have been removed. On the user's iPhone, Safari-tab recording succeeds without the warning, whereas installed iMuse and an installed lab lose background capture with an external double beep. MacBook browser and installed-app tests succeed. The new capture-only installed lab also failed with the same beep, and its commit was reverted. Accepted microphone declaration and explicit audio-session selection provided no benefit. No iPhone standalone workaround is established. Continue web-first using the tested Safari-tab route while awaiting an iOS 27 comparison or new platform evidence; the minimal reproducer is recoverable from Git. Device tests and code inspection are recorded separately in the investigation.

Recording preservation Stage 2 now consolidates recovery controls and coordinates storage writers across tabs. The [investigation's Stage 2 checkpoint](recording-investigation.md#stage-2-one-recovery-interface-and-coordinated-storage-writes) records implementation limits and the device/browser acceptance steps. Stage 3 awaits separate approval.

## Document maintenance

Keep one authoritative home for each subject. Put new test results in the investigation, priorities in Next steps, and dated decisions in the journal. Link to these rather than duplicating their contents across handoffs. Keep Memora and Swift documents focused on their own contracts. Archive superseded plans with a visible status notice; historical imperative language is not a current instruction.

Use the current repository source when working in this workspace. Ask for uploads or external source only when the required files are unavailable or the deployed build cannot be identified. No documentation update itself authorizes deployment, a storage migration, or a native rewrite.
