# Vibe Visualizer

The app calls itself **FibeStation**; double-click the name in the top bar to give it another one.

Audio-reactive music visualizer in the browser: kaleidoscopic shader scenes and logo-centred spectrum visuals, watched live or rendered offline into HD videos for YouTube and TikTok. Everything runs locally: no server, no uploads.

> **Status:** P1, P2, P3 and P5 are done: audio engine, queue and transport, analysis with drum detection and beat tracking, the Logo Spectrum and Kaleidoscope modes, the video export (whole tracks or clips, in segments that survive a crash), live input from audio devices and other apps, tempo (vinyl and key lock) and effects (DJ filter, delay, reverb, one-click "Slowed + Reverb", "Sped up" and "Nightcore"), waveforms and hot cues, a beat grid for files, gapless playback with shuffle and repeat, folders, a queue that survives reloads, A/V sync calibration and a shortcut overview, and a usability pass (play ranges, snapping to the beat, undo, bars and tempo correction in the beat grid, two waveform styles). Next: P4 (more scenes and video polish).
> Plans: [feature list](docs/FEATURES.md) · [tech stack](docs/TECH-STACK.md) · [audio analysis](docs/ANALYSIS.md)

## Run it locally

Requirements: Node.js 22.13 or newer (24 recommended) and pnpm (`corepack enable` installs it).

```sh
pnpm install
pnpm dev
```

Then open http://localhost:5173 in Chrome or Firefox. The dev server sends the cross-origin isolation headers the audio engine needs.

## Using the app

Drop audio files or whole folders onto the window (or click **Add files**, or the folder button next to it); several files make a queue. Folders are read with their subfolders and sorted by track number (or else by file name, so "2 …" comes before "10 …"); covers and playlists in them are skipped. Double-click a track to play it.

- **Shortcuts:** press **?** (or the ? in the top bar) for all of them. The main ones: Space play/pause, ←/→ seek 5 s (with Shift 30 s), N next, P previous, 1–8 hot cues, I/O in and out markers, Q snap to the beat, −/+ tempo in steps of 0.1 %, V the next visual mode, [ and ] the previous or next preset, F fullscreen, Ctrl+Z (Cmd+Z) undo.
- **In and out markers:** press I and O (or the bracket buttons next to Stop) to mark the part of a track that plays and exports. Played from the queue, a track starts at its in marker, and at its out marker the next track follows, crossing over in 10 ms so the cut does not click. With *repeat the track*, the part loops. Past the out marker (after a jump there) the track plays to its end. Drag a marker on the timeline or in the detail waveform to move it; with a marker focused, ← and → move it by a beat. The chip next to the buttons shows the part and its length; click it to clear the markers.
- **Snap to the beat:** the magnet button (Q), on by default, puts markers and cues on the nearest beat of the track's beat grid when you set or drag them.
- **Undo:** removing a track, clearing the queue, deleting a cue or clearing markers shows an *Undo* button for a few seconds (or press Ctrl+Z).
- **Queue:** tracks follow each other without a gap, also between files with different sample rates. The buttons next to Stop switch shuffle and repeat (off, the whole queue, or the track); S and R do the same. The queue and the current track are still there after a reload. In Chrome and Edge the files come back too (after restarting the browser, click **Allow** once in the queue); other browsers keep the entries, and adding the files or their folder again brings them back, with their cues.
- **Waveforms and cues:** the timeline shows the track's waveform, computed in the background, also for mixes of several hours. Above it, the detail waveform (W switches it on and off) shows a few seconds around the playhead with the beats, and a stronger line on the first beat of each bar; drag it to seek, scroll to zoom. The button in its corner switches the style: *3 bands* (lows blue, mids orange, highs white, as in Rekordbox) or *RGB* (one shape, bass red, mids green, highs blue). Eight hot cues per track: press 1–8 (or click a pad) to set a cue where it is empty or to jump to it, Shift+1–8 deletes it. Jumps fade over a few milliseconds, like pausing and resuming, so they do not click. Cues and markers are kept per file and come back whenever you add the file again.
- **Beat grid:** each file is analysed as a whole in the background. The visuals then follow its beats and its tempo (also through tempo changes within a mix) instead of guessing them live; the grid also knows where the bars start. The queue shows each track's BPM. If it reads a related tempo (87 instead of 174 BPM, say), click the BPM to double, halve, multiply or divide it by 1.5, or to go back to the tempo found; the grid follows at once and the choice is kept for the file.

