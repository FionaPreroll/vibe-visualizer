# Vibe Visualizer — Tech Stack

> **Status:** v0.7 (2026-09-29), accepted (Q16). It builds on the decisions in [FEATURES.md](FEATURES.md#8-decision-log): video production first, files up to 3 h, desktop first, MP4 export. The P0 spikes passed on the main target machine (see [§5](#5-spikes-p0)).

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
| Storage | localStorage for settings, presets, and each file's cues and markers; IndexedDB (a thin wrapper, no library needed) for the queue and its file handles; Origin Private File System for the analysis cache, images and render segments | Persistent, large, usable from workers; file handles can only be kept in IndexedDB |
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
file ─► media worker ────────► AudioWorklet ──────────────────────────► speakers
        (decode, convert to     tempo ─► filter ─┬─► delay ─► reverb ─► limiter
         48 kHz, prefetch)                       ▼
                                             analysis (fixed hop)
                                                 │ feature timeline (shared memory)
                                                 ▼
                                             renderer ─► screen
                                             (reads features at the audible time)

EXPORT (workers, virtual clock)
file ─► decode ─► tempo ─► filter ─┬─► delay ─► reverb ─► limiter ─► AAC encoder ─┐
                                   ▼                                              ▼
                               analysis ─► renderer ─► H.264 ───────────────► muxer ─► segments (OPFS) ─► MP4 file
                                           (t = n/fps)  encoder
```

**Live** (built in P1 M1 and M2; the sound chain in P3 M1)

1. **Media worker:** reads the file in pieces, decodes it (Mediabunny + WebCodecs) and converts it to the engine rate of 48 kHz with a windowed-sinc resampler. It stays a few seconds ahead of playback. Every seek starts a new ring "generation"; the AudioWorklet drops older audio within one render quantum. Gapless playback (P3 M2, PL-05): files are known by tokens, and the player answers, for the heard file, which one follows it. At the end of a file the stream waits for that answer and takes it when the ring is down to 1.5 s, so the queue can still change until then; the next file follows in the same generation, and the ring records where it starts (a ring of four boundaries, for short files). The worklet passes the boundaries as they are heard and publishes the position within the heard file and its token; the player follows that token. An answer that comes too late (the stream is already in the next file) makes the player restart the stream at the current position with the new plan. Play ranges (TR-09): each file is decoded only from its in to its out marker; at an out marker the stream holds back the last 10 ms and crosses them (equal power) into the start of what follows, and a start in the middle of the music fades in. The ring records the next file's own frame at the boundary, so the published position counts from its in marker. File ends join without a crossfade, as before.
2. **AudioWorklet:** plays the stream through the sound chain (below) and analyses the music at its new tempo, after the filter and before the delay: 64-band spectrum, six band energies, kick/snare/hi-hat hits, the beat (tempo, phase, confidence), loudness and an oscilloscope snapshot, about 94 times per second ([ANALYSIS.md](ANALYSIS.md)). Paused, the music stops but the effects' tails ring out, seeks still take effect and the analysis goes on. With live input (P5) it analyses its input instead: an audio input (getUserMedia with voice processing off) or tab/screen audio (getDisplayMedia) goes through an input gain into the worklet, and a monitor branch (off by default) plays it, without effects. The master volume is a gain node after the worklet.
3. **Feature timeline:** a shared-memory history of analysis frames with timestamps. The renderer looks up the frame for the moment you actually hear and interpolates between frames. That moment comes from the AudioContext's output timestamp, which includes the output latency the browser reports, minus the A/V sync offset (AN-06), which the user sets or calibrates for what the browser does not report (Bluetooth; Chrome on macOS reports 0 ms).
4. **Renderer:** WebGL2 in a render worker on an OffscreenCanvas (M2, M3), paced by the worker's own requestAnimationFrame. The worker keeps both visual modes as scenes and switches between them without losing their state. The Kaleidoscope's feedback runs in fixed steps of 1/60 s, interpolated for display, so it looks the same at any frame rate and in the export. The main thread sends the audio clock (output timestamp) four times a second; the worker extrapolates it, reads the feature timeline directly from shared memory and renders at the canvas's native resolution. With live input the music is heard directly, so the worker shows the newest analysis frame instead (never looking past it, so no hit is lost). Scenes draw into half-float buffers, then bloom and dithering. The analysis view (Canvas 2D, main thread) remains as a debug mode.
5. **Main thread:** Svelte UI and the app state; every command is a timestamped action (NF-08). The queue (entries, what is known about them, the file handles Chromium gives) is kept in IndexedDB (SRC-05).
6. **Track analysis** (P3 M2): a worker decodes each file of the queue at its own sample rate, one at a time and the playing one first. It builds the waveform of the timeline (200 columns per second: the peak and the lows, mids and highs, one byte each) and runs the analyzer to collect the onset features for the beat grid (AN-07, [ANALYSIS.md](ANALYSIS.md#4-beat-grid-for-files)). Both are stored in the Origin Private File System under the file's fingerprint (SHA-256 of its size and three 256 KB samples), so a known file is ready at once. The grid goes to the AudioWorklet by token and replaces the live beat tracking while that file plays; the export takes it along.

**Sound chain** (P3 M1, `core/audio/dsp/`): plain TypeScript, allocation-free after construction, run in 128-frame blocks in the AudioWorklet and in the export worker alike (EX-02).

- **Tempo stage:** pulls source frames as it needs them (from the ring live, from the decoder in the export). *Vinyl* resamples with a 32-tap Kaiser-windowed sinc at a variable rate; above 1× the kernel widens, which lowers its cutoff, so nothing aliases; speed changes glide within a block; at 1× on a whole frame it is a plain copy. *Key lock* feeds Signalsmith Stretch `rate × frames` input frames per block. Before it starts (a new stream after a seek, or a switch from vinyl), the stretcher is primed with the audio before the position (one analysis block plus one interval, silence before the start of the stream), so its output starts right at the position instead of its latency later. Mode switches fade out, continue at the same source position and fade in (about 5 ms each).
- **DJ filter:** a state-variable filter (topology-preserving, stable while the cutoff moves): low-pass from 20 kHz down to 150 Hz, high-pass from 20 Hz up to 6 kHz, resonance up to Q ≈ 4; around the centre it fades out, so passing through neutral is click-free.
- **Delay:** stereo lines of 2.7 s; the time in milliseconds or from the beat tempo (a note value, straight, dotted or triplet; the tempo comes from the analysis once it is confident); a new time crossfades to the new tap in 50 ms; tone filter and ping-pong in the feedback path.
- **Reverb:** pre-delay, four input all-passes, an 8-line feedback delay network with a Householder matrix, slowly modulated lines, damping of the highs in every line, decay gains from the decay time, sign patterns for stereo; the input is scaled with the decay, so short and long decays sound about equally loud.
- **Limiter:** 2 ms look-ahead (a sliding minimum of the required gain, averaged over the look-ahead), 100 ms release, ceiling −0.26 dBFS. It delays the output by 96 frames; the analysis timestamps and the published position account for it.
- All parameters glide (20–50 ms); a switched-off delay or reverb keeps ringing and goes idle once silent (also while paused). Pausing fades the music out over 5 ms and resuming fades it in; after a jump (a new stream) the old one plays on for 8 ms through the tempo stage and fades out under the new one. The published playback position is the one heard: the stretcher's latency and the limiter's look-ahead are subtracted, and a track counts as ended only when its last frame has been heard.
- **Tempo and the beat tracker:** when the speed changes, the worklet tells the beat tracker, which re-times its history as if it had been played at the new tempo, so the beat phase and the BPM follow at once.
- CPU (Node, one core): about 0.5 % clean, 3 % with a preset's reverb, 6 % with everything on and key lock.

Realtime data moves through SharedArrayBuffer ring buffers; control commands go through a small RPC helper. Data handed to workers or worklets must not live in deep Svelte state: its proxies cannot be cloned (`$state.raw` instead).

**Export** (built in P2; everything runs in one export worker, with its own OffscreenCanvas)

1. **Audio pass:** decodes the range with the same code as the media worker (shared decoder loop and resampler, so the samples are identical) and plays it through the same sound chain in the same blocks, with the analysis at the same place (EX-02). For a clip it starts up to 10 s (of output) early, so the analysis and the effects' tails have settled. The analyzer's frames are stored in a file (84 floats per frame, about 110 MB per hour; the waveform is left out). The range itself is encoded to AAC (Opus for WebM), exactly as long as the video. The plan counts output frames from the start of the processed stream: output frame o plays source frame `sourceStart + o × rate`, so a slowed-down track makes a longer video. Manifests of exports started before P3 M1 are upgraded on reading (clean sound, the same plan).
2. **Video pass:** the scene draws frame n at time n / fps (EX-01); for a clip it starts up to 3 s early, so trails and motion are already running. The stored analysis is replayed through a feature timeline and sampled with the same `FeatureSampler` as the live view, so every hit reaches the scene once. WebCodecs encodes H.264 (the level chosen per format; VP9 as the fallback) and Mediabunny writes it in segments of at most five minutes, at least three per export.
3. **Resume (EX-15):** a manifest in the Origin Private File System records the job and what is done; it is written to two files in turn, so a crash while writing leaves the other intact. After each segment the scene's state (feedback buffers read back from the GPU, followers, particles, random state) is saved. A resumed export restores it and continues bit-exactly: all video packets are identical to an uninterrupted export.
4. **Join:** the segments and the audio are copied into one MP4 (WebM with VP9) without re-encoding, straight into the file you picked (File System Access, Chromium; EX-07) or into browser storage for a download. A cancelled or failed join discards the half-written file.

The main thread only starts, pauses, resumes and cancels the worker, decodes the Logo Spectrum images (SVG needs the DOM) and keeps a screen wake lock (EX-06).

## 3. Key decisions and alternatives

| Decision | Chosen | Alternatives and why not |
|---|---|---|
| Audio engine | Own streaming engine with a DSP core | `<audio>` element + Web Audio nodes is the simplest option. But its time-stretching cannot run offline, so the export would sound different, cue jumps are less precise, and the export would need a second code path. OfflineAudioContext keeps the whole output in memory (≈4 GB for 3 h) and does not run in workers |
| Graphics API | WebGL2 | WebGPU brings compute shaders, but is not yet available on every desktop browser/OS combination. The renderer stays thin, so a WebGPU backend can be added later. Three.js helps with 3D scenes, but most of our visuals are full-screen shader passes with feedback, where it adds little |
| UI framework | Svelte 5 | React 19 has the bigger ecosystem, but frequent UI updates need workarounds. Solid is similar to Svelte with a smaller ecosystem. Engine and UI are separate, so this choice only affects the UI layer |
| Encoding | WebCodecs | ffmpeg.wasm is flexible, but software-only (slow for 4K or 3 h), a ~30 MB download, and GPL-licensed in common builds |
| Reverb | Algorithmic reverb (feedback delay network) in the DSP core | The browser's ConvolverNode cannot be used inside our worker-based core. Convolution with your own impulse responses can follow later (FX-07) |
| What the visuals react to | The music after the tempo and the filter, before the delay and the reverb | After all effects, echoes and reverb tails blur the onsets, and a synced delay would hear its own echoes when it looks for the tempo. Before the filter, a filter sweep would not show. AN-09 may make it a choice |
| Hosting | Cloudflare Pages | GitHub Pages cannot set COOP/COEP headers (only via a service-worker workaround). Netlify would work equally well |

## 4. Project layout

```
src/
  core/          framework-free TypeScript
    audio/       ring buffer, resampler, shared decoder loop, live input (audio inputs, screen-share
                 audio), rate player (spike), test signal, Signalsmith Stretch binding
      dsp/       sound chain: tempo stage, DJ filter, delay, reverb, limiter, sound settings and
                 presets
      engine/    media worker, engine AudioWorklet, AudioEngine facade
    analysis/    analyzer (FFT, bands), drum detection, beat tracker, beat grid for files,
                 waveform, feature layout, feature timeline; eval/ has the synthetic test mix and
                 the scoring (docs/ANALYSIS.md)
    library/     probe worker (tags, duration, cover art), fingerprints, track analysis worker
                 and its cache, folder reading, the stored queue
    render/      renderer facade and render worker (OffscreenCanvas, WebGL2), scenes (Logo
                 Spectrum; Kaleidoscope with Vortex and Crystal Mandala), spectrum shaping,
                 fixed-step feedback, post-processing (bloom, dithering), settings, parameter specs
                 and presets, image storage
    export/      export worker (audio pass, video pass, join), formats and presets, job plan,
                 stored analysis replay, job storage in the Origin Private File System, Exporter
                 facade
    player/      Player: connects the state with the engine; the play order (shuffle, repeat)
    state/       store with timestamped actions, app state, persistence
    env/, util/, video/
  ui/            Svelte app: shell, top bar, stage, analysis view, queue, sound, visuals and live
                 panels, transport with waveform and cues, detail waveform, export, A/V sync and
                 shortcut dialogs
  spikes/        Spike Lab and the P0 prototypes (throwaway)
vite-plugins/    extraction of the Signalsmith Stretch WASM core
tests/e2e/       Playwright tests
tests/eval/      evaluation on real recordings (optional dataset, see docs/ANALYSIS.md)
docs/            FEATURES.md, TECH-STACK.md, ANALYSIS.md
```

`core/` does not depend on the UI framework.

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

- Manual checks: the listening test (S2) passed with the test signal; loading files into the S2 player failed and is fixed. The S3 sample plays in sync in QuickTime; the YouTube/TikTok upload is still open.
- Second-priority machines (Q14): Chrome on Windows and Firefox on Linux. A hosted preview makes this easiest.
- Hosting needs a (free) Cloudflare account.
- Listening test of tempo and effects on the main machine: vinyl and key lock at 0.5–1.5×, the reverb's character, the delay in time with the beat, no clicks when changing anything.
- Export on the main machine: the tests cover both paths, VP9 + Opus (WebM) in the development container, which has no H.264 encoder, and H.264 + AAC (MP4) in CI. The render speed on Chrome/macOS and a YouTube/TikTok upload of an export are still to be checked.
