# Vibe Visualizer — Tech Stack

> **Status:** v0.9 (2026-09-30), accepted (Q16). It builds on the decisions in [FEATURES.md](FEATURES.md#8-decision-log): video production first, files up to 3 h, desktop first, MP4 export. The P0 spikes passed on the main target machine (see [§5](#5-spikes-p0)).

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
| Decoding & file writing | Mediabunny (MPL-2.0) on top of WebCodecs | Reads MP3, M4A, Ogg, FLAC and WAV in pieces with fast seeking; the same library writes the MP4. Firefox reads the files in slices instead of streams: there, reading a second file failed while one played ("Error in input stream") |
| Tags & cover art | Mediabunny (`getMetadataTags`) | Title, artist, album, BPM and cover art for MP3, MP4, FLAC, Ogg and WAV; a separate tag library is not needed |
| Video/audio encoding | WebCodecs, hardware-accelerated where available; `@mediabunny/aac-encoder` (WebAssembly) as AAC fallback | Fast and native; no 30 MB ffmpeg.wasm download |
| Thread communication | SharedArrayBuffer ring buffers for realtime data; a small RPC helper for control calls | No memory allocation on the audio thread, so no crackles. The spikes use a 100-line helper; whether Comlink is worth it is decided in P1 |
| Storage | localStorage for settings, presets, and each file's cues, markers, tempo and grid correction; IndexedDB (a thin wrapper, no library needed) for the queue and its file handles; Origin Private File System for the analysis cache, images and render segments. A backup (UI-06) is one JSON file: the app's localStorage entries as stored, the images and, if chosen, the analysis cache (base64) | Persistent, large, usable from workers; file handles can only be kept in IndexedDB, so the queue cannot go into a backup |
| Fonts | Pacifico for the default logo; Montserrat, Bebas Neue, Playfair Display, Space Mono and Orbitron (with Pacifico) for the track overlay. All SIL Open Font License 1.1, from `@fontsource/*` | Bundled with the app, so no request goes to a font service (NF-01). The logo is drawn on a canvas from the app's name; the overlay's fonts load in the render and export workers when first used |
| In-app help | The user guide (`docs/USER-GUIDE.md`) imported as text, with a small Markdown renderer of our own | One text for GitHub and the app; it knows the few constructs the guide uses and escapes everything else |
| DJ controllers | Web MIDI, with our own library (`packages/dj-controllers`, a pnpm workspace package without dependencies) | A profile per controller as plain data; semantic events and lights, pickup. The mappings of Mixxx are GPL-licensed and serve only as a check |
| Validation | Zod 4 | Checks imported preset and project files; TypeScript types come from the schemas |
| FFT | fft.js (MIT) | Fast radix-4 FFT in plain JS; easy to replace |
| Tests | Vitest 5 (unit and DSP golden tests; browser mode for WebGL and WebCodecs), Playwright (end-to-end: all in Chromium, the main paths in Firefox; a soak test of the memory) | Shares Vite's config; GPU and codec tests run in real browsers |
| Lint & format | ESLint with typescript-eslint and eslint-plugin-svelte; Prettier | Standard for Svelte + TypeScript |
| Tooling | pnpm, Node 24 LTS (CI) | Fast, strict installs; locally Node 22.13 or newer works |
| CI | GitHub Actions | Type check, lint, unit and end-to-end tests for each pull request and after each merge to main, the main paths in Firefox in a job of their own (with a virtual display for WebGL, and a sound server, without which Firefox on Linux plays no sound); the README screenshots and the soak test when their workflows are run by hand |
| Hosting | Cloudflare Workers with static assets (free), built by Workers Builds | A Preview per branch; can send the COOP/COEP headers that SharedArrayBuffer requires (GitHub Pages can't) |

**Licences:** all dependencies are MIT, ISC, Apache-2.0 or MPL-2.0 (Mediabunny); the bundled fonts are under the SIL Open Font License 1.1. The optional AAC fallback contains FFmpeg's AAC encoder (LGPL) as a separate WebAssembly module. No GPL code.

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

1. **Media worker:** reads the file in pieces, decodes it (Mediabunny + WebCodecs) and converts it to the engine rate of 48 kHz with a windowed-sinc resampler. It stays a few seconds ahead of playback. Every seek starts a new ring "generation"; the AudioWorklet drops older audio within one render quantum. Each stream converts with a resampler of its own (they share the coefficient tables), so a stream replaced by a seek cannot disturb the new one. Gapless playback (P3 M2, PL-05): files are known by tokens, and the player answers, for the heard file, which one follows it. At the end of a file the stream waits for that answer and takes it when the ring is down to 1.5 s, so the queue can still change until then; the next file follows in the same generation, and the ring records where it starts (a ring of four boundaries, for short files). The worklet passes the boundaries as they are heard and publishes the position within the heard file and its token; the player follows that token. An answer that comes too late (the stream is already in the next file) makes the player restart the stream at the current position with the new plan. Play ranges (TR-09): each file is decoded only from its in to its out marker; at an out marker the stream holds back the last 10 ms and crosses them (equal power) into the start of what follows, and a start in the middle of the music fades in. The ring records the next file's own frame at the boundary, so the published position counts from its in marker. File ends join without a crossfade, as before. This joining is one module (`core/audio/stream-joiner.ts`), which the export uses too (P4).
2. **AudioWorklet:** plays the stream through the sound chain (below) and analyses the music at its new tempo, after the filter and before the delay: 64-band spectrum, six band energies, kick/snare/hi-hat hits, the beat (tempo, phase, confidence), loudness and an oscilloscope snapshot, about 94 times per second ([ANALYSIS.md](ANALYSIS.md)). Paused, the music stops but the effects' tails ring out, seeks still take effect and the analysis goes on. With live input (P5) it analyses its input instead: an audio input (getUserMedia with voice processing off) or tab/screen audio (getDisplayMedia) goes through an input gain into the worklet, and a monitor branch (off by default) plays it, without effects. The master volume is a gain node after the worklet.
3. **Feature timeline:** a shared-memory history of analysis frames with timestamps, and for each frame the file it comes from (the engine's token) and the second in it. The renderer looks up the frame for the moment you actually hear and interpolates between frames. That moment comes from the AudioContext's output timestamp, which includes the output latency the browser reports, minus the A/V sync offset (AN-06), which the user sets or calibrates for what the browser does not report (Bluetooth; Chrome on macOS reports 0 ms).
4. **Renderer:** WebGL2 in a render worker on an OffscreenCanvas (M2, M3), paced by the worker's own requestAnimationFrame. The worker keeps both visual modes as scenes and switches between them without losing their state. The Kaleidoscope's feedback runs in fixed steps of 1/60 s, interpolated for display, so it looks the same at any frame rate and in the export. The main thread sends the audio clock (output timestamp) four times a second; the worker extrapolates it, reads the feature timeline directly from shared memory and renders at the canvas's native resolution. With live input the music is heard directly, so the worker shows the newest analysis frame instead (never looking past it, so no hit is lost). Scenes draw into half-float buffers, then bloom and dithering. Over the picture comes the track overlay (LS-18, LS-19): the main thread sends the tracks of the heard and the next file by token, and the worker shows the one the music heard comes from, at its position there, so the text and the cover art (LS-15) change exactly with the music, also at a gapless transition. The overlay's text is drawn with a 2D OffscreenCanvas into a texture, anew only when it changes (the time once a second); the filled part of the progress bar is drawn by its shader. A picture of the stage (EX-10) is copied with `createImageBitmap` from the frame just drawn, while it is still in the drawing buffer, scaled and encoded as a PNG in the worker. The logo turns like a record (LS-16) by the seconds of music played since the last frame, which the worker takes from the position heard: the tempo while it moves on, nothing once it stood still for 50 ms, the steps of the jog wheel while scrubbing, and the tempo across a seek; exports turn by the tempo per frame. Until how loud a file gets is known (its analysis runs, AN-05), the main thread marks it calm for the worker, and the Logo Spectrum's picture stays still (no shake, no zoom or pulse on the bass); it eases back in within about a second. The Kaleidoscope behind the Logo Spectrum (VE-08) draws with the Logo Spectrum's own look for it, through that mode's switching and morphs, else with the Kaleidoscope mode's look. The analysis view (Canvas 2D, main thread) remains as a debug mode.
5. **Main thread:** Svelte UI and the app state; every command is a timestamped action (NF-08). The queue (entries, what is known about them, the file handles Chromium gives) is kept in IndexedDB (SRC-05).
6. **Track analysis** (P3 M2): a worker decodes each file of the queue at its own sample rate, one at a time and the playing one first. It builds the waveform of the timeline (200 columns per second: the peak and the lows, mids and highs, one byte each) and runs the analyzer to collect the onset features for the beat grid (AN-07, [ANALYSIS.md](ANALYSIS.md#4-beat-grid-for-files)): per frame the onset strength, the accent, the kick and snare rises, and every four frames a coarse spectrum for the bars (AN-11). Waveform and grid (beats, confidence, position in the bar, the tempo the user gave, TMP-06, and the tempo range, AN-12), with how loud the track gets (AN-05: for the loudest spectrum band, the energy and each band, the level 95 % of the frames with sound stay below), are stored in the Origin Private File System under the file's fingerprint (SHA-256 of its size and three 256 KB samples), so a known file is ready at once. The features of recent tracks stay in the worker's memory (up to 64 MB), so a corrected tempo or another tempo range gives a new grid without decoding again. The user's correction of a grid (TR-11: a shift and a downbeat time) is kept with the file's cues and applied on the main thread, so the engine, the waveforms, snapping and the export all get the corrected grid. The grid and the loudness go to the AudioWorklet by token: while that file plays, the grid replaces the live beat tracking and the loudness keeps the auto-gain at or above the track's levels; the export takes both along. The waveform is drawn in one of two styles (TR-10): three bands as layers, each scaled to its own 98th percentile in the track, or one shape coloured by the bands.

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

1. **Audio pass:** decodes the range with the same code as the media worker (shared decoder loop and resampler, so the samples are identical) and plays it through the same sound chain in the same blocks, with the analysis at the same place (EX-02). For a clip it starts up to 10 s (of output) early, so the analysis and the effects' tails have settled. The analyzer's frames are stored in a file (84 floats per frame, about 110 MB per hour; the waveform is left out). The range itself is encoded to AAC (Opus for WebM), exactly as long as the video. The plan counts output frames from the start of the processed stream: output frame o plays source frame `sourceStart + o × rate`, so a slowed-down track makes a longer video. Manifests of older exports are upgraded on reading (before P3 M1: clean sound, the same plan; before P4 Videos B: one part).
   A video of several tracks (EX-05) is a list of parts, each a range of its file (between its markers). The audio pass decodes them one after the other and joins them with the media worker's joiner, so the export hears the queue as the player plays it (gapless; 10 ms crossfades where a part stops at its out marker). The plan treats the parts as one range of the first file that is as long as all of them, so pre-rolls, segments and resuming work as for one track; the audio pass records the stream frame at which each part starts, and the manifest keeps those starts. Each part has its own beat grid. The fades (EX-16) shape the encoded sound along a smoothstep curve; the analysis hears the music without them.
2. **Video pass:** the scene draws frame n at time n / fps (EX-01); for a clip it starts up to 3 s early, so trails and motion are already running. From the parts' starts it knows the part heard at frame n and the position in its file: the track overlay is drawn over the scene for that part and position, and the Logo Spectrum shows that part's cover art (LS-15). The overlay keeps no state, so a resumed export needs nothing of it but its settings; the covers are stored with the job like the other images. Last comes the fade, which darkens the whole picture (the overlay too) by blending with a constant alpha. The stored analysis is replayed through a feature timeline and sampled with the same `FeatureSampler` as the live view, so every hit reaches the scene once. WebCodecs encodes H.264 (the level chosen per format; VP9 as the fallback) and Mediabunny writes it in segments of at most five minutes, at least three per export. The chapters for YouTube (EX-14) come from the parts' starts at the tempo, at the nearest second.
3. **Resume (EX-15):** a manifest in the Origin Private File System records the job and what is done; it is written to two files in turn, so a crash while writing leaves the other intact. After each segment the scene's state (feedback buffers read back from the GPU, followers, particles, random state) is saved. A resumed export restores it and continues bit-exactly: all video packets are identical to an uninterrupted export.
4. **Join:** the segments and the audio are copied into one MP4 (WebM with VP9) without re-encoding, straight into the file you picked (File System Access, Chromium; EX-07) or into browser storage for a download. A cancelled or failed join discards the half-written file.
5. **Batches (EX-09):** a video of each track is a series of exports, one job after the other, run by the main thread's `Exporter`. In Chromium each video goes into a new file of the folder you picked; elsewhere into a directory beside the job's (`export-videos`), which the next job does not clear, and which the next export deletes. The batch itself lives in memory: it continues after a failed video is resumed, but not after a reload.

The main thread only starts, pauses, resumes and cancels the worker, decodes the Logo Spectrum images (SVG needs the DOM) and keeps a screen wake lock (EX-06).

**Robustness** (v1.0 stabilization: NF-09, NF-10, NF-02)

- **Lost graphics context:** the render worker reports it, and the stage starts a new worker on a new canvas a second later; the code that starts it sends everything anew (settings, images, covers, tracks). Three times a minute at most, then it waits for "Try again". A frame or a start that fails counts the same; an error of a single message is only reported. In the export, the video pass starts again in a new context from its last finished segment, as a resume does; it gives up after four losses without a segment finished in between. The context is checked again before a segment is finished.
- **Audio:** the worklet catches errors of a block (which stays silent) and of a message, and reports them once a second at most. The engine listens for `processorerror`, for the context's `error` event (Chromium: the device failed) and for its state (`suspended`, Safari's `interrupted`) while the music should play; the player then pauses and says why. The sound chain takes new settings only once it could read them whole.
- **At the start:** `core/env/requirements.ts` checks SharedArrayBuffer with cross-origin isolation, AudioWorklet, OffscreenCanvas and WebGL 2 (tried on a small OffscreenCanvas) before the app mounts; a page says what is missing.
- **Errors nobody handled:** `ui/problems.ts` listens for `error` and `unhandledrejection` from the first moment (`main.ts`) and shows them with details to copy and a mail link. Svelte boundaries (`ui/Guard.svelte`) keep an error of the stage, the side panel, the waveform or the transport bar in that part.
- **Storage:** `navigator.storage.persist()`, once a session, at the first image of the user's own or the start of an export (Firefox asks the user, so not at the start). A failed write of the settings is reported once.
- **System check:** the help shows what the browser offers the app (graphics, the encoders, storage), from `core/env/capabilities.ts`, with a report to copy for a bug report.
- **Content security policy:** `public/_headers` allows only what the app itself loads, its WebAssembly, and `blob:`/`data:` for the user's files and images, and for the worker of the AAC encoder that exports use where the browser has none (Firefox, Chromium on Linux). The preview server sends the same headers, so the e2e tests run with them.
- **Updates:** `vite-plugins/build-info.ts` names and versions each build (`__BUILD_ID__`, `__APP_VERSION__`) and writes both to `version.json`. The version is 0.9, then the day and the time of the build in UTC (`0.9.20261003.1432`): something to show and report until v1.0 is settled after the first feedback; the notice of a new version says from which to which. A tab compares the two when it is shown again and every half hour, and when the export's worker cannot start: a tab from before a deploy may no longer find the files of the workers it loads late.

## 3. Key decisions and alternatives

| Decision | Chosen | Alternatives and why not |
|---|---|---|
| Audio engine | Own streaming engine with a DSP core | `<audio>` element + Web Audio nodes is the simplest option. But its time-stretching cannot run offline, so the export would sound different, cue jumps are less precise, and the export would need a second code path. OfflineAudioContext keeps the whole output in memory (≈4 GB for 3 h) and does not run in workers |
| Graphics API | WebGL2 | WebGPU brings compute shaders, but is not yet available on every desktop browser/OS combination. The renderer stays thin, so a WebGPU backend can be added later. Three.js helps with 3D scenes, but most of our visuals are full-screen shader passes with feedback, where it adds little |
| UI framework | Svelte 5 | React 19 has the bigger ecosystem, but frequent UI updates need workarounds. Solid is similar to Svelte with a smaller ecosystem. Engine and UI are separate, so this choice only affects the UI layer |
| Encoding | WebCodecs | ffmpeg.wasm is flexible, but software-only (slow for 4K or 3 h), a ~30 MB download, and GPL-licensed in common builds |
| Reverb | Algorithmic reverb (feedback delay network) in the DSP core | The browser's ConvolverNode cannot be used inside our worker-based core. Convolution with your own impulse responses can follow later (FX-07) |
| What the visuals react to | The music after the tempo and the filter, before the delay and the reverb | After all effects, echoes and reverb tails blur the onsets, and a synced delay would hear its own echoes when it looks for the tempo. Before the filter, a filter sweep would not show. AN-09 may make it a choice |
| Hosting | Cloudflare Workers (static assets) | Cloudflare Pages works the same way (the same `_headers` file), but new projects go to Workers. GitHub Pages cannot set COOP/COEP headers (only via a service-worker workaround). Netlify would work equally well |

## 4. Project layout

```
src/
  core/          framework-free TypeScript
    audio/       ring buffer, resampler, shared decoder loop, live input (audio inputs, screen-share
                 audio), rate player and test signal (for tests), Signalsmith Stretch binding
      dsp/       sound chain: tempo stage, DJ filter, delay, reverb, limiter, sound settings and
                 presets
      engine/    media worker, engine AudioWorklet, AudioEngine facade
    analysis/    analyzer (FFT, bands), drum detection, beat tracker, beat grid for files,
                 waveform, feature layout, feature timeline; eval/ has the synthetic test mix and
                 the scoring (docs/ANALYSIS.md)
    library/     probe worker (tags, duration, cover art), fingerprints, track analysis worker
                 and its cache, folder reading, the stored queue
    render/      renderer facade and render worker (OffscreenCanvas, WebGL2), scenes (Logo
                 Spectrum; Kaleidoscope with Vortex, Crystal Mandala and Neon Ribbons), spectrum
                 shaping, automatic preset switching and morphs, fixed-step feedback, the
                 Kaleidoscope as a layer, post-processing (bloom, dithering, reduce flashing),
                 auto-quality, settings, parameter specs and presets, image storage
    export/      export worker (audio pass, video pass, join), formats and presets, job plan,
                 stored analysis replay, job storage in the Origin Private File System, Exporter
                 facade
    control/     DJ controllers in the app: deck 1 of the DDJ-FLX2 on the player, its lights
    player/      Player: connects the state with the engine; the play order (shuffle, repeat)
    state/       store with timestamped actions, app state, persistence, backups
    env/         what the app needs of the browser, the system check, the build's name
    util/
  ui/            Svelte app: shell, top bar, stage, analysis view, queue, sound, visuals and live
                 panels, transport with waveform and cues, detail waveform, export, A/V sync,
                 welcome and help dialogs, default logo
vite-plugins/    extraction of the Signalsmith Stretch WASM core, the build's name, the production
                 headers for the preview server
packages/
  dj-controllers/  library for DJ controllers: Web MIDI, profiles (DDJ-FLX2), events, lights
tests/e2e/       Playwright tests
tests/eval/      evaluation on real recordings (optional dataset, see docs/ANALYSIS.md)
tests/screenshots/
                 the README screenshots (docs/screenshots)
docs/            FEATURES.md, TECH-STACK.md, ANALYSIS.md, CONTROLLERS.md (proposal), USER-GUIDE.md
                 (also the in-app help), screenshots/
```

`core/` does not depend on the UI framework.

## 5. Spikes (P0)

Before P1 we tested the risky parts in small throwaway prototypes, in the Spike Lab, which reported pass or fail per criterion. The Spike Lab was removed before v1.0; its look at the browser became the system check in the help.

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
| S2 Key lock | pass | 0.9 % of one CPU core at 0.5–1.5×; bit-identical output in AudioWorklet and worker |
| S3 Encoding | pass | Hardware H.264: 1080p60 at 177 fps (2.9× real time), 4K30 at 53 fps (1.8×), 1080×1920 at 186 fps (6.2×); native AAC 154×, WebAssembly fallback 16× |
| S4 Rendering | pass | 1080p live at 59.7 fps (1 % low 39 fps); 4K offline at 117 fps; float render targets available |
| S5 Long render | pass | 3-hour export: 18 segments, 21,600 of 21,600 frames, audio 10,800.06 s; resumed 8 times; joined in 19 s |

What this means:

- **The stack carries.** Every risky part works on the main target, with a lot of headroom.
- **Export time**, estimated with the prototype scene; the encoder is the bottleneck. One hour at 1080p60 takes about 20–25 minutes, one hour at 4K30 about 35–40 minutes, and a 60-second TikTok clip about 10–15 seconds.
- **A/V sync (AN-06):** Chrome on macOS reports an output latency of 0 ms, so the offset cannot be detected automatically there. P1 needs a calibration step.
- **Frame pacing:** the 1 % low of 39 fps in the live test probably comes from shader warm-up in the first frames. P1 measures it without the warm-up.

The listening test (S2) and the upload of an export to YouTube and TikTok (S3) passed later, on 2026-10-03, as did Chrome on Windows and Firefox on Linux.


## 6. Open points

- Hosting: the Worker is connected to the repository (Workers Builds); `wrangler.jsonc` configures it.
- Listening test of tempo and effects on the main machine: vinyl and key lock at 0.5–1.5×, the reverb's character, the delay in time with the beat, no clicks when changing anything.
- A real DDJ-FLX2: its profile follows the MIDI message list; the MIDI monitor in the DJ controller dialog shows what does not match.
- The Screenshots workflow can be started once it is on `main`: GitHub offers manual workflows from the default branch.
- Export on the main machine: the tests cover both paths, VP9 + Opus (WebM) in the development container, which has no H.264 encoder, and H.264 + AAC (MP4) in CI. The upload of an export to YouTube and TikTok passed (2026-10-03); the render speed on Chrome/macOS is still to be measured.
