# Older iMuse audio baseline

Prepared from Git revision `b9f3a87` (3 November 2026), matching the runtime in the user-supplied start-of-4-Nov ZIP. Intended address: https://bcharash.github.io/iMuse/test/ after publishing this directory through the existing Pages deployment.

Only `index.html`, `js/recording-store.js`, `js/settings.js` and `js/microphone-manager.js` differ from the archived production runtime: visible test label/no install-manifest link, separate recording database (including Storage Settings' direct opener), voice preferences and microphone preference. The writer-lock name derives from the renamed database. No capture, audio graph, command logic, WAV or playback sequencing is changed. `snapshot.json` records original/test SHA-256 values. Other old lab pages, unused documentation and development tests are omitted; local production runtime dependencies/assets are included.

This is path-level storage isolation, not a separate origin. Browser permissions, origin-wide storage quota/persistence and OS audio state remain shared. It does not clear, migrate or open the current production recording database/settings. Do not use browser Clear website data: that affects both apps. Do not record in current and old versions simultaneously. No service worker or installed-PWA experiment is introduced.

## iPhone check

1. Open the test URL in Safari, without Bluetooth and with other capture tabs closed.
2. Leave Audio commands off. Record briefly, then press Stop.
3. Report whether the stopped message reaches the loudspeaker, receiver, or is inaudible. Confirm the visible b9f3a87 test label.
4. Compare with current iMuse under the same conditions. Use disposable recordings only. Test-file Delete actions affect only the separate baseline database.

The baseline still loads the historical recognition resources. Network/model failure must not block its manual recording path. It intentionally uses the old Hey Doc model; the production Hey iMuse model remains unchanged.

If older playback works, compare intermediate complete revisions to locate the change. If it also fails, do not attribute the regression to the command refactor without additional evidence. Same-origin/OS session effects remain a limitation. Do not replace production files with this snapshot.

To remove the preview, remove only the `test/` directory and its file-map/documentation references. The current source/app must remain intact. Deleting files does not itself remove the separate browser test database.
