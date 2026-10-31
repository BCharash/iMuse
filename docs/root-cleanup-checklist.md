# iMuse root cleanup — installation and deletion checklist

This ZIP contains **only the relocated laboratory files**, preserving their original filenames. Extract at the repository root.

New paths:
- `js/tensorflow/labs/iMuseCmd.html` — optional standalone Heed + TensorFlow diagnostic lab
- `js/tensorflow/labs/audio-worklet.js` — used only by that lab

The lab now imports the production Heed model from `js/heed/` and loads the existing `audio/yes.wav`. It requires an HTTP server (such as VS Code Live Server), not opening as a `file://` page.

After extracting and checking that the relocated lab loads, **delete these obsolete root-level files in GitHub Desktop / VS Code**:
- `iMuseCmd.html`
- `audio-worklet.js`
- `wakeword.js`
- `preprocessing.js`
- `filter-coeffs.js`
- `wake.onnx`
- `wake.json`

The five root-level Heed files are byte-for-byte identical to the corresponding files already in `js/heed/`. No production code uses their root-level paths.

**Do not delete** `index.html`, `manifest.json`, `favicon.ico`, `.gitignore`, `.gitattributes`, or the `css/`, `js/`, `audio/`, `icons/`, `docs/` directories. Keep `.git/` (Git repository metadata).

No production files were modified. The main iMuse app should behave identically. The optional laboratory should be opened at `/js/tensorflow/labs/iMuseCmd.html`.

Note: `docs/design-journal.md` mentions the old lab name but is not an active application import.
