# iMuse documentation

Updated 12 November 2026. Start here; current findings take precedence over older plans and journal entries.

Current candidate: **2026-11-12.7** changes stop-announcement timing and microphone release, and adds Audio Prompt Volume with a wider slider and delayed “Yes?” preview. Saving remains independent; iPhone acceptance is pending. See [recording reliability](recording-investigation.md).

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

**Current build 2026-11-12.5 — investigation cleanup.** The pre-refactor version reproduced the iPhone built-in-output failure. At the user’s request, remove the older preview/branch and unsuccessful playback-mode experiment; stop backward-version testing. Restore ordinary stop-prompt playback while retaining Heed, diagnostics and shutdown handling. The root cause remains unresolved. See the [negative result and retained behavior](recording-investigation.md#iphone-stop-announcement-output-regression).

**Candidate 2026-11-12.2:** Heed — Hey iMuse appears first in the wake-engine dropdown and is selected for initial load when no valid preference exists. Existing saved Heed/Voicute choices remain unchanged; Audio commands remains opt-in.

**Candidate 2026-11-12.1:** user-approved replacement of Heed Hey Doc weights/metadata with the user-trained medium Hey iMuse export. Production and current lab display Hey iMuse and default Heed to 0.75; existing saved settings remain unchanged. Every audio-control range slider shows its recommended starting value in parentheses. Voicute, capture, voice-command sequencing, Silero decisions, storage and queues are unchanged. Current lab cache advances to v2; historical Hey Doc evidence remains historical. All 106 regression methods pass. Isolated Chrome loaded/warmed the real ONNX model and exercised streaming inference, verified the 0.75 default/saved-value preservation, and checked all 13 slider annotations and lab defaults. Acoustic/device acceptance remains pending. See [model notes](../js/heed/README.md#hey-imuse-model-12-november-2026).

**Current checkpoint: production build 2026-11-11.5; observation period.** The user reports normal speaker playback has returned for the original iPhone stop message, without an established cause. The temporary .6 audio substitution and isolated output lab are reverted; current source uses the original stop WAV. Preserve the accepted diagnostics layout, Silero controls and shutdown-ordering correction. Do not treat spontaneous recovery as proof of a fix. See the [full evidence and exact resume instructions](recording-investigation.md#iphone-stop-announcement-output-regression). Last retained implementation validation: 106 methods across fifteen suites; this update changes documentation only.

**Settings usability candidate 2026-11-11.4:** the main Silero group sits below command recognition and contains only recording/pause switches and status. Threshold, minimum blocks and lookback are under Advanced voice settings. Each Silero control shows its recommended value in parentheses; no restore button is present. Diagnostics offers Show/Hide, Copy, Download and Clear, with explanations of recognition results and troubleshooting details.

**Production candidate 2026-11-11.1:** state-specific Silero speech checking is implemented, with pause on/recording off by default, a dedicated Settings group and advanced tuning. The warmed worker uses the existing microphone stream only in enabled states; it checks wake acceptance without changing Go/Stop/Yes/No or automatic silence pause. All 103 automated methods pass across fifteen suites; isolated Chrome exercised the real model, no-microphone preparation and responsive Settings. Device/acoustic acceptance is pending. See [production speech checking](voice-control-refactor.md#state-specific-silero-speech-checking).

**Current accepted download checkpoint: build 2026-11-05.6.** The user reported that the fix worked: the current player remains downloadable after permanent deletion of its saved recording. Download prompts offer a fixed local recording-start prefix and an editable description, initially `iMuse`. Naming applies to that download only. The current player retains its audio and default filename until cleared/replaced; no additional deletion message is shown. Saved-list titles are unchanged; Whisper naming and a broader file-save workflow remain future work. That download implementation checkpoint passed **94 methods across fourteen suites**. Device/browser details of the successful user check were not specified; it is not complete device acceptance. See [download naming](recording-investigation.md#download-naming).

Recording preservation's four stages, library/store/recovery extractions, command-controller extraction, Advanced diagnostics and the temporary microphone check/countdown are implemented. The user reported the microphone check/countdown and earlier preservation/refactoring checks worked. The latest automated checkpoint is **106 tests across fifteen suites**, including download behavior, 28 wake-detector methods and build-identity coverage; full device acceptance remains bounded by the recording brief.

Production build identification uses **YYYY-MM-DD.N**, starting at **2026-11-05.1**, below the Settings selector rectangle and in voice/recording diagnostic exports. The [build guide](build-versioning.md) defines when to increment it and why this display does not certify cache consistency across all assets.

Readable diagnostics helped the user raise command thresholds after observing intended Go/Stop scores at least 0.90 and unintended scores at most 0.88. This is limited tuning evidence, not proof that intermittent false recognition is resolved. Preserve the user's settings.

**Earlier accepted wake checkpoint: production build 2026-11-05.3.** The user tested the wake refactor and separately approved [race corrections](voice-control-refactor.md#wake-race-corrections), reported they worked as expected and called the work a success. Device/browser and individual test scenarios were not specified. Model loading/inference routing are extracted; outdated load/inference/timer callbacks are rejected and the latest threshold is applied at readiness. Audio ownership, DSP, models, cadence and threshold values are preserved. Detailed intermediate history is [archived](Archive/voice-control-history-2026-11-05.md).

Conventional asset fingerprinting/build automation, with readable source filenames and generated deployment assets, is deferred at the user’s request. Further live lab work is also deferred. The [active queue](iMuse%20next%20steps.md) and [build guide](build-versioning.md) define that separate scope. Whisper stays out of the live wake path.

The iPhone installed-PWA capture failure remains unresolved; the Safari tab is the reported working web route. Native feasibility testing is deferred until a suitable cable is available. If native iMuse is chosen, the user wants transcription and multiple cached models while retaining Memora web and web iMuse for other platforms. Recording always takes priority over transcription/naming. These are future requirements, not implemented native features or a production scheduler. The native proposal owns that scope.

The user-approved grouped Settings launcher and temporary Audio commands Suspend/Resume control are implemented. The persisted Audio commands preference remains locked during recording. Suspension blocks voice actions and cancels pending command episodes without stopping capture; see the [voice-control plan](voice-control-refactor.md#temporary-suspension-and-grouped-settings) for semantics, tests and focused device acceptance. The lab’s fresh-Silero comparison remains separate from the production continuous speech gate.

## Document maintenance

Keep one authoritative home for each subject. Put new test results in the investigation, priorities in Next steps, and dated decisions in the journal. Link to these rather than duplicating their contents across handoffs. Keep Memora and Swift documents focused on their own contracts. Archive superseded plans with a visible status notice; historical imperative language is not a current instruction.

Use the current repository source when working in this workspace. Ask for uploads or external source only when the required files are unavailable or the deployed build cannot be identified. No documentation update itself authorizes deployment, a storage migration, or a native rewrite.
