# M4A container dependency

`mediabunny-1.65.2.mjs` is the **unchanged** `dist/bundles/mediabunny.min.mjs`
from [Mediabunny 1.65.2](https://www.npmjs.com/package/mediabunny/v/1.65.2).
License: Mozilla Public License 2.0; see `mediabunny-LICENSE`.
Source code: [upstream release](https://github.com/Vanilagy/mediabunny/tree/v1.65.2)
and [published source package](https://registry.npmjs.org/mediabunny/-/mediabunny-1.65.2.tgz).

Downloaded from that exact package. Package SHA-512 (hex):
`82866989bbe8ff986473fe7a595366f772278bea3b2b8cbc697036d1cfc137507e9b72f968741af0c4ef3be4b500f83f608f243082edad7e900aa52dc4b5bb6c`.

Only the Combine worker imports this bundle. It parses MP4/AAC and muxes encoded
AAC packets; it does not load models, request a microphone, decode to PCM, or
require WebCodecs encoding. No CDN request or package manager is needed at runtime.

API references: [encoded packet sinks](https://mediabunny.dev/guide/media-sinks),
[encoded audio sources](https://mediabunny.dev/api/EncodedAudioPacketSource),
[writing files](https://mediabunny.dev/guide/writing-media-files).
