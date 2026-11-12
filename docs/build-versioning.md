# Production build identification

Adopted 5 November 2026. Production builds use **`YYYY-MM-DD.N`**: the UTC date when preparing the release and a positive daily sequence beginning at `1`. For example, `2026-11-05.1`, `2026-11-05.2`, then `2026-11-06.1`. The sequence has no leading zeros and is not a semantic version, commit count or installation date.

`js/build-info.js` is the single source of the production identifier. Before publishing a changed production application, advance it once for that release. Several edits can belong to one unpublished candidate. A deployment retry of identical files keeps the identifier; a changed candidate needs a new one if the previous candidate was shared for testing. Documentation/tests-only changes do not require a new production number. Do not reuse an identifier for different released application contents. The standalone lab keeps its independent build sequence; matching dates/numbers do not imply matching releases.

The recorder displays **iMuse build …** below the Settings selector rectangle, outside the collapsible panels. The label is populated by the loaded application using the shared build module; HTML does not contain a second copy of the number. Until that code runs, it reads **Build not identified**.

Voice and saved-recording diagnostic exports include `appBuild`. This identifies the exporting page's loaded build module. For older saved recordings it does not identify the build that originally recorded them. Voice `diagnosticVersion` and `schemaVersion` remain separate identifiers for their existing purposes. No saved-session migration or browser-storage clearing is involved.

This display does not certify that every imported JavaScript module, stylesheet, model or external dependency belongs to the same revision. A cached build module can show an older identifier, and a mixed cache can contain other revisions. Asset versioning, cache consistency and deployment automation remain separate work; no automatic update/reload behavior is added here. When reporting a problem, include the displayed production build, page URL and device/browser.

## Asset fingerprinting direction — not implemented

After discussing cache mismatches, the user supported assessing a conventional build tool with generated content-fingerprinted assets. Human-edited files keep names such as `js/recorder.js`; the deployment output can use names such as `recorder-a81c42.js` with matching generated references. The discussed workflow is automatic build/publish after commit/push, with source maps for deployed debugging. This is a direction for assessment, not an installed toolchain or permission to change hosting settings.

First inventory all application/lab entry points, static and dynamic module imports, workers, CSS, prompts, model/runtime assets and external dependencies. Evaluate GitHub Pages base paths, old open pages and an update with an existing browser cache. A fingerprinted application must also handle files fetched by URL; copying them unchanged to an output directory does not version them. Pin external dependency versions as appropriate. Verify recording/playback, lab URLs, model/worker loading and storage continuity in the generated application before replacing deployment. Retaining older generated assets for open pages needs an explicit policy; fingerprinting alone does not make removed assets available.

This should be independent of the accepted **2026-11-05.3** wake checkpoint. Per-module runtime registration and a custom startup mismatch blocker were discussed but are not the selected direction. No release-folder tree, service worker, forced reload, browser-data clearing, package manager setup or deployment workflow is introduced by this documentation update. Assess Memora and other repositories individually after establishing a reusable pattern; their offline/model/worker paths need separate validation.

## Observed mixed-version test, 11 November 2026

During the temporary .6 stop-message substitution, the user saw the .6 build label but unmistakably heard the original stopped prompt. This did not establish that the substituted prompt mapping loaded. Speaker output also returned normally, but causation is unresolved. The swap was reverted; the experiment was reverted; current build identity is listed in the documentation index. Verify the relevant loaded module/assets before interpreting a future comparison; do not clear IndexedDB or site data to diagnose this. See the [observation checkpoint](recording-investigation.md#iphone-stop-announcement-output-regression).
