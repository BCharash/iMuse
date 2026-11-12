# iMuse documentation

Updated 12 November 2026. Start here; current findings take precedence over older plans and journal entries.

Current candidate: **2026-11-12.12** prepares spoken prompts at startup for manual and voice controls, while skipping wake-model loading when Audio commands is off. Warm model reuse remains; enabled-model UI blocking is still open. See [voice control](voice-control-refactor.md) and [recording reliability](recording-investigation.md).

| Document | Purpose |
| --- | --- |
| [Repository file map](../filemap.md) | Find every source file, model, test, asset and archived guide by folder or task |
| [Recording reliability](recording-investigation.md) | Current behavior, evidence, limitations and one manual acceptance checklist |
| [Wake-word and filename lab](wake-word-evaluation.md) | Wake evidence, current lab use and why live Whisper verification was rejected |
| [Voice control](voice-control-refactor.md) | Accepted wake refactor/race fixes, command ownership, Settings, diagnostics and regression checks |
| [Regression tests](../tests/README.md) | One test command, suite purposes and testing limits |
| [Build identification](build-versioning.md) | Production numbering convention, runtime display, diagnostic metadata and caching limits |
| [Next steps](iMuse%20next%20steps.md) | Current priorities and remaining acceptance work; implementation versus testing status |
| [Memora integration handoff](iMuse%20Memora%20integration%20handoff.md) | Record-to-Transcribe contract, source ownership, and integration boundaries |
| [Swift migration proposal](iMuse%20Swift%20migration%20plan.md) | Conditional native recorder/transcription scope, feasibility gates and recording priority |
| [Design journal](design-journal.md) | Historical decisions; DJ027 records download naming and the accepted retained-player download fix |
| [Archive index](Archive/README.md) | Superseded reviews, detailed earlier roadmap, installation checklists, and voice/headset experiments |

## Current checkpoint

Production source: **2026-11-12.12**. Latest implementation validation: **114 methods across sixteen suites**. This documentation review does not rerun runtime tests or change the production build.

- All six spoken prompts prepare at startup, including with Audio commands off. Buffered playback preserves complete prompts; the user confirmed the iPhone Yes/volume-preview correction. Other prompts still need device acceptance.
- Wake-model loading waits until Audio commands is enabled. Loading is guarded against duplicate requests; ready models are reused. Enabled-model startup can still interrupt screen interaction.
- Recording stopped confirms capture stopping independently of saving. The microphone remains through the announcement; New Recording waits for microphone release and storage ownership to finish.
- Heed / Hey iMuse is first and the initial default, with threshold 0.75. Existing saved preferences remain. Production Silero defaults to pause evaluation on and recording evaluation off.
- Download-only filename editing and retained current-player downloads are implemented. Native recording, production transcription, lab queue changes and asset/version-maintenance upgrades remain deferred.

## Reading order and evidence

Use Next steps for priorities, Recording reliability for preservation and device checks, Voice control for settings/ownership, and Wake evaluation for lab operation. Journal entries and Archive documents record dated evidence; their old defaults, test counts and implementation instructions are historical.

The intermittent startup menu issue was reported mainly after updates and is currently absent. Single-tap Chrome checks did not reproduce automatic closing. No menu suppression or cache reset is implemented. Installed-iPhone background capture remains a separate unresolved issue; earlier Safari-tab success does not certify every device or installed mode.
