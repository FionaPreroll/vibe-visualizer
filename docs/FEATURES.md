# Vibe Visualizer — Feature List

> **Status:** v0.9 (2026-09-25). The answers to Q1–Q16 are applied (see [§8 Decision log](#8-decision-log)), and the P0 spikes passed on the main target machine. The tech stack is in [TECH-STACK.md](TECH-STACK.md); drum detection and beat tracking are described in [ANALYSIS.md](ANALYSIS.md).

## How to use this document

- Every feature has an **ID** (e.g. `FX-02`), so we can discuss it in short form: "FX-09 → S", "drop TR-07", "Q17: a".
- **Priority:** **M** = Must (v1.0 core) · **S** = Should (v1.0, after the core) · **C** = Could (nice to have, if cheap) · **L** = Later (idea for after v1.0)
- `*` after an ID = a suggested addition that was not in the original brief. Veto freely.
- Open decisions are in [§6 Open questions](#6-open-questions). Agreed decisions go into [§8 Decision log](#8-decision-log).

## 1. Vision

Vibe Visualizer is a browser app that plays music (local files or live input) and turns it into high-resolution, audio-reactive visuals. It offers psychedelic, kaleidoscopic shader scenes ("like MilkDrop, but crisp HD/4K") and logo-centred circular spectrum visuals like those on music YouTube channels.

**Primary use: producing videos for YouTube and TikTok.** The app renders offline, frame by frame, into a video file with the audio in sync. That way slow GPUs work too; they just take longer. The live view, optionally in fullscreen, doubles as the preview. Everything runs locally in the browser.

## 2. Reference looks

### 2.1 Mode A — Kaleidoscope (reference image 1)

| Ref | Look |
|---|---|
| K1 "Vortex" | Swirling spiral tunnel pulling toward a dark centre with a tiny red glow; fibrous, organic feedback texture; two-tone palette (green / dark red) with bright edge strands. |
| K2 "Crystal Mandala" | 8-fold mirror symmetry; magenta crystal shards radiating out of a tunnel; nested glowing star outlines in the centre; small cyan streak particles flying outward. |
| K3 "Neon Ribbons" | 3D-looking neon tubes (cyan, yellow, green, pink) twisting around the centre with 5-fold symmetry; orange fractal "blossoms" in the lobes; small floating flower particles. |

Common traits: radial symmetry, endless zoom/tunnel motion, saturated neon colours on a dark ground, fine detail that holds up at high resolution.

### 2.2 Mode B — Logo Spectrum (reference images 2–4, "Trap Nation style")

- **Background:** a still image (low-poly landscape) with floating star/dust particles. The particles move between the screenshots, so they are an animated layer over the still image.
- **Spectrum ring:** a smooth, blob-like closed shape around the logo, mirrored left/right. Several stacked colour layers (a rainbow fringe) sit behind a white top layer, with a strong glow. The frequencies are mapped around the circle. The big lobes at the top in image 2 suggest bass at the top and higher frequencies further down.
- **Logo:** round and centred, with a white rim. It pulses with the bass.
- We ship **no third-party logos or assets**. Users upload their own, and the defaults are neutral placeholders.

## 3. Features

### 3.1 Audio files & library (SRC)

| ID | Prio | Feature |
|---|---|---|
| SRC-01 | M | Load local audio files via file picker and drag & drop; multiple files at once are appended to the queue |
| SRC-02 | M | Formats: everything the browser can decode (at least MP3, AAC/M4A, OGG/Opus, FLAC, WAV); unsupported files are reported, not silently dropped |
| SRC-03* | S | Drop whole folders (recursive, sorted by track number / file name) |
| SRC-04* | S | Read metadata: title, artist, album, duration, embedded cover art |
| SRC-05* | S | The queue survives page reloads. Chromium keeps access to the files (the browser may ask you to confirm after a restart); other browsers keep the entries and ask you to pick the files again (Q9) |
| SRC-06* | C | Bundled royalty-free demo track for trying the app without own files |

### 3.2 Playlist / queue (PL)

| ID | Prio | Feature |
|---|---|---|
| PL-01 | M | Queue with title, artist and duration; current track highlighted; automatic advance to the next track |
| PL-02 | M | Next / previous; double-click a track to play it |
| PL-03 | M | Reorder via drag & drop, remove, clear |
| PL-04* | S | Shuffle; repeat off / one / all |
| PL-05* | S | Gapless transitions (Q7) |
| PL-06* | L | Crossfade between tracks (adjustable length); after v1 (Q7) |
| PL-07* | C | Save/load named playlists |

### 3.3 Transport, seeking & cue points (TR)

| ID | Prio | Feature |
|---|---|---|
| TR-01 | M | Play/pause, stop; elapsed and remaining time |
| TR-02 | M | Seek by clicking/dragging on the timeline and via keyboard |
| TR-03* | S | Waveform overview of the whole track as the seek bar (computed in the background, also for 3-hour files) |
| TR-04 | M | Hot cues: 8 per track. Set one at the current position, jump to it (recall) or delete it; colour-coded markers on the timeline |
| TR-05* | S | Cues are stored per track and survive reloads (tracks are recognised by a file fingerprint) |
| TR-06* | C | Beat-quantised cue jumps (requires AN-07) |
| TR-07* | C | Loops: A–B loop and beat loops |
| TR-08* | S | Zoomable detail waveform around the playhead for precise cue and in/out placement (important for long mixes) |
| TR-09* | M | In/out markers that define an export range, e.g. a 30-second TikTok clip (keys I/O, shown on the timeline) |

### 3.4 Tempo (TMP)

| ID | Prio | Feature |
|---|---|---|
| TMP-01 | M | Speed up / slow down: tempo fader with selectable range (±8 %, ±16 %, ±50 %) and reset; no reverse playback (Q6) |
| TMP-02 | M | Two modes: **Vinyl** (pitch follows speed) and **Key lock** (pitch stays, via high-quality time-stretching); both from the start (Q6) |
| TMP-03* | S | Fine steps and temporary pitch bend (nudge) via buttons/keys |
| TMP-04* | S | BPM display (detected BPM × tempo factor; requires AN-07) |
| TMP-05* | C | Key shift in semitones, independent of tempo |

### 3.5 Audio FX & master (FX)

| ID | Prio | Feature |
|---|---|---|
| FX-01 | M | Reverb: size/decay, pre-delay, damping, wet/dry, on/off |
| FX-02 | M | Delay: time in ms or BPM-synced (1/16 … 1/1, dotted, triplet), feedback, tone filter in the feedback path, ping-pong, wet/dry, on/off |
| FX-03 | M | Parameter changes without clicks; effect tails ring out naturally when an effect is switched off |
| FX-04* | M | Master volume and a safety limiter (protects against clipping from FX feedback) |
| FX-05* | C | Momentary "FX throw": the effect is only active while a key/button is held |
| FX-06* | S | DJ filter: one knob from low-pass through neutral to high-pass, with resonance (Q8) |
| FX-07* | C | Custom reverb impulse responses (upload a WAV) |
| FX-08* | C | Loudness normalisation between tracks (ReplayGain-like) |
| FX-09* | C | More FX: 3-band EQ with kills, flanger/phaser, bitcrusher |
| FX-10* | M | One-click presets for popular edits: "Slowed + Reverb", "Sped up", "Nightcore". They set tempo mode, rate and FX, and everything stays adjustable (Q15) |

### 3.6 Live input (IN)

| ID | Prio | Feature |
|---|---|---|
| IN-01 | S | Browser audio input as a source (line-in, microphone, virtual device) with a device picker. The browser's voice processing (echo cancellation, noise suppression, auto gain) is switched off so music stays clean |
| IN-02 | S | Audio from other apps: tab/system audio via the browser's screen-share dialog where supported; in-app help for virtual audio devices (e.g. BlackHole, VB-Cable, PipeWire) |
| IN-03* | S | Input gain and level meter |
| IN-04* | S | Monitoring (hearing the input through the app) is off by default to avoid feedback loops; it can be switched on |
| IN-05* | C | Tap tempo / manual BPM for beat-synced effects |
| IN-06* | L | Record the input as a track, so it can be cued, played back and rendered offline |

### 3.7 Audio analysis (AN): what drives the visuals

| ID | Prio | Feature |
|---|---|---|
| AN-01 | M | Spectrum (FFT) with a logarithmic frequency scale |
| AN-02 | M | Band energies (sub, bass, low-mid, mid, high-mid, treble) and overall loudness |
| AN-03 | M | Beat/onset detection, roughly separated into kick / snare / hi-hat (v2 with measured accuracy: [ANALYSIS.md](ANALYSIS.md)) |
| AN-04 | M | Waveform data (time domain) for oscilloscope-style elements |
| AN-05* | M | Adaptive normalisation (auto-gain), so quiet and loud material both look lively |
| AN-06* | S | A/V sync offset that compensates output latency (e.g. Bluetooth headphones, 100–300 ms): auto-detected where the browser reports it, a calibration step (flash + beep, adjust until in sync) and a manual slider. Chrome on macOS reports 0 ms, so calibration is needed there |
| AN-07* | S | Tempo (BPM) and beat-phase tracking. Live tracking is done (analysis v2). Still open: for files, a beat grid is pre-computed in the background and follows tempo changes within long mixes |
| AN-08* | C | Build-up/drop detection, e.g. to trigger preset changes or effects |
| AN-09* | C | Choose whether the visuals react to the signal before or after the FX |
| AN-10* | L | Stem separation (drums / bass / vocals) with on-device ML for more precise reactions. Heavy; mainly useful for offline rendering |

### 3.8 Visual engine, shared by both modes (VE)

| ID | Prio | Feature |
|---|---|---|
| VE-01 | M | GPU rendering at native resolution (HiDPI, up to 4K); target 60 fps; high-refresh displays supported |
| VE-02 | M | "HD instead of MilkDrop": floating-point buffers (no colour banding), per-pixel warping instead of a coarse warp mesh, bloom, dithering, anti-aliasing |
| VE-03 | M | Frame-rate-independent animation and feedback: it looks the same at 30, 60 or 144 fps (a prerequisite for EX) |
| VE-04 | M | Two visual modes, Kaleidoscope (A) and Logo Spectrum (B), switchable at any time |
| VE-05* | M | Photosensitivity warning on first start (flashing visuals) |
| VE-06* | S | "Reduce flashing" option: limits strobe/flash frequency and sudden brightness jumps |
| VE-07* | S | Render-scale/quality slider and auto-quality (lowers the internal resolution when the frame rate drops) |
| VE-08* | S | Layer composition, e.g. a kaleidoscope scene as an animated background behind the logo spectrum. Internally both modes are built on this layer stack (Q5) |
| VE-09* | M | Aspect ratios 16:9, 9:16 (TikTok/Shorts/Reels), 1:1, 4:5, 21:9; the preview is letterboxed and shows safe-area guides, including the areas TikTok covers with its buttons |
| VE-10* | C | Post effects: vignette, chromatic aberration on beats, film grain, beat flash |
| VE-11* | C | FPS/performance overlay |

### 3.9 Mode A — Kaleidoscope scenes (KA)

| ID | Prio | Feature |
|---|---|---|
| KA-01 | M | Shader-based scene system: every scene declares typed parameters, and the UI controls are generated from them |
| KA-02 | M | Scene "Vortex" (ref K1) |
| KA-03 | M | Scene "Crystal Mandala" (ref K2) |
| KA-04 | S | Scene "Neon Ribbons" (ref K3), the most complex one (3D look) |
| KA-05 | M | Kaleidoscope controls: symmetry order (number of segments), mirroring, rotation, zoom/tunnel speed, centre position |
| KA-06 | M | MilkDrop-style feedback: the previous frame is warped (zoom, rotate, swirl) and faded, which creates trails and endless tunnels |
| KA-07 | M | Colour palettes: presets and custom gradients; hue cycling |
| KA-08 | M | Audio reactivity: every scene ships with sensible mappings (e.g. kick → zoom pulse, hi-hats → particles, new bar → palette shift), plus global "reactivity" and "intensity" sliders |
| KA-09* | C | Modulation matrix: route any audio feature to any parameter (amount, smoothing, curve) |
| KA-10* | L | More scenes: fractal fly-through, liquid plasma, particle galaxy, oscilloscope/Lissajous feedback, … |
| KA-11* | L | Run classic MilkDrop presets via the open-source Butterchurn engine; not in v1 (Q10) |
| KA-12* | L | Import Shadertoy-style GLSL shaders (audio fed in as a texture) |

### 3.10 Mode B — Logo Spectrum (LS)

**Background**

| ID | Prio | Feature |
|---|---|---|
| LS-01 | M | Background image upload (JPG/PNG/WebP); cover/contain, position |
| LS-02* | S | Adjustments: blur, brightness/dimming, colour tint |
| LS-03* | S | Motion: zoom pulse on bass, camera shake on kicks, slow drift (Ken Burns), each with an intensity setting |
| LS-04* | C | Video loop as background (MP4/WebM, muted) |

**Spectrum ring**

| ID | Prio | Feature |
|---|---|---|
| LS-05 | M | Circular FFT spectrum around the logo: a smooth closed shape (spline), mirrored left/right; frequency range and start angle adjustable |
| LS-06 | M | Multi-layer "rainbow stack": N colour layers behind a top layer, each slightly offset in size and timing. This creates the colourful fringe of the references |
| LS-07 | M | Palette: presets (Rainbow, Neon, Fire, Ice, Mono, Pastel, …) and custom colours per layer; optional hue cycling |
| LS-08 | M | Responsiveness: sensitivity, attack (rise speed), release (fall speed), spatial smoothing, noise threshold, bass/treble tilt, auto-gain; quick presets "Smooth", "Punchy", "Twitchy" |
| LS-09 | M | Glow/bloom around the ring (amount, radius, colour) |
| LS-10 | S | Geometry: ring radius, maximum amplitude, rotation (static, slow spin, audio-driven) |
| LS-11* | S | Styles besides the filled blob: bars, lines, dots; outward / inward / both |

**Logo**

| ID | Prio | Feature |
|---|---|---|
| LS-12 | M | Logo upload (PNG/SVG/JPG/WebP) with a circular crop: pan and zoom inside the circle; neutral default logo |
| LS-13 | M | Size, position, rim (width, colour), shadow/glow |
| LS-14* | M | Bass pulse: the logo scales with the bass (amount, attack/release) |
| LS-15* | S | Use the track's cover art as the logo (switches automatically per track) |
| LS-16* | C | Logo rotation: constant, beat-synced, or "vinyl" (coupled to playback speed) |
| LS-20* | L | Free-form logo: any PNG with transparency, without the circular crop (Q12) |

**Particles & overlays**

| ID | Prio | Feature |
|---|---|---|
| LS-17 | S | Particles like the stars in the references: count, size, speed, direction (drift/outward), glow; speed and brightness react to the music |
| LS-18* | S | Text overlay: title/artist (from metadata, editable), font, position, fade-in at track start |
| LS-19* | C | Progress bar / time overlay |

### 3.11 Presets & automation (PR)

| ID | Prio | Feature |
|---|---|---|
| PR-01 | M | Presets (mode + all parameters + palette + reactivity): built-in presets plus your own |
| PR-02 | S | Automatic preset switching (every N seconds, every N bars, or on drops) with smooth transitions (crossfade/morph), like MilkDrop |
| PR-03* | S | Preset browser with favourites and "random preset" |
| PR-04* | S | Export/import presets as files |
| PR-05* | C | "Randomise": generate new looks from random parameters within sensible ranges |
| PR-06* | C | Assign a preset to a specific track |
| PR-07* | L | Share a preset as a link |

### 3.12 Display & output (DS)

| ID | Prio | Feature |
|---|---|---|
| DS-01 | M | Fullscreen (button and key); the UI and mouse cursor hide automatically |
| DS-02* | C | Performance mode: visuals only, controlled by keyboard |
| DS-03* | L | Separate output window for a second screen or projector; the controls stay on the main screen |
| DS-04* | L | UI-less output view (via URL) for capturing in OBS |

### 3.13 Offline render / video export (EX)

| ID | Prio | Feature |
|---|---|---|
| EX-01 | M | Render to a video file frame by frame, independent of GPU speed. A slow machine just takes longer; the result is still smooth |
| EX-02 | M | The file's audio gets the same processing (tempo, FX), rendered offline and sample-accurately in sync |
| EX-03 | M | Settings: platform presets "YouTube 1080p60", "YouTube 4K30" and "TikTok/Shorts 1080×1920" (Q11), plus custom resolution, frame rate (24/25/30/50/60) and quality/bitrate; estimated file size |
| EX-04 | M | Format: MP4 (H.264 + AAC) (Q11). If the browser has no AAC encoder, a bundled WebAssembly encoder steps in; WebM (VP9 + Opus) only as a fallback when H.264 is unavailable |
| EX-05* | M | Range: whole track, in/out range (TR-09), selected tracks, or the whole playlist as one video |
| EX-06 | M | Progress: percent, render speed (× real time), remaining time, preview image, pause/cancel; keeps the machine awake |
| EX-07 | M | Large files are written straight to disk while rendering instead of being held in memory (Chromium; other browsers go through browser storage) |
| EX-08* | C | Quality boosts only possible offline: supersampling, motion blur, more particles |
| EX-09* | S | Batch: every playlist track as its own video (e.g. for YouTube uploads) |
| EX-10* | S | Single frame as PNG, e.g. as a YouTube thumbnail |
| EX-11* | C | Audio-only export of the processed audio (WAV) |
| EX-12* | C | Quick real-time recording of what is on screen (only sensible on fast machines) |
| EX-13* | L | "Play live, render later": record a live session (cue jumps, tempo, FX, preset switches) and render it offline in HD. Prepared by NF-08 (Q4) |
| EX-14* | S | YouTube chapters: for playlist renders, generate the chapter list (timestamps + titles) for the video description |
| EX-15* | M | Long renders (up to 3 h) are written in segments and can be resumed after an interruption or a crash |
| EX-16* | C | Fade in/out at the start and end of an export (picture from/to black, audio) |

### 3.14 UI, controls & persistence (UI)

| ID | Prio | Feature |
|---|---|---|
| UI-01 | M | Layout: visual stage in the centre, transport bar with timeline at the bottom, collapsible side panels (queue, visuals, FX) |
| UI-02 | M | Dark theme; UI language English |
| UI-03* | M | Settings persist across reloads (mode, preset, FX, …) |
| UI-04* | S | Keyboard shortcuts (space, arrows, 1–8 for cues, I/O for in/out, tempo, F for fullscreen, presets, …) with a help overlay |
| UI-05* | L | MIDI controller support (knobs → parameters, pads → cues/FX) |
| UI-06* | C | Project file: save/load everything (playlist, cues, presets, images) |
| UI-07* | L | Installable app (PWA) that works offline |

### 3.15 Non-functional requirements (NF)

| ID | Prio | Requirement |
|---|---|---|
| NF-01 | M | 100 % client-side: no server, no upload, no account. Audio never leaves the machine; the app is hosted as a static website |
| NF-02 | M | Browsers (Q14): Chrome on macOS first; Chrome on Windows and Firefox on Linux second; Safari best effort. Features are detected, not assumed (some are Chromium-only, e.g. writing exports straight to disk) |
| NF-03 | M | Desktop first; mobile is not a v1 target (Q2) |
| NF-04 | M | Performance: Mode B at 1080p60 on integrated graphics; Mode A scenes with quality levels; 4K on dedicated GPUs |
| NF-05 | M | Determinism: same audio + settings + random seed → identical frames, so the live view and the export look the same |
| NF-06 | M | Files up to 3 h (Q3): streamed decoding with bounded memory; waveform, analysis and beat grid are computed incrementally; stable over hours of use |
| NF-07* | S | The UI is fully usable with the keyboard and has readable contrast |
| NF-08* | M | Every state change is a timestamped action. This prepares recording and replaying live sessions later (EX-13, Q4) |

## 4. Out of scope (for now)

- **Streaming services** (Spotify, Apple Music, YouTube, …): their audio is DRM-protected and cannot be analysed in the browser. Play it elsewhere and use live input (IN-01/02) instead.
- Server/cloud rendering, user accounts, cloud sync.
- Multi-deck DJ mixing (two decks with crossfader and sync).
- Direct live streaming (RTMP). Capture the app with OBS instead.
- A video-editing timeline with keyframes (EX-13 covers the "performance" use case).

## 5. Roadmap proposal

Reordered after Q1: the export comes right after the core, because it is the main use case. It also proves early that the architecture carries.

| Phase | Goal | Features |
|---|---|---|
| P0 Setup & spikes | Project skeleton, CI, hosting; test the risky parts first | Spikes S1–S5 in [TECH-STACK.md](TECH-STACK.md#5-spikes-p0). Passed on Chrome/macOS (Apple M3). Still open: listening test, upload test, Chrome/Windows and Firefox/Linux |
| P1 Core | Play files and see both modes | SRC-01/02, PL-01–03, TR-01/02, AN-01–05, VE-01–05, KA-01/02, KA-05–08, LS-01, LS-05–09, LS-12–14, PR-01, DS-01, UI-01–03, NF-08. In three milestones: **M1** audio engine, queue, transport, analysis (done: SRC-01/02, PL-01–03, TR-01/02, AN-01–05, UI-01–03, NF-08; then analysis v2 with the live part of AN-07); **M2** Logo Spectrum (done: VE-01–03, VE-05, LS-01, LS-05–09, LS-12–14, PR-01, DS-01; ahead of plan: LS-10, most of LS-02 (blur, dimming), the bass zoom of LS-03, and LS-17); **M3** Kaleidoscope (done: KA-01, KA-02, KA-05–08, VE-04; ahead of plan: KA-03). **P1 is complete** |
| P2 Export | Render a track or an in/out range to MP4 | EX-01–04, EX-05 (whole track, in/out), EX-06/07, EX-15, TR-09, VE-09. **Done**; EX-02 covers the file's audio until P3 adds tempo and effects |
| P3 Player & FX | Cues, tempo, effects | TR-03–05, TR-08, TMP-01–04, FX-01–04, FX-06, FX-10, AN-06/07, PL-04/05, SRC-03–05, UI-04 |
| P4 Visual depth & video polish | More scenes, presets, overlays, multi-track export | KA-03/04, LS-02/03, LS-10/11, LS-15, LS-17/18, PR-02–04, VE-06–08, EX-05 (multiple tracks, playlist), EX-09/10, EX-14 |
| P5 Live input | Other apps / line-in | IN-01–04 (small, can be pulled forward). **Done**, pulled forward after P2 |
| Afterwards | Picks from C/L | by agreement |

Frame-rate independence (VE-03), determinism (NF-05) and timestamped actions (NF-08) are built in from P1. So the export needs no rewrite, and session replay (EX-13) stays possible. The other non-functional requirements (NF-01–07) apply to every phase.

## 6. Open questions

None right now. The next questions will come from the spike results on your machines.

## 7. Technical notes (constraints that shape features)

Details and library choices: [TECH-STACK.md](TECH-STACK.md).

- **Key lock (TMP-02):** the browser's built-in pitch preservation only works with simple media-element playback and cannot run offline. So we use our own time-stretcher (Signalsmith Stretch) in the audio engine; it sounds the same live and in the export.
- **Memory (Q3):** decoding a whole file costs about 1.3 GB of RAM per hour of stereo audio. For files up to 3 hours we decode in chunks instead.
- **Render time (EX-15):** a 3-hour video at 60 fps has 648,000 frames. At 30 rendered frames per second that takes 6 hours, hence resumable segments.
- **Export (EX):** encoding uses WebCodecs; Mediabunny writes the MP4. Codec support differs by browser and OS, so we detect it; a WebAssembly AAC encoder covers browsers without one. Writing straight to disk needs the File System Access API (Chromium only). Other browsers write to the Origin Private File System first and then download.
- **Background tabs:** rendering runs in Web Workers (OffscreenCanvas), so an export keeps going while the tab is hidden. A wake lock keeps the machine awake.
- **System audio (IN-02):** capturing other apps through the share dialog depends on browser and OS. Chromium can capture tab audio everywhere, but full system audio only on some systems. A virtual audio device works everywhere.
- **Latency (AN-06):** Bluetooth output adds 100–300 ms. Without compensation, the visuals run ahead of the sound.

## 8. Decision log

| Date | ID | Decision |
|---|---|---|
| 2026-09-25 | Q1 | Primary use: producing videos for YouTube and TikTok. Export moved up to P2. Raised: 9:16 (VE-09), in/out clips (TR-09), text overlay (LS-18), thumbnails (EX-10), batch export (EX-09), chapters (EX-14). Lowered: live-VJ extras (DS-02, DS-03, DS-04, UI-05) |
| 2026-09-25 | Q2 | Desktop first; mobile is not a v1 target |
| 2026-09-25 | Q3 | Files up to 3 h must work: streamed decoding, bounded memory, resumable renders (NF-06, EX-15) |
| 2026-09-25 | Q4 | v1 exports tracks/playlists with fixed settings plus preset auto-switching. The architecture is prepared for session replay (NF-08; EX-13 later) |
| 2026-09-25 | Q5 | Two modes as ready-made templates on an internal layer stack (VE-08) |
| 2026-09-25 | Q6 | Tempo range up to ±50 %, key lock from the start, no reverse playback |
| 2026-09-25 | Q7 | Gapless transitions in v1 (PL-05); crossfade later (PL-06 → L) |
| 2026-09-25 | Q8 | The DJ filter is the first additional effect (FX-06 → S); other effects split into FX-09 |
| 2026-09-25 | Q9 | The queue survives reloads (SRC-05 → S). Chromium keeps file access; other browsers need the files picked again. Cues and settings always persist |
| 2026-09-25 | Q10 | No MilkDrop/Butterchurn presets in v1 |
| 2026-09-25 | Q11 | MP4 (H.264 + AAC) is the main format; presets YouTube 1080p60, YouTube 4K30, TikTok/Shorts 1080×1920 |
| 2026-09-25 | Q12 | Round logo in v1; free-form logos later (LS-20) |
| 2026-09-25 | Q13 | No constraints on tech or hosting; stack proposal in [TECH-STACK.md](TECH-STACK.md) |
| 2026-09-25 | Q14 | Main render machine: Chrome on macOS. Second priority: Chrome on Windows, Firefox on Linux (NF-02) |
| 2026-09-25 | Q15 | Tempo and reverb are meant for "slowed + reverb" / "sped up" edits: one-click presets (FX-10 → M) |
| 2026-09-25 | Q16 | Tech stack accepted as proposed, with Svelte 5 for the UI |
| 2026-09-25 | P0 | All spike criteria met on Chrome/macOS (Apple M3); the stack carries. Details in [TECH-STACK.md §5](TECH-STACK.md#5-spikes-p0) |
| 2026-09-25 | P1 | Order: M1 engine and queue → M2 Logo Spectrum → M3 Kaleidoscope; one pull request into `main` per milestone. The engine runs at a fixed 48 kHz; files are converted in the media worker |
| 2026-09-25 | P5 | Live input done, pulled forward before P3/P4 (IN-01–04). An audio input (voice processing off) or the audio of a tab or the screen (via the share dialog) becomes the engine's source: the AudioWorklet analyses its input instead of the file, so all visuals and the analysis view work unchanged. Since the music is heard directly, the renderer shows the newest analysis frame instead of waiting for the output latency. Input gain and a level meter (IN-03); monitoring (IN-04) is off by default and again for every new source. The Live tab explains virtual audio devices for other apps (BlackHole, VB-Cable, PipeWire). Tested with Chromium's fake devices (a WAV file as the microphone, fake screen-share audio) |
| 2026-09-25 | P2 | Video export done (EX-01–07, EX-15, TR-09, VE-09). It runs in its own worker in two passes: the audio pass decodes the range like the live engine, stores the analysis and encodes the audio; the video pass renders frame n at time n / fps from the stored analysis, with the same code as the live view. Video is encoded in segments (at most five minutes, at least three per export); after each one the scene's state is saved, so a resumed export continues bit-exactly (checked: all packets identical to an uninterrupted export). The segments and the audio are joined without re-encoding, straight into the file you pick (Chromium) or into browser storage for a download. Presets, custom formats (aspect ratio, size, 24–60 fps) and three quality levels based on YouTube's upload bitrates; the stage is letterboxed to the video's aspect ratio, with safe-area guides. Tested with VP9 + Opus (development container, no H.264 there) and H.264 + AAC (CI); the main machine is still to be confirmed |
| 2026-09-25 | M3 | Kaleidoscope mode done, and with it P1. Each scene declares typed parameters, which become shader uniforms and UI controls automatically (KA-01). There are two scenes: Vortex (KA-02) and, ahead of plan, Crystal Mandala (KA-03). The feedback runs in fixed steps of 1/60 s in half-float buffers, and the display interpolates between the last two steps, so it looks the same at any frame rate and in the export. The content carries a palette position, so palettes, your own gradients and hue cycling apply at once (KA-07). Kicks and beats trigger one-step pulses (rings, stars), and every fourth beat steps the colours (KA-08). Neon Ribbons (KA-04) stays for P4; more scenes (KA-10) come after v1.0 |
| 2026-09-25 | M2 | Logo Spectrum mode done. It renders with WebGL2 in a worker (OffscreenCanvas) and reads the analysis at the moment you hear. It uses float buffers, bloom and dithering. All motion is based on real time, so it looks the same at 30, 60 or 144 fps. The mode comes with eight built-in presets plus your own; background and logo images persist in the browser (Origin Private File System). Colour tint (LS-02), camera shake and drift (LS-03), and ring styles (LS-11) stay open |
| 2026-09-25 | AN | Kick, snare and hi-hat were "hit and miss". Measured on a synthetic EDM mix and on real recordings (MDB Drums), then rebuilt as analysis v2 with a live beat tracker (AN-07, live part). Real recordings: kick 57 → 71 %, hi-hat 65 → 73 %, beat 79 %; details in [ANALYSIS.md](ANALYSIS.md). Next steps for accuracy: whole-track analysis for files (AN-07) and stem separation (AN-10) |