The top bar switches the stage between three views:

- **Logo Spectrum:** your logo in the middle, a spectrum ring of colour layers around it, star particles and a background image. Everything is set in the side panel under **Visuals**: presets (built in, or save your own), the ring (palette or your own colours, layers, size, frequency range, rotation, glow), how it reacts (quick settings *Smooth*, *Punchy*, *Twitchy*, or each value), the logo (image, zoom and position inside the circle, rim, shadow, bass pulse), the background (image, fill or fit, position, blur, darkening, bass zoom) and the particles. Double-click a slider's label to reset it. Your images and settings are kept in the browser, so they are still there after a reload.
- **Kaleidoscope:** MilkDrop-style feedback visuals, folded into mirrored segments. Two scenes: *Vortex* (a swirling tunnel of fibrous strands pulled into a glowing core) and *Crystal Mandala* (glowing stars and crystal shards flying out of a star-shaped tunnel). Under **Visuals**: presets, the scene, symmetry (segments, mirroring, spin, zoom, centre), motion (tunnel flow, twist, trails), colour (palettes or your own gradient, hue cycle, a colour step every bar), how strongly it reacts to the music, and each scene's own parameters.
- **Analysis:** what the visuals react to: spectrum, band energies, kick/snare/hi-hat lamps, the beat (its ring shows the position within the beat) and the tempo.

In fullscreen (F), only the visuals show; the mouse cursor hides when you do not move it.

If the visuals run ahead of the sound (Bluetooth headphones, a TV, or Chrome on a Mac, which reports no output latency), open **Visuals → A/V sync** and click **Calibrate…**: a tick plays every second and a circle flashes; move the slider until both come together. The latency the browser reports is taken into account already. Exports are always in sync.

## Tempo and effects

The **Sound** tab in the side panel changes how the music sounds, while you listen and in exported videos. A dot on the tab shows that the sound is changed.

- **Presets:** *Slowed + Reverb* (85 %, deeper, with a reverb of 0.7 s), *Sped up* (120 %), *Nightcore* (130 %) and *Clean*. Everything stays adjustable afterwards.
- **Tempo:** a fader with a range of ±8 %, ±16 % or ±50 %, fine steps of 0.1 %, reset (or double-click the fader), and *Nudge*: 4 % slower or faster while you hold the button. *Vinyl* changes the pitch with the speed, like a record; *Key lock* keeps the pitch. The tempo display shows the detected BPM, and the original BPM when the speed is changed.
- **Filter:** one knob from low-pass (left) to high-pass (right), with resonance; the middle is off.
- **Delay:** in time with the beat (1/16 to 1/1, straight, dotted or triplet) or in milliseconds, with feedback, a tone filter for the echoes, ping-pong and mix.
- **Reverb:** size, decay, pre-delay, damping and mix.
- Changes glide without clicks, and a switched-off delay or reverb rings out. A limiter keeps the output from clipping.

The visuals react to the music after the tempo and the filter, before the echoes and the reverb: those would blur the beats.

The stage shows the visuals in the aspect ratio of your video: 16:9 (YouTube), 9:16 (TikTok, Shorts, Reels), 1:1, 4:5 or 21:9, chosen in the top bar. The frame button next to it shows the safe areas: the title-safe frame, and on 9:16 the parts that the apps cover with their buttons and captions.

## Live input

