# Vibe Visualizer

Audio-reactive music visualizer in the browser: kaleidoscopic shader scenes and logo-centred spectrum visuals, watched live or rendered offline into HD videos for YouTube and TikTok. Everything runs locally: no server, no uploads.

> **Status:** Phase P0, technical spikes. The app itself starts in P1.
> Plans: [feature list](docs/FEATURES.md) · [tech stack](docs/TECH-STACK.md)

## Run it locally

Requirements: Node.js 22.13 or newer (24 recommended) and pnpm (`corepack enable` installs it).

```sh
pnpm install
pnpm dev
```

Then open http://localhost:5173 in Chrome or Firefox. The dev server sends the cross-origin isolation headers the audio engine needs.

## Spike Lab (P0)

The start page is the Spike Lab: five small prototypes that test the risky parts on your machine.

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

## Hosting

The app is a static site. On Cloudflare Pages use the build command `pnpm build` and the output directory `dist`; `public/_headers` sets the cross-origin isolation headers. GitHub Pages cannot send these headers.

## Project layout

```
src/core/       framework-free building blocks: audio ring buffer, Signalsmith Stretch binding,
                rate player, test signal, worker RPC, capability probe
src/spikes/     Spike Lab and the P0 prototypes
vite-plugins/   build-time extraction of the Signalsmith Stretch WebAssembly core
tests/e2e/      Playwright tests
docs/           feature list and tech stack
```
