# Vibe Visualizer — Tech Stack

> **Status:** v0.3 (2026-09-25), accepted (Q16). It builds on the decisions in [FEATURES.md](FEATURES.md#8-decision-log): video production first, files up to 3 h, desktop first, MP4 export. The P0 spikes passed on the main target machine (see [§5](#5-spikes-p0)).

## 1. The stack at a glance

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript 6.0, strict mode | Type safety across audio, rendering and UI. TypeScript 7 (the new native compiler) follows once svelte-check and typescript-eslint support it |
| Build & dev server | Vite 8 | Fast dev server with hot reload (shaders included); first-class support for workers and WebAssembly |
| UI framework | Svelte 5 | Fine-grained reactivity: many live-updating controls (meters, playhead, sliders) without re-render overhead; little boilerplate |
| UI building blocks | bits-ui (headless components) + own CSS with design tokens | Accessible dialogs, menus and sliders; the look stays fully ours |
| Graphics | WebGL2 with GLSL shaders, own thin renderer | Works in every desktop browser and inside workers (OffscreenCanvas); float render targets for smooth HD feedback; huge pool of shader know-how (Shadertoy) |
| Audio engine | Own streaming engine: a DSP core in TypeScript that runs in an AudioWorklet (live) and in a worker (export) | The export sounds exactly like the preview; 3-hour files stream instead of filling the RAM; sample-accurate cues |
| Time-stretching (key lock) | Signalsmith Stretch (MIT) as WebAssembly | High quality, permissive licence. A Vite plugin extracts the WASM core from the npm package; our thin binding runs it in the AudioWorklet and in workers, with seeded randomness for bit-identical output |
| Decoding & file writing | Mediabunny (MPL-2.0) on top of WebCodecs | Reads MP3, M4A, Ogg, FLAC and WAV in pieces with fast seeking; the same library writes the MP4 |
| Tags & cover art | Mediabunny (`getMetadataTags`) | Title, artist, album, BPM and cover art for MP3, MP4, FLAC, Ogg and WAV; a separate tag library is not needed |
| Video/audio encoding | WebCodecs, hardware-accelerated where available; `@mediabunny/aac-encoder` (WebAssembly) as AAC fallback | Fast and native; no 30 MB ffmpeg.wasm download |
| Thread communication | SharedArrayBuffer ring buffers for realtime data; a small RPC helper for control calls | No memory allocation on the audio thread, so no crackles. The spikes use a 100-line helper; whether Comlink is worth it is decided in P1 |
| Storage | IndexedDB (via `idb`) for settings, presets, cues and file handles; Origin Private File System for caches and render segments | Persistent, large, usable from workers |
| Validation | Zod 4 | Checks imported preset and project files; TypeScript types come from the schemas |
| FFT | fft.js (MIT) | Fast radix-4 FFT in plain JS; easy to replace |
| Tests | Vitest 5 (unit and DSP golden tests; browser mode for WebGL and WebCodecs), Playwright (end-to-end) | Shares Vite's config; GPU and codec tests run in real Chromium |
| Lint & format | ESLint with typescript-eslint and eslint-plugin-svelte; Prettier | Standard for Svelte + TypeScript |
| Tooling | pnpm, Node 24 LTS (CI) | Fast, strict installs; locally Node 22.13 or newer works |
| CI | GitHub Actions | Type check, lint, tests, build and an end-to-end smoke test on every push |
| Hosting | Cloudflare Pages (static, free) | Preview deploy per branch; can send the COOP/COEP headers that SharedArrayBuffer requires (GitHub Pages can't) |

**Licences:** all dependencies are MIT, ISC, Apache-2.0 or MPL-2.0 (Mediabunny). The optional AAC fallback contains FFmpeg's AAC encoder (LGPL) as a separate WebAssembly module. No GPL code.

## 2. Architecture sketch

**Principle: one core, two clocks.** The same decode, DSP, analysis and render code runs live (driven by the audio clock) and in the export (driven by a virtual frame clock). That's what makes the export look and sound exactly like the preview.

```
LIVE
file ─► media worker ─► AudioWorklet ────────────────────► speakers
        (decode,        (DSP core)
         prefetch)          │
                            ▼
                     analysis worker ─► render worker ─► screen
                     (features)         (WebGL2, audible time)

EXPORT (workers, virtual clock)
file ─► decode ─► DSP core ─► AAC encoder ──────────┐
                     │                              ▼
                     ▼                           muxer ─► segments (OPFS) ─► MP4 file
                  analysis ─► renderer ─► H.264 ────┘
                              (t = n/fps)  encoder
```

**Live**

1. **Media worker:** reads the file in pieces and decodes it (Mediabunny + WebCodecs). It stays a few seconds ahead of playback and keeps a short cache at every hot cue for instant jumps.
2. **AudioWorklet:** runs the DSP core (vinyl or key lock → DJ filter → delay → reverb → limiter) and plays the result.
3. **Analysis worker:** turns the output into a feature timeline (spectrum, band energies, onsets, beat phase). It works at a fixed rate that does not depend on the display frame rate.
4. **Render worker:** WebGL2 on an OffscreenCanvas. Every display frame reads the features at the moment you actually hear (latency-compensated, AN-06).
5. **Main thread:** Svelte UI and app state only, so UI work never makes audio or visuals stutter.

Realtime data moves through SharedArrayBuffer ring buffers; control commands go through Comlink.

**Export**

1. The same decode → DSP → analysis code processes the chosen range in chunks, faster or slower than real time.
2. The renderer draws frame n at time n / fps. WebCodecs encodes the video (H.264) and audio (AAC), and Mediabunny puts both into the MP4.
3. Long renders are written as segments to the Origin Private File System. After an interruption the render resumes at the last complete segment. At the end the segments are joined without re-encoding and streamed into the MP4 file on disk.

## 3. Key decisions and alternatives

| Decision | Chosen | Alternatives and why not |
|---|---|---|
| Audio engine | Own streaming engine with a DSP core | `<audio>` element + Web Audio nodes is the simplest option. But its time-stretching cannot run offline, so the export would sound different, cue jumps are less precise, and the export would need a second code path. OfflineAudioContext keeps the whole output in memory (≈4 GB for 3 h) and does not run in workers |
| Graphics API | WebGL2 | WebGPU brings compute shaders, but is not yet available on every desktop browser/OS combination. The renderer stays thin, so a WebGPU backend can be added later. Three.js helps with 3D scenes, but most of our visuals are full-screen shader passes with feedback, where it adds little |
| UI framework | Svelte 5 | React 19 has the bigger ecosystem, but frequent UI updates need workarounds. Solid is similar to Svelte with a smaller ecosystem. Engine and UI are separate, so this choice only affects the UI layer |
| Encoding | WebCodecs | ffmpeg.wasm is flexible, but software-only (slow for 4K or 3 h), a ~30 MB download, and GPL-licensed in common builds |
| Reverb | Algorithmic reverb (feedback delay network) in the DSP core | The browser's ConvolverNode cannot be used inside our worker-based core. Convolution with your own impulse responses can follow later (FX-07) |
| Hosting | Cloudflare Pages | GitHub Pages cannot set COOP/COEP headers (only via a service-worker workaround). Netlify would work equally well |

## 4. Project layout

```
src/
  core/          framework-free TypeScript
    audio/       ring buffer, Signalsmith Stretch binding, rate player, test signal
    env/         capability probe
    util/        worker RPC, hashing, formatting
    video/       test pattern
  spikes/        Spike Lab and the P0 prototypes (throwaway)
vite-plugins/    extraction of the Signalsmith Stretch WASM core
tests/e2e/       Playwright tests
docs/            FEATURES.md, TECH-STACK.md
```

From P1 on, `src/core/` grows the planned modules (`analysis/`, `render/`, `export/`, `state/`) and `src/ui/` holds the Svelte app. `core/` does not depend on the UI framework.

## 5. Spikes (P0)

Before P1 we test the risky parts in small throwaway prototypes. They live in the Spike Lab (the app's start page for now) and report pass/fail per criterion:

| Spike | Question | Passes when |
|---|---|---|
| S1 Streaming audio | Can we play a 3-hour MP3/FLAC/M4A smoothly while streaming it? | Under 300 MB RAM; cue jumps under 50 ms; gapless (encoder padding trimmed) |
| S2 Key lock | Does Signalsmith Stretch run in our AudioWorklet and in a worker? | Clean sound at 0.5–1.5×; under 10 % of one CPU core; identical output live and offline |
| S3 Encoding | Do H.264 + AAC via WebCodecs work on your machine (1080p60, 4K30, 1080×1920)? | 1080p encodes faster than real time; the AAC fallback works; the file uploads fine to YouTube and TikTok |
| S4 Rendering | Does WebGL2 in a worker handle float feedback and bloom? | 1080p60 live on integrated graphics; 4K offline without errors |
| S5 Long render | Does a 3-hour dummy export with segments work? | Valid output file; resumes after the tab was killed; segments joined without re-encoding |

**Results on the main target** (Chrome 153 on macOS, Apple M3, 16 GB RAM, 2026-09-25): all measured criteria met.

| Spike | Result | Key numbers |
|---|---|---|
| S1 Streaming audio | pass | 1-hour MP3: 71.5 MB for page and workers; start 8 ms; cue jumps 5 ms; seeks without cache 13 ms; 0 dropouts; full decode 515× real time (3 hours in about 21 s); decoded length exact |
| S2 Key lock | pass (listening test open) | 0.9 % of one CPU core at 0.5–1.5×; bit-identical output in AudioWorklet and worker |
| S3 Encoding | pass (upload test open) | Hardware H.264: 1080p60 at 177 fps (2.9× real time), 4K30 at 53 fps (1.8×), 1080×1920 at 186 fps (6.2×); native AAC 154×, WebAssembly fallback 16× |
| S4 Rendering | pass | 1080p live at 59.7 fps (1 % low 39 fps); 4K offline at 117 fps; float render targets available |
| S5 Long render | pass | 3-hour export: 18 segments, 21,600 of 21,600 frames, audio 10,800.06 s; resumed 8 times; joined in 19 s |

What this means:

- **The stack carries.** Every risky part works on the main target, with a lot of headroom.
- **Export time**, estimated with the prototype scene; the encoder is the bottleneck. One hour at 1080p60 takes about 20–25 minutes, one hour at 4K30 about 35–40 minutes, and a 60-second TikTok clip about 10–15 seconds.
- **A/V sync (AN-06):** Chrome on macOS reports an output latency of 0 ms, so the offset cannot be detected automatically there. P1 needs a calibration step.
- **Frame pacing:** the 1 % low of 39 fps in the live test probably comes from shader warm-up in the first frames. P1 measures it without the warm-up.

The development container (headless Chromium, software GPU) and CI run all five spikes on every push; their frame rates and encoder speeds are not meaningful.

## 6. Open points

- Manual checks: listening test at 0.5–1.5× (S2) and uploading the sample MP4 to YouTube and TikTok (S3).
- Second-priority machines (Q14): Chrome on Windows and Firefox on Linux. A hosted preview makes this easiest.
- Hosting needs a (free) Cloudflare account.
