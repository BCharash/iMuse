# iMuse display font

Dancing Script variable font, bundled unchanged from the same Google Fonts
source used by Memora. Used at weight 400 for the tagline and 500 for the
flowing use suffix. Other interface text uses the existing system fonts.

- Source: https://github.com/google/fonts/tree/main/ofl/dancingscript
- Original filename: DancingScript[wght].ttf.
- License: SIL Open Font License 1.1; see OFL.txt.
- SHA-256: `21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c`.

css/style.css loads this local asset through @font-face. No Google Fonts CSS
or font request is needed. This removes that external font dependency; it does
not establish offline readiness for unrelated models or application assets.