To visualise music that plays somewhere else (a DJ mixer, a turntable, a music app or a browser tab), open the **Live** tab in the side panel.

- **Audio input:** choose a line-in, microphone or virtual audio device and click **Start**. The browser's voice processing (echo cancellation, noise suppression, automatic gain) is switched off, so music stays clean.
- **Another tab or app:** opens the browser's share dialog. Choose a tab and keep "Also share tab audio" on; some systems also offer "Also share system audio" for the whole screen.
- **Level and monitoring:** input gain and a level meter. *Hear the input through this app* is off by default and for every new source: a microphone next to speakers would feed back.
- A music app on the same computer can be routed through a virtual audio device: BlackHole on macOS, VB-Audio Virtual Cable on Windows, or a monitor source with PipeWire/PulseAudio on Linux. The Live tab explains the steps.

While live input runs, the visuals follow it without delay and the queue pauses; double-click a track to go back to it. The export renders files from the queue; recording the live input is planned for later (IN-06).

## Exporting videos

Click **Export** in the top bar. Choose a format (*YouTube 1080p60*, *YouTube 4K30*, *TikTok / Shorts 1080×1920*, or your own aspect ratio, size and frame rate), the quality, and the range: the whole track or the part between the markers. For a 30-second clip, play the track and press I at the start and O at the end (or use the bracket buttons next to Stop); they snap to the beat unless snapping (Q) is off. The dialog shows the codecs, the sound and the video's length (a slowed-down track makes a longer video) and the estimated file size. The export uses the same scenes, analysis, settings, tempo and effects as the preview, so the video looks and sounds like what you see and hear. With a sound preset, its name goes into the file name, e.g. "Artist - Title (Slowed + Reverb).mp4".

- The video is rendered frame by frame, independent of the speed of your graphics card: a slower machine just takes longer, and the result is always smooth.
- In Chrome and Edge you pick the file first; the video is written straight into it. Other browsers keep it in browser storage and download it at the end.
- The format is MP4 (H.264 + AAC). A browser without H.264 encoding writes WebM (VP9 + Opus) instead.
- You can pause or cancel the export, and close the dialog while it runs; the screen stays awake. The live visuals pause meanwhile.
- Long exports are written in segments of up to five minutes. If the tab crashes or you reload, the app offers to resume, and it continues exactly where the last segment ended. (If it stopped while still preparing the audio, add the track to the queue again first.)

## Spike Lab (P0)

The Spike Lab (http://localhost:5173/#/lab; the development server also links it in the top bar) has five small prototypes that test the risky parts on your machine.

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
| `pnpm eval:drums` | Drum detection, beat tracking and beat grid scores on real recordings (needs the MDB Drums dataset, see [ANALYSIS.md](docs/ANALYSIS.md#5-evaluation)) |

## Hosting

The app is a static site. On Cloudflare Pages use the build command `pnpm build` and the output directory `dist`; `public/_headers` sets the cross-origin isolation headers. GitHub Pages cannot send these headers.

## Project layout

```
src/core/       framework-free core: audio engine (media worker, AudioWorklet, resampler, ring
                buffer, live input), sound chain (tempo, filter, delay, reverb, limiter),
                analysis (live, and per file: waveform and beat grid), library (fingerprints,
                analysis cache, folders, stored queue), WebGL2 renderer (render worker, Logo
                Spectrum and Kaleidoscope scenes), export (export worker, formats, job
                storage), player (play order) and state, Signalsmith Stretch binding, utilities
src/ui/         Svelte app: top bar, stage, queue, sound, visuals and live panels, transport
                with waveforms and cues, export, sync and shortcut dialogs
src/spikes/     Spike Lab and the P0 prototypes
vite-plugins/   build-time extraction of the Signalsmith Stretch WebAssembly core
tests/e2e/      Playwright tests
tests/eval/     analysis evaluation on real recordings
docs/           feature list, tech stack, audio analysis
```
