# iMuse documentation

Updated 12 November 2026. Start here; current findings take precedence over older plans and journal entries.

Current candidate: **2026-11-13.5** prepares spoken prompts at startup for manual and voice controls, while skipping wake-model loading when Audio commands is off. Warm model reuse remains; enabled-model UI blocking is still open. See [voice control](voice-control-refactor.md) and [recording reliability](recording-investigation.md).

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

Production source: **2026-11-13.5**. Latest implementation validation: **117 methods across sixteen suites**.

- The main Audio commands button and Settings checkbox control one persisted preference, including during capture. Status below Microphone reports enabled with the selected phrase, or disabled. Temporary suspension is no longer a separate user function.
- Recording completion says Audio recording successful or unsuccessful. The current player is followed by Download and confirmed permanent Delete. Recovery warnings remain with recovery entries.
- Saved Recordings and Archived Recordings have independent View/Hide controls. Archive retains a recording; Unarchive preserves its original date/order. Delete permanently removes the selected recording after confirmation. Legacy Recently Deleted entries appear as archived without migration or audio deletion.
- Download gently pulses until a download is initiated. A cancelled filename dialog keeps the reminder. Download requested persists per recording; it does not prove the file reached Files successfully. The button remains usable for another download.
- All six prompts prepare at startup. Recognition models wait until Audio commands is enabled; ready models are reused. Enabled-model UI blocking remains open.
- Heed / Hey iMuse is first/default at 0.75, preserving saved tuning. Production Silero defaults to pause evaluation on and recording evaluation off.

Appending and automatic cleanup are deferred until phase-one acceptance. Appending will target the top saved recording and create a new combined recording while preserving originals; no append code is included here. See [Next steps](iMuse%20next%20steps.md).

## Reading order and evidence

Use Next steps for priorities, Recording reliability for preservation and device checks, Voice control for settings/ownership, and Wake evaluation for lab operation. Journal entries and Archive documents record dated evidence; their old defaults, test counts and implementation instructions are historical.

The intermittent startup menu issue was reported mainly after updates and is currently absent. Single-tap Chrome checks did not reproduce automatic closing. No menu suppression or cache reset is implemented. Installed-iPhone background capture remains a separate unresolved issue; earlier Safari-tab success does not certify every device or installed mode.

Routine screen-lock status text is hidden; screen-lock prevention remains active and capture/interruption notices remain available. Opening Saved or Archived Recordings silently rereads the list; the Refresh recordings button and routine refresh feedback are removed.

Filename entry uses 18 px text and prevents focus-driven scrolling. List actions are Download, Archive, Delete and Diagnostics; archived rows offer Unarchive/Delete. Diagnostics opens a Stop diagnostics dialog with View/Hide, Copy and Download of the same JSON snapshot. Mutation refreshes preserve a surviving visible row where possible; deliberate pinch zoom remains available. iPhone focus/keyboard behavior still needs device acceptance.
