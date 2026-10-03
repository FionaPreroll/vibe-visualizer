# Vibe Visualizer — Feature List

> **Status:** v0.16 (2026-10-03). The answers to Q1–Q18 are applied (see [§8 Decision log](#8-decision-log)), and the P0 spikes passed on the main target machine. The tech stack is in [TECH-STACK.md](TECH-STACK.md); drum detection and beat tracking are described in [ANALYSIS.md](ANALYSIS.md); DJ controllers are in [CONTROLLERS.md](CONTROLLERS.md).

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
| TR-06* | C | Beat-quantised cues: markers and cues snap to the beat when set (done); jumps that wait for the next beat (open) |
| TR-07* | C | Loops: A–B loop and beat loops |
| TR-08* | S | Zoomable detail waveform around the playhead for precise cue and in/out placement (important for long mixes) |
| TR-09* | M | In/out markers that define the part of a track that plays and exports, e.g. a 30-second TikTok clip (keys I/O, shown on the timeline, draggable). The queue moves on at the out marker |
| TR-10* | S | Two waveform styles: three bands as layers (lows blue, mids orange, highs white, as Rekordbox's "3Band") or one shape coloured by the bands (RGB); switched in the detail waveform |
| TR-11* | S | Beat grid correction per file in the detail waveform, as Rekordbox's grid edit: the beat at the playhead starts its bar, the bars a beat earlier or later, the grid a few milliseconds earlier or later, or Shift+drag to move it; kept per file |

### 3.4 Tempo (TMP)

| ID | Prio | Feature |
|---|---|---|
| TMP-01 | M | Speed up / slow down: tempo fader with selectable range (±8 %, ±16 %, ±50 %) and reset; no reverse playback (Q6) |
| TMP-02 | M | Two modes: **Vinyl** (pitch follows speed) and **Key lock** (pitch stays, via high-quality time-stretching); both from the start (Q6) |
| TMP-03* | S | Fine steps and temporary pitch bend (nudge) via buttons/keys |
| TMP-04* | S | BPM display (detected BPM × tempo factor; requires AN-07) |
| TMP-05* | C | Key shift in semitones, independent of tempo |
| TMP-06* | S | Tempo correction per track: double, half, 3/2 or 2/3 of the detected tempo, for tracks the beat grid reads at a related tempo; hold one of the tempos the grid has for the whole track, type a tempo or tap it; kept per file |
| TMP-07* | C | Tempo correction per section, for mixes: e.g. × 1.5 only between the markers |

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
| FX-09* | C | More FX: flanger/phaser, bitcrusher (the 3-band EQ became FX-11) |
| FX-10* | M | One-click presets for popular edits: "Slowed + Reverb", "Sped up", "Nightcore". They set tempo mode, rate and FX, and everything stays adjustable (Q15) |
| FX-11* | L | 3-band EQ with kills (an isolator, as on a DJ mixer), live and in the export; for DJ controllers (CTL-02, Q18) |

### 3.6 Live input (IN)

| ID | Prio | Feature |
|---|---|---|
| IN-01 | S | Browser audio input as a source (line-in, microphone, virtual device) with a device picker. The browser's voice processing (echo cancellation, noise suppression, auto gain) is switched off so music stays clean |
| IN-02 | S | Audio from other apps: tab/system audio via the browser's screen-share dialog where supported; in-app help for virtual audio devices (e.g. BlackHole, VB-Cable, PipeWire) |
| IN-03* | S | Input gain and level meter |
| IN-04* | S | Monitoring (hearing the input through the app) is off by default to avoid feedback loops; it can be switched on |
| IN-05* | S | Tempo of the live input: double, halve, hold, type or tap it, as for a track; the live beat tracking keeps within ±20 % of it until set back to automatic. The tempo range (AN-12) applies to live input too |
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
| AN-07* | S | Tempo (BPM) and beat-phase tracking: live (analysis v2), and for files a beat grid pre-computed in the background that follows tempo changes within long mixes. A single track keeps one tempo (stretches at a related tempo are brought to the main one) and, with a fixed tempo, gets a straight grid; where the grid changes tempo, the queue shows each tempo ("178 · 119") and the timeline marks the changes |
| AN-08* | C | Build-up/drop detection, e.g. to trigger preset changes or effects |
| AN-09* | C | Choose whether the visuals react to the signal before or after the FX |
| AN-10* | L | Stem separation (drums / bass / vocals) with on-device ML for more precise reactions. Heavy; mainly useful for offline rendering |
| AN-11* | S | Bars: the downbeats in the beat grid of a file (bars of four), shown as bar lines in the detail waveform; the basis for visuals that follow the bars |
| AN-12* | S | Tempo range of the analysis, for all tracks without a tempo set by hand, as in DJ software: automatic, 60–120, 90–150 or 120–200 BPM (drum & bass reads at its tempo in 120–200) |
| AN-13* | L | Neural beat and downbeat tracking, e.g. "Beat This!" (ISMIR 2024, MIT licence) with ONNX Runtime Web in the analysis worker: more robust beats, tempo octave and bars across genres, for a few MB of model and a few seconds per track |

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
| LS-12 | M | Logo upload (PNG/SVG/JPG/WebP) with a circular crop: pan and zoom inside the circle. The default logo shows the app's name in a script font, drawn anew when the app is renamed |
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
| UI-05* | L | MIDI controller support: see [§3.16](#316-dj-controllers-ctl) (CTL) |
| UI-06* | C | Backup file: save and restore everything the app keeps (settings, presets, cues, images), with or without the track analysis. The queue stays out: browsers cannot hand its files on |
| UI-07* | L | Installable app (PWA) that works offline |
| UI-08* | S | Undo for removals and deletions (queue, cues, markers) |
| UI-09* | S | The app's displayed name can be changed in the app (default "FibeStation") |
| UI-10* | S | Welcome at the first start: what the app does in three steps, that it is a work in progress (with the address for bug reports), the advice for browser and graphics card, and the warning about flashing visuals; the help shows it again |
| UI-11* | S | In-app help: the user guide by section (the same text as [USER-GUIDE.md](USER-GUIDE.md)), the keyboard shortcuts and a bug report; the ? in the top bar opens it, the ? key on the shortcuts |

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

### 3.16 DJ controllers (CTL)

Described in [CONTROLLERS.md](CONTROLLERS.md). Q18: the easy parts of the DDJ-FLX2 now (Controllers M1), the EQ later, deck 2 unused for now, a Pro edition later.

| ID | Prio | Feature |
|---|---|---|
| CTL-01* | S | Controller library: Web MIDI, a profile per device, semantic controls and lights, pickup for knobs and faders; a separate package, free of the app ([packages/dj-controllers](../packages/dj-controllers/README.md)) |
| CTL-02* | S | Pioneer DJ DDJ-FLX2, deck 1: play/pause, CUE as on a CDJ with the in marker as the cue point, hot cues 1–8 with lights (SHIFT deletes), CFX → DJ filter, tempo slider, channel fader → volume, jog wheel → seek (16× with SHIFT). Later: HI/MID/LOW (FX-11) |
| CTL-03* | S | DJ controller dialog: connect, the MIDI devices, what the controls do, and a MIDI monitor for checking a device; a controller connected before connects again at the start |
| CTL-04* | L | MIDI learn for controllers without a profile; profiles saved, exported and imported |
| CTL-05* | L | Visuals deck: the second deck controls the visuals (pads → presets, knobs → visual parameters, crossfader → a blend of two presets). For now deck 2 does nothing (Q18) |
| CTL-06* | L | Sound through the controller's sound card; headphone pre-listening once there are two decks (PL-06) |
| CTL-07* | L | HID controllers through WebHID |

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
| P2 Export | Render a track or an in/out range to MP4 | EX-01–04, EX-05 (whole track, in/out), EX-06/07, EX-15, TR-09, VE-09. **Done**; since P3 M1, EX-02 includes tempo and effects |
| P3 Player & FX | Cues, tempo, effects | TR-03–05, TR-08, TMP-01–04, FX-01–04, FX-06, FX-10, AN-06/07, PL-04/05, SRC-03–05, UI-04. In two milestones: **M1** tempo and effects (done: TMP-01–04, FX-01–04, FX-06, FX-10, and EX-02 with tempo and effects); **M2** cues and waveforms, queue and playlist, sync, beat grid and shortcut help (done: TR-03–05, TR-08, SRC-03–05, PL-04/05, AN-06/07, UI-04). **P3 is complete** |
| UX (before P4) | Usability for making videos and for DJing | TR-06 (snapping), TR-09 (play range), UI-08/09, and for DJing downbeats, BPM correction, two waveform styles. In four parts: **A** play ranges, snapping, draggable markers, undo, soft jumps, the app's name (done); **B** downbeats and bar lines, BPM correction, fast genres, waveform styles (done: AN-11, TMP-06, TR-10); **C** one tempo per track, straight grids, tempo ranges, grid correction, tempo changes shown (done: AN-07 in part, AN-12, TMP-06 extended, TR-11; noted: AN-13, TMP-07); **D** first look and help, the tempo of live input, a Firefox fix, README screenshots (done: IN-05, LS-12 default logo, UI-10, UI-11; proposed: CTL, Q18) |
| Controllers | The DDJ-FLX2 and a library for DJ controllers | **M1** the library and deck 1 of the DDJ-FLX2 (done: CTL-01–03). Later: FX-11 (EQ), CTL-04–07 |
| P4 Visual depth & video polish | More scenes, presets, overlays, multi-track export | In two milestones, the visuals first: **Visuals** (done) in four parts, **A** ring styles, camera shake, drift and tint (done: LS-02, LS-03, LS-11), **B** preset switching, browser and files (done: PR-02–04), **C** the Neon Ribbons scene (done: KA-04), **D** layers, reduce flashing and quality (done: VE-06–08); then **Videos** (done) in three parts, **A** track info on screen (done: LS-15, LS-18, and LS-19 with it), **B** the playlist as one video, with chapters and fades (done: EX-05, EX-14, and EX-16 with it), **C** batch export and thumbnails (done: EX-09, EX-10); then **Polish** after feedback on the preview (done: LS-16 as a record, UI-06, the Kaleidoscope behind with a look of its own (VE-08), presets with a Kaleidoscope behind, bar switching through breaks (PR-02)). Done ahead of plan: KA-03, LS-10, LS-16 in part, LS-17, UI-06 |
| P5 Live input | Other apps / line-in | IN-01–04 (small, can be pulled forward). **Done**, pulled forward after P2 |
| Afterwards | Picks from C/L | by agreement |

Frame-rate independence (VE-03), determinism (NF-05) and timestamped actions (NF-08) are built in from P1. So the export needs no rewrite, and session replay (EX-13) stays possible. The other non-functional requirements (NF-01–07) apply to every phase.

## 6. Open questions

None right now.

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
| 2026-09-29 | Q17 | A usability pass comes before P4. The in/out markers are the play range: the queue always moves on at the out marker. Both waveform styles (as now, and Rekordbox-style three bands) become selectable. An automatic beat-matched crossfade between queue tracks (PL-06, for DJ-style mixes) is postponed. The app shows the name "FibeStation" by default, and it can be renamed in the app; the project keeps its name |
| 2026-09-30 | Q18 | DJ controllers now, before P4: first the easy parts of the DDJ-FLX2 (play/pause, cue, hot cues, CFX, tempo, volume, jog), the 3-band EQ (FX-11) later. Deck 2 does nothing for now. A Pro edition is decided later |
| 2026-09-25 | P0 | All spike criteria met on Chrome/macOS (Apple M3); the stack carries. Details in [TECH-STACK.md §5](TECH-STACK.md#5-spikes-p0) |
| 2026-09-25 | P1 | Order: M1 engine and queue → M2 Logo Spectrum → M3 Kaleidoscope; one pull request into `main` per milestone. The engine runs at a fixed 48 kHz; files are converted in the media worker |
| 2026-09-30 | P4 | Not started yet. When it starts, the visuals come first (new scenes and styles, automatic preset switching, layers, presets as files), then the video features (playlists as one video with chapters, batch export, thumbnails, overlays, cover art) |
| 2026-09-30 | P4 Visuals A | Ring styles, motion and tint for the Logo Spectrum done (LS-02, LS-03, LS-11). The ring is a filled shape as before, or bars (round ends), lines (the outline of each colour layer) or dots, and grows outward, inward or both ways; bars and dots take the value at their middle, and stay visible in silence. The colour layers behind lag and reach further, so bars and dots get rainbow tips. The camera shakes on kicks (the whole picture, following the kick's envelope, with a zoom that keeps the edges out of sight; the same for the same time, so exports match), and the background drifts and zooms slowly (Ken Burns). The background can be tinted towards a colour, keeping its brightness. Three new presets: Neon Bars, Dot Matrix, Laser Lines |
| 2026-09-30 | P4 Visuals B | Automatic preset switching, favourites and preset files done (PR-02–04). The presets switch every so many seconds of music (5–300 s; silence does not count), every so many bars (1–64, of four beats from the beat tracking or the file's beat grid, not aligned to the downbeat), or on the drops: the low end (bass and kick) comes back strong after it was quiet for a stretch (a slow level over 8 s), then it rests for 16 s, at the start too. Next is the preset after it or a random other one, from all presets of the mode or its favourites (all while there are fewer than two). The morph (0–10 s) glides the numbers and blends the colours (palettes as their colours); what cannot glide (a style, a direction, a scene, a switch) changes halfway. The render worker switches and morphs on its own and tells the app, so the panel shows the preset; a preset you pick or a setting you change stays for a whole stretch. Exports switch the same way in the export worker, counting from the first frame of the video (not the pre-roll), and the switching's state goes into the segment snapshots, so a resumed export goes on switching where it stopped. Favourites are kept by name per mode (a star, and ★ in the list); the random button takes a favourite if there are two or more. Your presets of a mode go into a JSON file and come back from one (names that are taken get a number; files of the other mode or broken ones are refused with a message; settings are checked, with defaults for what is missing) |
| 2026-09-30 | P4 Visuals C | The Neon Ribbons scene done (KA-04). Neon tubes go around the centre, each a closed curve with the same lobes (5 by default); they are set off from each other, so they cross and weave over and under in turn: the depth along a tube follows its lobes, and at each point the nearer tube covers the farther. A tube is bright along its middle and darker to its sides, with a white highlight, and its far parts are darker and thinner (the depth setting). The tubes are drawn anew each step over the picture before, which flows outward: they leave short neon trails. Orange fractal blossoms (folded five ways, each petal with a smaller blossom at its tip, three levels) sit in the lobes and, larger, in the centre, and glow on the snare; small flowers float outward, each in its own sector of the circle (so a pixel looks at one flower only), and light up on the hi-hats. Kicks swell the wreath and let the ribbons breathe apart, and the bass opens the lobes. The wreath is drawn smaller in narrow frames (9:16). A new palette, Ribbons (pink, yellow, green, cyan), and four presets: Neon Ribbons, Ribbon Knot, Neon Mandala, Lava Braid. Measured on a synthetic drum track in headless Chromium: its brightness swings with the beat by about 0.04 of full brightness, about three times as much as the Vortex's, and it moves far more on the beat; it renders at about two thirds of the Vortex's frame rate in software rendering |
| 2026-10-02 | P4 Visuals D | Layers, reduce flashing and quality done (VE-06–08), and with them the Visuals milestone. The Logo Spectrum's background can show the Kaleidoscope, live, as it is set up in its own mode (VE-08): the Kaleidoscope draws first, without its bloom, into a picture the background shows, with darkening, tint, bass zoom and drift; in exports both scenes go into one snapshot, so resuming works as before. The layer stack of Q5 is kept to this: the two modes are not rebuilt as a general stack. Reduce flashing (VE-06), for the preview and exports: the picture (with its bloom) is reduced to a coarse grid (16 rows at 1080p), whose brightness has a settled level that rises at most 0.1 per second in linear light and falls quickly; where the brightness rises more than 0.03 above it, the picture is darkened. Measured in a deliberately flashy setup (Crystal Mandala at full reactivity and intensity), the largest rise of a screen area within a third of a second drops from 0.42 to 0.09, and no area rises by 0.1 or more any more (before: in a quarter of the frames); the welcome offers it too. Render scale and auto-quality (VE-07): the live visuals draw at 50–100 % of the screen's resolution; while the frame rate stays below 50 fps and three quarters of the best this screen reached for 3 s, the share goes down by an eighth, and after 20 smooth seconds (not within a minute of a step down) it goes up again, so a 30 Hz screen or a battery saver does not count as slow |
| 2026-10-02 | P4 Videos A | Track info on screen done (LS-15, LS-18, LS-19). Over both modes, live and in exports, the title and artist of the track playing, and on request a progress bar and the time (played and the length, at the tempo); six bundled fonts (OFL: Montserrat, Bebas Neue, Playfair Display, Space Mono, Pacifico, Orbitron), nine positions in the title-safe frame, colour and size. It fades in at the start of each track's part and out before its end, or after a while if it is not to stay. The names come from the tags, or else the file name; a track can be named in the queue (✎ or F2), kept per file, and the queue, the transport, the overlay and exports (the file name too) show those names. The Logo Spectrum can show the cover art of the track playing as its logo (tracks without one show the logo image). The analysis timeline now says which file (by the engine's token) the music of each frame comes from, so the overlay and the cover change exactly with the music heard, also at a gapless transition. In exports both are drawn by the export worker: the cover is kept with the job, and the overlay needs no state, so a resumed export shows them as before. Workers draw text only once its font is loaded: Chromium keeps the font it found for a CSS font in a worker, so text drawn before stays in the fallback font. The other parts of the Videos milestone are proposed: B the playlist as one video, joined as the player joins tracks (gapless, 10 ms crossfades at cuts; a DJ crossfade stays with PL-06), with chapters and fades; C batch export and thumbnails |
| 2026-10-02 | P4 Videos B | The playlist as one video done (EX-05, EX-14, and EX-16 with it). The export plays the whole track, the part between the markers, or tracks of the queue: all of them at first (untick to leave some out), in the order of the queue, each between its markers. They are joined as the player joins them; the media worker and the export now share the joiner, so the video hears the queue as the player plays it: file ends follow without a gap, a track that stops at its out marker crosses into the next in 10 ms, a track that starts at its in marker fades in over 10 ms. A DJ crossfade between tracks stays with PL-06 (Q17). The plan treats the tracks as one long range, so pre-rolls, segments and resuming stay as they were; the audio pass records where each track starts, from which the video pass knows the track heard at each frame (for the overlay and the cover art) and the chapters are made. Chapters: "0:00 Artist – Title" per line, at the nearest second, to copy or save as text; YouTube shows them only for three tracks or more, each at least 10 s long, and the dialog says when that is not so. Fades: none or 1, 2, 3 or 5 s, the picture from and to black (over the overlay too) and the sound with it, along a smoothstep curve. The file of a video of several tracks is named after the first ("Artist - Title and 2 more") |
| 2026-10-02 | P4 Videos C | Batch export and thumbnails done (EX-09, EX-10), and with them the Videos milestone and P4. A video of each track: under *Tracks of the queue*, the videos are made one after the other, each between its markers and named after its track (with a number where a name repeats). Chromium writes them into a folder you pick; other browsers keep them in browser storage (beside the export job, so the next video does not delete them), each with a download link, until the next export. A cancelled batch keeps the videos finished before; when a video fails, resuming it goes on with the rest. After a reload only the interrupted video resumes: the batch itself is not stored. The picture: the camera in the top bar (or C) saves the next frame of the stage as a PNG, scaled to 720 pixels on the shorter side (1280×720 for 16:9, as YouTube recommends for thumbnails; such a PNG is about 1 MB, under YouTube's 2 MB, where 1920×1080 would be over it). It is what the stage shows, overlay included, copied in the render worker from the frame just drawn; a picture at another resolution would have to draw the scenes again, which loses the Kaleidoscope's trails |
| 2026-10-02 | P4 Polish | Feedback on the preview done. **A record (LS-16, the vinyl part):** the logo or the cover art turns at 33⅓, 45 or 78 rpm by the music played since the last frame: at the tempo, standing while paused (once the position heard stood still for 50 ms), back and forth with the jog wheel, across a seek at the tempo; exports turn by the tempo per frame. Turned off, it eases back upright, the short way. **The Kaleidoscope behind (VE-08)** has a look of its own in the Logo Spectrum's settings (none, in older settings and presets: the Kaleidoscope mode's look). It starts as a copy of the Kaleidoscope mode's look, then is its own, so presets, preset files and the switching carry it; it morphs as the Kaleidoscope does when both looks have one, else it changes halfway. The Visuals panel sets it up within the Logo Spectrum, with the Kaleidoscope's controls and presets (not its switching), so it can be changed during live input without leaving the mode. **Six built-in presets with a Kaleidoscope behind** (Mandala Core, Ember Record, Bloom Halo, Ribbon Lines, Aurora Disc, Lava Bars), all three scenes among them, with few particles and no drift in front of the moving background, so the switching mixes both kinds of looks. **Bar switching (PR-02)** sometimes did nothing: bars were counted on the beats heard only, and a break without beats (or below the grid's confidence) has none. Now the count runs on at the tempo (the beat tracker's, else 120 BPM) and snaps to each beat heard; without one it switches half a beat after the bar line. **Backup (UI-06):** one JSON file with the app's entries in localStorage as stored (settings, presets, favourites, export options, and the cues, markers, tempos, grid corrections and names of each file), the background and logo images, and, if chosen, the files of the track analysis (base64; about 0.3 MB for five minutes of music). Not in it: the music files and the queue (file handles cannot go into a file) and videos. A restore checks the file first (damaged data and newer versions are refused), says what is in it, writes the images and the analysis (the analysis already there stays: it is the same for the same file), stops the running app from storing, replaces the entries (all or none) and reloads |
| 2026-10-03 | Fixes | From the to-do list after the polish. **Quiet intros (AN-05):** the camera shake and the bass zoom swung too far in a quiet start of a track, because the auto-gain's reference only knew the quiet part and made it as big as the drop. The analysis of a file now also measures how loud it gets: for the loudest spectrum band, the energy and each band, the level 95 % of the frames with sound stay below. It is kept in the cache, whose format is now version 4, so every track is analysed once more. While a file plays and in its exports, the auto-gain starts at these levels and does not fall below them, and a kick is as strong as the low end is loud at its onset. On a techno groove at −24 dB before the same at full level, the intro's bass falls from 0.65 to 0.05 and its kicks from 0.82 to 0.22, while the drop stays as it was; in the browser, the ring covers less than half as many pixels in the intro as in the drop, instead of as many. Live input keeps the auto-gain alone. Until a file's loudness is known (its first seconds, while it is analysed), the camera of the Logo Spectrum does not shake or zoom with the bass, and eases back in once it is. **Dialogs:** a drag that starts inside a dialog (selecting text in a field) and ends on the backdrop no longer closes it; a click on the backdrop still does (the rename, help and controller dialogs). **Controller dialog:** what the controls do was in the dialog and in the help; now it is only in the help, which a button in the dialog opens at the DJ controller. A logo left turned after switching to a preset without the spin was already fixed in the polish |
| 2026-09-30 | Cleanup | After Controllers M1. The playhead follows the jog wheel smoothly: the player scrubs, so the playhead is where the jog wheel puts it at once, and the music follows at most every 60 ms; the media worker lets a newer seek in within milliseconds instead of after filling the ring. A seek right after which the resampler gives nothing yet (it needs 64 frames of the file first) no longer counts as the end of the file: it jumped to the next track, about one seek in 30. A reload no longer hangs now and then (about 4 % after the audio had started): Chromium sometimes hung tearing the render worker (WebGL in a worker) down with the page, so the app stops its workers and the audio on pagehide. The Crystal Mandala reacts about as much as the Vortex, measured on a drum track: the star swells and glows with the kick, kicks push the tunnel, the shards flash on snare and kick, more sparks on the hi-hats, shorter trails |
| 2026-09-30 | Controllers M1 | DJ controllers done for the DDJ-FLX2's deck 1 (CTL-01–03). The library is a pnpm workspace package without dependencies ([packages/dj-controllers](../packages/dj-controllers/README.md)): Web MIDI with controllers found by their port name, also when plugged in later; a profile per model as plain data; events by what a control does (buttons, knobs from 0 to 1 with 14 bits, jog movements), SHIFT per deck and the pad modes the controller switches itself; lights sent only when they change, blinking on one timer; pickup, so a knob or fader does nothing until it reaches the app's value. The DDJ-FLX2's profile follows AlphaTheta's MIDI message list; the open Mixxx mapping served as a check of it, not as a source. Deck 1: PLAY/PAUSE (lit while playing, blinking while paused), CUE, hot cues 1–8 on the pads (SHIFT deletes; the pads of set cues are lit), CFX → DJ filter, tempo slider → tempo within its range, channel fader → volume, jog wheel → seek (a turn of its top is 1.8 s, like a record; 16 times as far with SHIFT), so that jog wheel and pads set cues exactly. CUE works as on a CDJ, with the in marker as the cue point: paused, it sets the in marker at the playhead; held at the cue point, it plays until let go; while playing, it goes back to the cue point and pauses. A dialog connects it, lists the MIDI devices and has a MIDI monitor; a controller connected before connects again at the start while MIDI stays allowed. Tested against a stand-in for Web MIDI, and checked on a real DDJ-FLX2: every mapped control works. After that check, the jog wheel seeks instead of nudging (with one deck there is nothing to nudge against), and moving a fader no longer slows the app down: knobs and faders are passed on once per frame, and two effects (drawing the default logo, the timeline's waveform) no longer run with every change of the state, only with the values they draw (main thread per fader step 25 → 5 ms in the test, without long tasks). Also: the reverb of Slowed + Reverb has a mix of 7 % instead of 35 %, which was far too much in the listening test |
| 2026-09-30 | UX D | First look, help, the tempo of live input and a Firefox fix done (IN-05, LS-12 default logo, UI-10, UI-11). The default logo shows the app's name in Pacifico (SIL Open Font License, bundled, so no font request leaves the app) with the app's gradient; it is drawn anew when the app is renamed and goes into exports like an uploaded logo. The default preset is Classic Rainbow with the Twitchy responsiveness (chosen over Twitchy Toxic). The photosensitivity notice became a welcome at the first start: three steps, a work in progress with the address for bug reports (kept in package.json), Chrome and a good graphics card recommended, and the warning about flashing visuals. The help shows the user guide by section from docs/USER-GUIDE.md, the same text as on GitHub, so it has one source. The BPM next to the LIVE badge corrects the tempo of live input like a track's: the live beat tracker keeps within ±20 % of the chosen tempo until set back to automatic, and the tempo range applies to it too. Its candidate tempos now span 50–250 BPM, of which a range uses a part; the default range is unchanged (live beat F1 on MDB Drums 79.0 % as before). Firefox: while one track played, another could not be read ("Error in input stream"); files are now read in slices there instead of through a stream reader (confirmed in Firefox). The README shows screenshots that a workflow takes anew when run by hand. For DJ controllers there is a proposal: the DDJ-FLX2 and a generic library ([CONTROLLERS.md](CONTROLLERS.md), Q18) |
| 2026-09-30 | UX C | One tempo per track, straight grids, tempo ranges and grid correction done (AN-07 in part, AN-12, TMP-06 extended, TR-11). A single track (a file up to 15 minutes) keeps one tempo: stretches at half, 2/3, 3/4 of its main tempo or the inverse are brought to it (Pegasus 77 no longer switches between 178 and 119 BPM). A track with a fixed tempo gets a straight grid: the period and phase with the most sure beats within a tenth of a beat, if at least 70 % of them lie on it; stretches where the beats followed the offbeat no longer bend it. The analysis has a tempo range for all tracks, as in DJ software (automatic, 60–120, 90–150, 120–200 BPM). A new evaluation on electronic music, whose tracks stay local ([ANALYSIS.md](ANALYSIS.md#5-evaluation)): on four drum & bass tracks and one electronica track, the range 120–200 finds all five tempos with straight grids; the automatic range finds two, and reads the other three at 2/3 or half (their snares show no backbeat in the snare band). MDB Drums improves (beat grid F1 87.2 → 88.4 %, bars 342 → 358). The BPM menu can hold one of the tempos the grid has, take a tempo typed or tapped, and choose the tempo range. The detail waveform corrects the grid: beat 1 here, the bars a beat earlier or later, 5 ms (1 ms with Shift) earlier or later, Shift+drag; the correction is kept per file as a shift and a downbeat time, so it holds when the grid is computed anew. Where a grid changes tempo, the queue shows each tempo ("150 · 120") and the timeline marks the changes. The track "Hanomag (V2)" is listed at 86 BPM on Beatport, but its onsets repeat at 137.2 BPM (a sixteenth-note grid, no periodicity at 86); it is counted at 137 until checked by ear. Noted for later: a neural beat tracker (AN-13) and a tempo per section for mixes (TMP-07) |
| 2026-09-30 | UX B | Bars, tempo correction, fast genres and waveform styles done (AN-11, TMP-06, TR-10). The beat grid checks its tempo against the snares: double or 3/2 of it wins where it puts them clearly on the second and fourth beat, so drum & bass and hardcore are no longer read at half (slower tempos are not tried: half-time and swing fool the check). Each beat gets its place in a bar of four, from the changes of harmony (a coarse spectrum kept every four frames) and from kick and snare, decoded over the whole track: right on all genre patterns, and on 342 of 493 downbeats of MDB Drums (16 of 23 tracks throughout; [ANALYSIS.md](ANALYSIS.md#4-beat-grid-for-files)). The BPM in the queue opens a menu to double, halve, × 1.5 or ÷ 1.5 the tempo, or to go back to the one found; the grid is computed anew around it from features the worker keeps in memory, and the tempo is kept per file. Waveforms in three bands (lows blue, mids orange, highs white, each band scaled to its own loud parts) are the new default; RGB stays selectable. The detail waveform draws bar lines. The bars are not yet in the export's analysis: visuals that follow the bars come with P4 |
| 2026-09-29 | UX A | Play ranges, snapping, undo and the app's name done (TR-06 in part, TR-09, UI-08/09). The media worker decodes each file only from its in to its out marker and cuts there with a 10 ms equal-power crossfade into what follows (the next track from its in marker, or the same part again with repeat one); a start in the middle of the music without a cut before it fades in. File ends still join without any crossfade, so gapless albums stay intact. Moving the out marker while the track plays reaches the stream; if the stream has taken the audio beyond already, it restarts at the current position. Pause, resume and jumps no longer cut hard: the music fades out over 5 ms on pause and in on resume, and after a jump the old part plays on for 8 ms, fading out under the new one. Markers and cues snap to the nearest beat when set or dragged (only within half a beat, and only where the beat is clear; Q switches it off); the markers can be dragged on the timeline and in the detail waveform and moved by a beat with the arrow keys. Removing tracks, clearing the queue, deleting cues and clearing markers can be undone for 8 s. The Spike Lab link shows only on the development server |
| 2026-09-29 | P3 M2 | Cues and waveforms, queue and playlist, sync, beat grid and shortcut help done, and with them P3 (TR-03–05, TR-08, SRC-03–05, PL-04/05, AN-06/07, UI-04). A worker analyses each file in the background at its own sample rate: a waveform (200 columns per second, peak and three bands, about 2.9 MB per hour) and a beat grid, both cached in the Origin Private File System under a fingerprint of the file (SHA-256 of its size and three samples of 256 KB). Cues and markers are kept under the same fingerprint, so they come back with the file. The timeline shows the waveform with the cues; the detail waveform (2–64 s) adds beats and markers; eight hot cues by pad or key. The beat grid (tempo path by Viterbi, beats by dynamic programming, a confidence per beat) replaces the live beat tracking for files, live and in the export: beat F1 on real recordings 79 → 87 % ([ANALYSIS.md](ANALYSIS.md#4-beat-grid-for-files)). Gapless playback: the media worker runs from one file into the next within one stream; the player tells it which file follows the heard one, and the stream takes that answer only 1.5 s before it needs it, so editing the queue until then needs no restart (a later edit restarts the stream at the current position, with a short dip like a seek). Checked in the browser: no drop in level at the boundaries, also between 44.1 and 48 kHz files, with repeat one and all, and after a seek or a pause just before the end. Shuffle plays every track once per round, and "previous" goes back through what was played. Folders are read in natural order, a folder's own files before its subfolders, and sorted by disc and track number once probed. The queue is kept in IndexedDB; in Chromium with the file handles that the pickers and drops give (after a browser restart one click asks for access again), elsewhere without files: adding a file again matches its entry by name and size. A/V sync: the visuals follow the output timestamp, which includes the latency the browser reports, plus an offset of −200…+500 ms, set with a slider or a calibration (a tick every second and a flash); live input and exports are not affected. "?" shows all shortcuts; new: S shuffle, R repeat, V the next visual mode, [ and ] the presets |
| 2026-09-29 | P3 M1 | Tempo and effects done (TMP-01–04, FX-01–04, FX-06, FX-10, EX-02). One sound chain in plain TypeScript runs in the AudioWorklet and in the export, in the same 128-frame blocks: tempo (vinyl: windowed-sinc resampling that filters out what would alias when faster; key lock: Signalsmith Stretch, primed so that it starts exactly at the play position) → DJ filter → delay → reverb (an 8-line feedback delay network) → safety limiter (2 ms look-ahead). Changes glide, switched-off effects ring out, and paused playback lets the tails ring out too. The visuals react to the music between the filter and the delay: echoes and reverb tails would blur the beats and feed a synced delay's echoes back into its own tempo (AN-09 may make this a choice). When the tempo changes, the beat tracker re-times its history, so the beat and the BPM display follow at once instead of after about 5 s. Presets: Slowed + Reverb (85 %, with a 0.7 s reverb; the first version's 5 s was too long in the listening test), Sped up (120 %), Nightcore (130 %). The export plans in output time: a slowed-down track makes a longer video, and a preset's name goes into the file name. Exports started before this update resume unchanged |
| 2026-09-29 | AN | Live input over several songs: kick, snare and hi-hat detection do not degrade from song to song (measured on all MDB tracks as one stream). After a tempo change, however, the beat tracker needs 4–7 s to lock on, sometimes up to 20 s: it first settles on a related tempo (2/3 or 3/2 of the new one), which explains the onsets almost as well. Two quick fixes (dropping the tempo history when the current tempo is not supported, or when the beat confidence stays low) did not help, so this goes to a later analysis milestone: a tempo model that tells these related tempos apart. The Live tab now points out the audio toggle of the share dialog |
| 2026-09-25 | P5 | Live input done, pulled forward before P3/P4 (IN-01–04). An audio input (voice processing off) or the audio of a tab or the screen (via the share dialog) becomes the engine's source: the AudioWorklet analyses its input instead of the file, so all visuals and the analysis view work unchanged. Since the music is heard directly, the renderer shows the newest analysis frame instead of waiting for the output latency. Input gain and a level meter (IN-03); monitoring (IN-04) is off by default and again for every new source. The Live tab explains virtual audio devices for other apps (BlackHole, VB-Cable, PipeWire). Tested with Chromium's fake devices (a WAV file as the microphone, fake screen-share audio) |
| 2026-09-25 | P2 | Video export done (EX-01–07, EX-15, TR-09, VE-09). It runs in its own worker in two passes: the audio pass decodes the range like the live engine, stores the analysis and encodes the audio; the video pass renders frame n at time n / fps from the stored analysis, with the same code as the live view. Video is encoded in segments (at most five minutes, at least three per export); after each one the scene's state is saved, so a resumed export continues bit-exactly (checked: all packets identical to an uninterrupted export). The segments and the audio are joined without re-encoding, straight into the file you pick (Chromium) or into browser storage for a download. Presets, custom formats (aspect ratio, size, 24–60 fps) and three quality levels based on YouTube's upload bitrates; the stage is letterboxed to the video's aspect ratio, with safe-area guides. Tested with VP9 + Opus (development container, no H.264 there) and H.264 + AAC (CI); the main machine is still to be confirmed |
| 2026-09-25 | M3 | Kaleidoscope mode done, and with it P1. Each scene declares typed parameters, which become shader uniforms and UI controls automatically (KA-01). There are two scenes: Vortex (KA-02) and, ahead of plan, Crystal Mandala (KA-03). The feedback runs in fixed steps of 1/60 s in half-float buffers, and the display interpolates between the last two steps, so it looks the same at any frame rate and in the export. The content carries a palette position, so palettes, your own gradients and hue cycling apply at once (KA-07). Kicks and beats trigger one-step pulses (rings, stars), and every fourth beat steps the colours (KA-08). Neon Ribbons (KA-04) stays for P4; more scenes (KA-10) come after v1.0 |
| 2026-09-25 | M2 | Logo Spectrum mode done. It renders with WebGL2 in a worker (OffscreenCanvas) and reads the analysis at the moment you hear. It uses float buffers, bloom and dithering. All motion is based on real time, so it looks the same at 30, 60 or 144 fps. The mode comes with eight built-in presets plus your own; background and logo images persist in the browser (Origin Private File System). Colour tint (LS-02), camera shake and drift (LS-03), and ring styles (LS-11) stay open |
| 2026-09-25 | AN | Kick, snare and hi-hat were "hit and miss". Measured on a synthetic EDM mix and on real recordings (MDB Drums), then rebuilt as analysis v2 with a live beat tracker (AN-07, live part). Real recordings: kick 57 → 71 %, hi-hat 65 → 73 %, beat 79 %; details in [ANALYSIS.md](ANALYSIS.md). Next steps for accuracy: whole-track analysis for files (AN-07) and stem separation (AN-10) |
