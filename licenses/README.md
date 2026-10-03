# Licence texts of parts of others

The build lists the parts of others in the app, with their licences, in `licenses.json` and
`licenses.txt` (`vite-plugins/third-party-notices.ts`); the app shows them under
**Help → Licences**. Most packages ship their licence files, which are read from `node_modules`.
This folder holds the texts that do not come with a package, as their projects publish them:

| Folder | What | Taken from |
|---|---|---|
| `ffmpeg/` | FFmpeg, whose AAC encoder is compiled into `@mediabunny/aac-encoder` | `COPYING.LGPLv2.1` and `LICENSE.md` of https://github.com/FFmpeg/FFmpeg |
| `emscripten/` | Emscripten, the runtime of both WebAssembly modules | `LICENSE` of https://github.com/emscripten-core/emscripten |
| `musl/` | musl, the C library that comes with Emscripten | `system/lib/libc/musl/COPYRIGHT` of Emscripten |
| `fft.js/` | fft.js, whose package has its licence in its README | the "LICENSE" section of the package's `README.md` |
| `signalsmith-stretch/` | Signalsmith Stretch, whose package has no licence file | `LICENSE.txt` of https://github.com/Signalsmith-Audio/signalsmith-stretch |

Taken on 2026-10-03.
