# Production build identification

Adopted 5 November 2026. Production builds use **`YYYY-MM-DD.N`**: the UTC date when preparing the release and a positive daily sequence beginning at `1`. For example, `2026-11-05.1`, `2026-11-05.2`, then `2026-11-06.1`. The sequence has no leading zeros and is not a semantic version, commit count or installation date.

`js/build-info.js` is the single source of the production identifier. Before publishing a changed production application, advance it once for that release. Several edits can belong to one unpublished candidate. A deployment retry of identical files keeps the identifier; a changed candidate needs a new one if the previous candidate was shared for testing. Documentation/tests-only changes do not require a new production number. Do not reuse an identifier for different released application contents. The standalone lab keeps its independent build sequence; matching dates/numbers do not imply matching releases.

The recorder displays **iMuse build …** below the Settings selector rectangle, outside the collapsible panels. The label is populated by the loaded application using the shared build module; HTML does not contain a second copy of the number. Until that code runs, it reads **Build not identified**.

Voice and saved-recording diagnostic exports include `appBuild`. This identifies the exporting page's loaded build module. For older saved recordings it does not identify the build that originally recorded them. Voice `diagnosticVersion` and `schemaVersion` remain separate identifiers for their existing purposes. No saved-session migration or browser-storage clearing is involved.

This display does not certify that every imported JavaScript module, stylesheet, model or external dependency belongs to the same revision. A cached build module can show an older identifier, and a mixed cache can contain other revisions. Asset versioning, cache consistency and deployment automation remain separate work; no automatic update/reload behavior is added here. When reporting a problem, include the displayed production build, page URL and device/browser.
