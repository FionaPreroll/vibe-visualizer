# Vibe Visualizer

Audio-reactive music visualizer in the browser: kaleidoscopic shader scenes and logo-centred spectrum visuals, watched live or rendered offline into HD videos for YouTube and TikTok. Everything runs locally: no server, no uploads.

> **Status:** P1 and P2 are done: audio engine, queue and transport, analysis with drum detection and beat tracking, the Logo Spectrum and Kaleidoscope modes, and the video export (whole tracks or clips, in segments that survive a crash). Next: P3, cues, tempo and effects.
> Plans: [feature list](docs/FEATURES.md) · [tech stack](docs/TECH-STACK.md) · [audio analysis](docs/ANALYSIS.md)

## Run it locally

Requirements: Node.js 22.13 or newer (24 recommended) and pnpm (`corepack enable` installs it).

```sh
pnpm install
pnpm dev
```

Then open http://localhost:5173 in Chrome or Firefox. The dev server sends the cross-origin isolation headers the audio engine needs.

## Using the app

Drop audio files onto the window (or click **Add files**); several files make a queue. Double-click a track to play it. Shortcuts: Space play/pause, ←/→ seek 5 s (with Shift 30 s), N next, P previous, F fullscreen, I/O set the in and out marker (with Shift they are cleared); in the queue Alt+↑/↓ moves a track and Delete removes it.

The top bar switches the stage between three views:

- **Logo Spectrum:** your logo in the middle, a spectrum ring of colour layers around it, star particles and a background image. Everything is set in the side panel under **Visuals**: presets (built in, or save your own), the ring (palette or your own colours, layers, size, frequency range, rotation, glow), how it reacts (quick settings *Smooth*, *Punchy*, *Twitchy*, or each value), the logo (image, zoom and position inside the circle, rim, shadow, bass pulse), the background (image, fill or fit, position, blur, darkening, bass zoom) and the particles. Double-click a slider's label to reset it. Your images and settings are kept in the browser, so they are still there after a reload.
- **Kaleidoscope:** MilkDrop-style feedback visuals, folded into mirrored segments. Two scenes: *Vortex* (a swirling tunnel of fibrous strands pulled into a glowing core) and *Crystal Mandala* (glowing stars and crystal shards flying out of a star-shaped tunnel). Under **Visuals**: presets, the scene, symmetry (segments, mirroring, spin, zoom, centre), motion (tunnel flow, twist, trails), colour (palettes or your own gradient, hue cycle, a colour step every bar), how strongly it reacts to the music, and each scene's own parameters.
- **Analysis:** what the visuals react to: spectrum, band energies, kick/snare/hi-hat lamps, the beat (its ring shows the position within the beat) and the tempo.

In fullscreen (F), only the visuals show; the mouse cursor hides when you do not move it.

The stage shows the visuals in the aspect ratio of your video: 16:9 (YouTube), 9:16 (TikTok, Shorts, Reels), 1:1, 4:5 or 21:9, chosen in the top bar. The frame button next to it shows the safe areas: the title-safe frame, and on 9:16 the parts that the apps cover with their buttons and captions.

## Exporting videos

Click **Export** in the top bar. Choose a format (*YouTube 1080p60*, *YouTube 4K30*, *TikTok / Shorts 1080×1920*, or your own aspect ratio, size and frame rate), the quality, and the range: the whole track or the part between the markers. For a 30-second clip, play the track and press I at the start and O at the end (or use the bracket buttons next to Stop). The dialog shows the codecs and the estimated file size. The export uses the same scenes, analysis and settings as the preview, so the video looks like what you see (the audio is the file's own; tempo and effects come with P3).

- The video is rendered frame by frame, independent of the speed of your graphics card: a slower machine just takes longer, and the result is always smooth.
- In Chrome and Edge you pick the file first; the video is written straight into it. Other browsers keep it in browser storage and download it at the end.
- The format is MP4 (H.264 + AAC). A browser without H.264 encoding writes WebM (VP9 + Opus) instead.
- You can pause or cancel the export, and close the dialog while it runs; the screen stays awake. The live visuals pause meanwhile.
- Long exports are written in segments of up to five minutes. If the tab crashes or you reload, the app offers to resume, and it continues exactly where the last segment ended. (If it stopped while still preparing the audio, add the track to the queue again first.)

## Spike Lab (P0)

The Spike Lab (http://localhost:5173/#/lab, or the link in the top bar) has five small prototypes that test the risky parts on your machine.

| Spike | Tests | You need |
|---|---|---|
| S1 Streaming audio | Playing a long file while decoding it in pieces: cue jumps, dropouts, memory | An audio file, ideally a 1–3 hour mix |
| S2 Key lock | Time-stretching speed and bit-identical output live vs. offline; tempo slider for listening | Nothing (a file is optional for listening) |
| S3 Encoding | H.264 + AAC speed at 1080p60, 4K30 and 1080×1920; writes an A/V sync sample MP4 | Upload the sample to YouTube/TikTok (private) |
| S4 Rendering | WebGL2 feedback + kaleidoscope + bloom, live at 1080p and offline at 4K | Nothing (flashing visuals) |
| S5 Long render | A multi-hour export in resumable segments, joined without re-encoding | About 1 GB of free disk space for the 3-hour run |

Run the spikes, click **Copy report** and paste the report into the chat.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build`, `pnpm preview` | Production build, and serving it on port 4173 |
| `pnpm check` | Type check (Svelte and TypeScript) |
| `pnpm lint`, `pnpm format` | ESLint, Prettier |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright); run the spikes in quick mode |
| `pnpm eval:drums` | Drum and beat detection scores on real recordings (needs the MDB Drums dataset, see [ANALYSIS.md](docs/ANALYSIS.md#4-evaluation)) |

## Hosting

The app is a static site. On Cloudflare Pages use the build command `pnpm build` and the output directory `dist`; `public/_headers` sets the cross-origin isolation headers. GitHub Pages cannot send these headers.

## Project layout

```
src/core/       framework-free core: audio engine (media worker, AudioWorklet, resampler, ring
                buffer), analysis, WebGL2 renderer (render worker, Logo Spectrum and Kaleidoscope
                scenes), export (export worker, formats, job storage), player and state,
                Signalsmith Stretch binding, utilities
src/ui/         Svelte app: top bar, stage, queue, visuals panel, transport, export dialog
src/spikes/     Spike Lab and the P0 prototypes
vite-plugins/   build-time extraction of the Signalsmith Stretch WebAssembly core
tests/e2e/      Playwright tests
tests/eval/     analysis evaluation on real recordings
docs/           feature list, tech stack, audio analysis
```
