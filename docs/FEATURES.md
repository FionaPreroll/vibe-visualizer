# Vibe Visualizer — Feature List

> **Status:** Draft v0.1 (2026-09-25). We refine this together before any code is written.

## How to use this document

- Every feature has an **ID** (e.g. `FX-02`), so we can discuss it in short form: "FX-06 → S", "drop TR-07", "Q4: a".
- **Priority:** **M** = Must (v1.0 core) · **S** = Should (v1.0, after the core) · **C** = Could (nice to have, if cheap) · **L** = Later (idea for after v1.0)
- `*` after an ID = a suggested addition that was not in the original brief. Veto freely.
- Open decisions are in [§6 Open questions](#6-open-questions). Agreed decisions go into [§8 Decision log](#8-decision-log).

## 1. Vision

Vibe Visualizer is a browser app that plays music (local files or live input) and turns it into high-resolution, audio-reactive visuals. It offers psychedelic, kaleidoscopic shader scenes ("like MilkDrop, but crisp HD/4K") and logo-centred circular spectrum visuals like those on music YouTube channels. You can watch the visuals live, optionally in fullscreen. Or you can render them offline into a video file with the audio in sync. The offline render goes frame by frame, so it works on slow GPUs too. Everything runs locally in the browser.

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
| SRC-05* | C | Remember the library across page reloads (see Q9) |
| SRC-06* | C | Bundled royalty-free demo track for trying the app without own files |

### 3.2 Playlist / queue (PL)

| ID | Prio | Feature |
|---|---|---|
| PL-01 | M | Queue with title, artist and duration; current track highlighted; automatic advance to the next track |
| PL-02 | M | Next / previous; double-click a track to play it |
| PL-03 | M | Reorder via drag & drop, remove, clear |
| PL-04* | S | Shuffle; repeat off / one / all |
| PL-05* | S | Gapless transitions |
| PL-06* | C | Crossfade between tracks (adjustable length) |
| PL-07* | C | Save/load named playlists |

### 3.3 Transport, seeking & cue points (TR)

| ID | Prio | Feature |
|---|---|---|
| TR-01 | M | Play/pause, stop; elapsed and remaining time |
| TR-02 | M | Seek by clicking/dragging on the timeline and via keyboard |
| TR-03* | S | Waveform overview of the whole track as the seek bar (computed in the background on load) |
| TR-04 | M | Hot cues: 8 per track. Set one at the current position, jump to it (recall) or delete it; colour-coded markers on the timeline |
| TR-05* | S | Cues are stored per track and survive reloads (tracks are recognised by a file fingerprint) |
| TR-06* | C | Beat-quantised cue jumps (requires AN-07) |
| TR-07* | C | Loops: A–B loop and beat loops |

### 3.4 Tempo (TMP)

| ID | Prio | Feature |
|---|---|---|
| TMP-01 | M | Speed up / slow down: tempo fader with selectable range (±8 %, ±16 %, ±50 %) and reset |
| TMP-02 | M | Two modes: **Vinyl** (pitch follows speed) and **Key lock** (pitch stays, via high-quality time-stretching) |
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
| FX-06* | C | More FX: DJ filter (one-knob low-pass/high-pass), 3-band EQ with kills, flanger/phaser, bitcrusher (see Q8) |
| FX-07* | C | Custom reverb impulse responses (upload a WAV) |
| FX-08* | C | Loudness normalisation between tracks (ReplayGain-like) |

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
| AN-03 | M | Beat/onset detection, roughly separated into kick / snare / hi-hat |
| AN-04 | M | Waveform data (time domain) for oscilloscope-style elements |
| AN-05* | M | Adaptive normalisation (auto-gain), so quiet and loud material both look lively |
| AN-06* | S | A/V sync offset that compensates output latency (e.g. Bluetooth headphones, 100–300 ms): auto-detected plus a manual slider |
| AN-07* | S | Tempo (BPM) and beat-phase tracking; for files, a beat grid is pre-computed in the background |
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
| VE-08* | S | Layer composition, e.g. a kaleidoscope scene as an animated background behind the logo spectrum (see Q5) |
| VE-09* | S | Aspect ratios 16:9, 9:16 (Shorts/Reels/TikTok), 1:1, 4:5, 21:9; the preview is letterboxed and shows safe-area guides |
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
| KA-11* | L | Run classic MilkDrop presets via the open-source Butterchurn engine: a huge library, but with the classic look (see Q10) |
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

**Particles & overlays**

| ID | Prio | Feature |
|---|---|---|
| LS-17 | S | Particles like the stars in the references: count, size, speed, direction (drift/outward), glow; speed and brightness react to the music |
| LS-18* | C | Text overlay: title/artist (from metadata, editable), font, position, fade-in at track start |
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
| DS-02* | S | Performance mode: visuals only, controlled by keyboard |
| DS-03* | C | Separate output window for a second screen or projector; the controls stay on the main screen |
| DS-04* | C | UI-less output view (via URL) for capturing in OBS |

### 3.13 Offline render / video export (EX)

| ID | Prio | Feature |
|---|---|---|
| EX-01 | S | Render to a video file frame by frame, independent of GPU speed. A slow machine just takes longer; the result is still smooth |
| EX-02 | S | The file's audio gets the same processing (tempo, FX), rendered offline and sample-accurately in sync |
| EX-03 | S | Settings: resolution (720p … 4K, custom), aspect ratio, frame rate (24/25/30/50/60), quality/bitrate; estimated file size |
| EX-04 | S | Formats: MP4 (H.264 + AAC) where the browser supports it; WebM (VP9/AV1 + Opus) as a fallback |
| EX-05* | S | Range: whole track, in/out between two cues, selected tracks, or the whole playlist as one video |
| EX-06 | S | Progress: percent, render speed (× real time), remaining time, preview image, pause/cancel; keeps the machine awake |
| EX-07 | S | Large files are written straight to disk while rendering instead of being held in memory (Chromium; other browsers go through browser storage) |
| EX-08* | C | Quality boosts only possible offline: supersampling, motion blur, more particles |
| EX-09* | C | Batch: every playlist track as its own video (e.g. for YouTube uploads) |
| EX-10* | C | Single frame as PNG (e.g. a thumbnail) |
| EX-11* | C | Audio-only export of the processed audio (WAV) |
| EX-12* | C | Quick real-time recording of what is on screen (only sensible on fast machines) |
| EX-13* | L | "Play live, render later": record a live session (cue jumps, tempo, FX, preset switches) and render it offline in HD (see Q4) |

### 3.14 UI, controls & persistence (UI)

| ID | Prio | Feature |
|---|---|---|
| UI-01 | M | Layout: visual stage in the centre, transport bar with timeline at the bottom, collapsible side panels (queue, visuals, FX) |
| UI-02 | M | Dark theme; UI language English |
| UI-03* | M | Settings persist across reloads (mode, preset, FX, …) |
| UI-04* | S | Keyboard shortcuts (space, arrows, 1–8 for cues, tempo, F for fullscreen, presets, …) with a help overlay |
| UI-05* | C | MIDI controller support (knobs → parameters, pads → cues/FX) |
| UI-06* | C | Project file: save/load everything (playlist, cues, presets, images) |
| UI-07* | L | Installable app (PWA) that works offline |

### 3.15 Non-functional requirements (NF): assumptions, please confirm

| ID | Prio | Requirement |
|---|---|---|
| NF-01 | M | 100 % client-side: no server, no upload, no account. Audio never leaves the machine; the app is hosted as a static website |
| NF-02 | M | Browsers: Chrome/Edge first; Firefox and Safari supported via feature detection (some features are Chromium-only, e.g. writing exports straight to disk) |
| NF-03 | M | Desktop first; mobile is not a v1 target (see Q2) |
| NF-04 | M | Performance: Mode B at 1080p60 on integrated graphics; Mode A scenes with quality levels; 4K on dedicated GPUs |
| NF-05 | M | Determinism: same audio + settings + random seed → identical frames, so the live view and the export look the same |
| NF-06 | M | Stable over hours of use; long files do not blow up memory (see Q3) |
| NF-07* | S | The UI is fully usable with the keyboard and has readable contrast |

## 4. Out of scope (for now)

- **Streaming services** (Spotify, Apple Music, YouTube, …): their audio is DRM-protected and cannot be analysed in the browser. Play it elsewhere and use live input (IN-01/02) instead.
- Server/cloud rendering, user accounts, cloud sync.
- Multi-deck DJ mixing (two decks with crossfader and sync).
- Direct live streaming (RTMP). Capture the app with OBS instead (DS-04).
- A video-editing timeline with keyframes (EX-13 covers the "performance" use case).

## 5. Roadmap proposal

| Phase | Goal | Features |
|---|---|---|
| P1 Core | Play files and see both modes | SRC-01/02, PL-01–03, TR-01/02, AN-01–05, VE-01–05, KA-01/02, KA-05–08, LS-01, LS-05–09, LS-12–14, PR-01, DS-01, UI-01–03 |
| P2 Player & FX | Cues, tempo, effects | TR-03–05, TMP-01–04, FX-01–04, AN-06/07, PL-04/05, SRC-03/04, UI-04 |
| P3 Visual depth | More scenes, presets, polish | KA-03/04, LS-02/03, LS-10/11, LS-15, LS-17, PR-02–04, VE-06–09, DS-02 |
| P4 Live input | Other apps / line-in | IN-01–04 (small, can be pulled forward) |
| P5 Export | Offline render to video | EX-01–07 |
| Afterwards | Picks from C/L | by agreement |

Frame-rate independence (VE-03) and determinism (NF-05) are built in from P1, so the export in P5 does not need a rewrite.

## 6. Open questions

| # | Question | Proposal |
|---|---|---|
| Q1 | Main use case: personal listening, producing videos (e.g. YouTube), or live VJ/party use (projector, MIDI)? | Your answer sets the priorities for DS-03, UI-05, EX-09 and others |
| Q2 | Desktop only, or should phones/tablets work too? | Desktop first |
| Q3 | Typical file length: single tracks (3–10 min) or also DJ mixes (1–3 h)? | If long mixes matter, we design for streamed decoding from day one |
| Q4 | Export: (a) track/playlist with fixed settings (plus preset auto-switching), or also (b) replaying a recorded live session (EX-13)? | (a) for v1, with the architecture ready for (b) |
| Q5 | Two fixed modes, or free layer composition (e.g. kaleidoscope behind the logo, VE-08)? | Two modes as ready-made templates, built on a layer stack so combinations come almost for free |
| Q6 | Tempo range: are ±8/16/50 % enough, or do you need extreme values (0.25×–4×, reverse)? | ±50 % max, key lock from the start, no reverse |
| Q7 | Track transitions: gapless only, or crossfade too (PL-06)? | Gapless in v1, crossfade later |
| Q8 | Which FX besides reverb and delay (FX-06)? | DJ filter first |
| Q9 | Should the queue survive a page reload (SRC-05)? Chromium can remember file access; other browsers would have to copy the files into browser storage. | Cues and settings: always. Queue: Chromium only, without copying files |
| Q10 | Classic MilkDrop presets via Butterchurn (KA-11)? | Not in v1; focus on our own HD scenes |
| Q11 | Export targets: MP4/H.264 as the main format? Most important resolutions and frame rates? Vertical 9:16? | MP4, 1080p60 and 4K30 as main presets, 9:16 included |
| Q12 | Is the logo always round, or can it also be a free-form PNG with transparency? | Round in v1, free-form later |
| Q13 | Any tech preferences or constraints (framework, hosting)? | If none, I propose a stack in the next step |

## 7. Technical notes (constraints that shape features)

- **Key lock (TMP-02):** the browser's built-in pitch preservation only works with simple media-element playback. Sample-accurate cues, offline rendering and better quality need our own time-stretcher in an AudioWorklet (candidates to evaluate: Signalsmith Stretch, SoundTouch).
- **Memory (Q3):** decoding a whole file costs about 1.3 GB of RAM per hour of stereo audio, so long mixes need chunked decoding.
- **Export (EX):** encoding uses WebCodecs plus a muxer (candidate: Mediabunny). Codec support differs by browser and OS (e.g. AAC encoding is not available everywhere), so we detect support and fall back to WebM/Opus. Writing straight to disk needs the File System Access API (Chromium only). Other browsers write to the Origin Private File System first and then download.
- **Background tabs:** rendering runs in a Web Worker (OffscreenCanvas), so an export keeps going while the tab is hidden. A wake lock keeps the machine awake.
- **System audio (IN-02):** capturing other apps through the share dialog depends on browser and OS. Chromium can capture tab audio everywhere, but full system audio only on some systems. A virtual audio device works everywhere.
- **Latency (AN-06):** Bluetooth output adds 100–300 ms. Without compensation, the visuals run ahead of the sound.

## 8. Decision log

_Empty so far. Agreed decisions are recorded here with date and question/feature ID._
