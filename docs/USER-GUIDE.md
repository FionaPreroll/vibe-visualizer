# User guide

How to use FibeStation. The same guide opens in the app: click **?** in the top bar.

## Getting started

FibeStation turns music into visuals: a logo with a spectrum ring, or kaleidoscopic tunnels, all following the beat. Watch them live, go fullscreen for a DJ set, or render a video for YouTube or TikTok. Everything runs in your browser: nothing is uploaded.

1. **Add music.** Drop audio files or whole folders onto the window, or click **Add files** (the folder button next to it adds a folder). MP3, M4A, FLAC, Ogg, Opus and WAV work; several files make a queue. Double-click a track to play it, and press **Space** to pause.
2. **Pick a look.** The top bar switches between *Logo Spectrum*, *Kaleidoscope* and *Analysis*. The **Visuals** tab in the side panel has presets and every setting, and takes your own logo and background.
3. **Make a video or play live.** **Export** in the top bar renders a video of the track, or of the part between two markers. **F** shows the visuals in fullscreen.

To visualise music from somewhere else (a DJ mixer, another app or a browser tab), use the **Live** tab instead of the queue.

The app is called *FibeStation* until you rename it: double-click the name in the top bar. The default logo shows the name too.

It works best in Chrome or Edge on a computer with a good graphics card, above all for the Kaleidoscope. Firefox works too; in Firefox the queue's files have to be added again after a reload.

## Queue and playback

- **Playing:** double-click a track, or select it and press **Enter**. Space plays and pauses, **N** and **P** go to the next and previous track, the arrow keys jump 5 s (30 s with Shift).
- **Order:** drag tracks to reorder them (or **Alt+↑** and **Alt+↓**). Folders are read with their subfolders and sorted by track number, or else by file name, so "2 …" comes before "10 …".
- **Gapless:** tracks follow each other without a gap, also between files with different sample rates.
- **Shuffle and repeat:** the buttons next to Stop (or **S** and **R**): shuffle plays every track once per round; repeat plays the queue again, or the track.
- **After a reload** the queue and the current track are still there. In Chrome and Edge the files come back too (after a browser restart, click **Allow** once in the queue); other browsers keep the entries, and adding the files or their folder again brings them back, with their cues.
- **Undo:** removing a track, clearing the queue, deleting a cue or clearing markers shows an *Undo* button for a few seconds (or press **Ctrl+Z**, **Cmd+Z** on a Mac).

## Waveforms, cues and markers

- **Timeline:** the transport bar shows the track's waveform, computed in the background, also for mixes of several hours. Click or drag it to seek.
- **Detail waveform:** above the transport (**W** switches it on and off), a few seconds around the playhead with every beat, and a stronger line on the first beat of each bar. Drag it to seek, scroll to zoom. The button in its corner switches the style: *3 bands* (lows blue, mids orange, highs white, as in Rekordbox) or *RGB*.
- **Hot cues:** eight per track. Press **1**–**8** (or click a pad) to set a cue where it is empty or to jump to it; **Shift+1**–**8** deletes it.
- **In and out markers:** press **I** and **O** (or the bracket buttons next to Stop) to mark the part of a track that plays and exports, such as a 30-second clip. A track from the queue starts at its in marker, and at its out marker the next one follows, crossing over in 10 ms so the cut does not click. With *repeat the track*, the part loops. Drag a marker on the timeline or in the detail waveform; with a marker focused, **←** and **→** move it by a beat. The chip next to the buttons shows the part and its length; click it to clear the markers.
- **Snap to the beat:** the magnet button (**Q**), on by default, puts markers and cues on the nearest beat when you set or drag them.
- Cues and markers are kept per file and come back whenever you add the file again.

## Beat grid and tempo

Each file is analysed as a whole in the background. The visuals then follow its beats and its tempo instead of guessing them live, and the grid knows where the bars start. A single track keeps one tempo, and a track with a fixed tempo gets a straight grid, as in DJ software; a long mix keeps its tempo changes.

- **The BPM** of each track shows in the queue. Where the grid changes tempo, it shows each one ("178 · 119"), and the timeline marks the changes.
- **Correcting the tempo:** click the BPM. Double it, halve it, multiply or divide it by 1.5 (for a track read at a related tempo, such as 87 instead of 174), hold one of the tempos the grid found for the whole track, type the tempo, or tap it (click **Tap** on every beat, or press Space while it has the focus), then **Set**. *Automatic* goes back to the tempo found. The grid follows at once, and the choice is kept for the file.
- **Tempo range:** at the bottom of that menu, for all tracks without a tempo set by hand: *Auto*, *60–120*, *90–150* or *120–200*. For drum & bass choose *120–200*: in the automatic range it often reads at 2/3 or half its tempo.
- **Correcting the grid:** the buttons at the bottom left of the detail waveform correct the grid of the playing track. *1 here* makes the beat at the playhead the first of its bar, *◂ bar ▸* moves the bars by a beat, *◂ ms ▸* moves the grid by 5 ms (1 ms with Shift), and **Shift+drag** on the waveform moves it with the mouse; ↺ goes back to the grid as found. The correction is kept for the file.

## Visuals

The top bar switches the stage between three views:

- **Logo Spectrum:** your logo in the middle, a spectrum ring of colour layers around it, star particles and a background image. Everything is set in **Visuals**: presets (built in, or save your own), the ring (palette or your own colours, layers, size, frequency range, rotation, glow), how it reacts (quick settings *Smooth*, *Punchy*, *Twitchy*, or each value), the logo (image, zoom and position inside the circle, rim, shadow, bass pulse), the background (image, fill or fit, position, blur, darkening, bass zoom) and the particles.
- **Kaleidoscope:** feedback visuals folded into mirrored segments. Two scenes: *Vortex* (a swirling tunnel of fibrous strands pulled into a glowing core) and *Crystal Mandala* (glowing stars and crystal shards flying out of a star-shaped tunnel). In **Visuals**: presets, the scene, symmetry, motion, colour, how strongly it reacts, and each scene's own parameters.
- **Analysis:** what the visuals react to: the spectrum, band energies, kick, snare and hi-hat, the beat and the tempo.

Double-click a slider's label to reset it. **V** switches to the next view, **[** and **]** to the previous or next preset. Your images and settings are kept in the browser.

- **Aspect ratio:** the stage shows the visuals in the frame of your video, chosen in the top bar: 16:9 (YouTube), 9:16 (TikTok, Shorts, Reels), 1:1, 4:5 or 21:9. The frame button next to it shows the safe areas, and on 9:16 the parts the apps cover with their buttons and captions.
- **Fullscreen:** **F**; only the visuals show, and the mouse cursor hides when you do not move it.
- **A/V sync:** if the visuals run ahead of the sound (Bluetooth headphones, a TV, or Chrome on a Mac), open **Visuals → A/V sync** and click **Calibrate…**: a tick plays every second and a circle flashes; move the slider until both come together. Exports are always in sync.

## Sound

The **Sound** tab changes how the music sounds, while you listen and in exported videos. A dot on the tab shows that the sound is changed.

- **Presets:** *Slowed + Reverb* (85 %, deeper, with a reverb), *Sped up* (120 %), *Nightcore* (130 %) and *Clean*. Everything stays adjustable afterwards.
- **Tempo:** a fader with a range of ±8 %, ±16 % or ±50 %, fine steps of 0.1 % (**−** and **+**), reset (double-click the fader), and *Nudge*: 4 % slower or faster while you hold the button (or **,** and **.**). *Vinyl* changes the pitch with the speed, like a record; *Key lock* keeps the pitch.
- **Filter:** one knob from low-pass (left) to high-pass (right), with resonance; the middle is off.
- **Delay:** in time with the beat (1/16 to 1/1, straight, dotted or triplet) or in milliseconds, with feedback, a tone filter, ping-pong and mix.
- **Reverb:** size, decay, pre-delay, damping and mix.

Changes glide without clicks, and a limiter keeps the output from clipping. The visuals react to the music after the tempo and the filter, before the echoes and the reverb, which would blur the beats.

## Live input

To visualise music that plays somewhere else, open the **Live** tab.

- **Audio input:** choose a line-in, microphone or virtual audio device and click **Start**. The browser's voice processing is switched off, so music stays clean.
- **Another tab or app:** opens the browser's share dialog. Choose a tab and keep "Also share tab audio" on; some systems also offer "Also share system audio".
- **Level and monitoring:** input gain and a level meter. *Hear the input through this app* is off by default: a microphone next to speakers would feed back.
- **Tempo:** the BPM next to the LIVE badge in the transport bar works like the one of a track: double, halve, hold, type or tap the tempo, and the beat tracking keeps close to it until you choose *Automatic* again. The tempo range applies to live input too.
- A music app on the same computer can be routed through a virtual audio device: BlackHole on macOS, VB-Audio Virtual Cable on Windows, or a monitor source with PipeWire or PulseAudio on Linux. The Live tab explains the steps.

While live input runs, the queue pauses; double-click a track to go back to it.

## Exporting videos

Click **Export** in the top bar. Choose a format (*YouTube 1080p60*, *YouTube 4K30*, *TikTok / Shorts 1080×1920*, or your own size and frame rate), the quality, and the range: the whole track or the part between the markers. The export uses the same scenes, analysis, settings, tempo and effects as the preview, so the video looks and sounds like what you see and hear.

- The video is rendered frame by frame, independent of the speed of your graphics card: a slower machine takes longer, and the result is always smooth.
- In Chrome and Edge you pick the file first, and the video is written straight into it. Other browsers download it at the end.
- The format is MP4 (H.264 and AAC); a browser without H.264 encoding writes WebM instead.
- You can pause or cancel the export, and close the dialog while it runs. Long exports are written in segments; if the tab crashes or you reload, the app offers to resume where it stopped.

## DJ controller

Play the app from a Pioneer DJ DDJ-FLX2 over USB. Click the controller button in the top bar (next to **Export**), then **Connect**; the browser asks once for access to MIDI devices. This works in Chrome and Edge, and in Firefox after it installs a small add-on for the permission; Safari has no MIDI. Next time the app connects by itself.

- **PLAY/PAUSE:** play and pause. It lights while the music plays and blinks while paused.
- **CUE:** back to the in marker (or the start), and stop.
- **Pads in HOT CUE mode:** hot cues 1–8, like the keys 1–8: a dark pad sets its cue at the playhead, a lit pad jumps to it. **SHIFT** + pad deletes the cue.
- **CFX:** the DJ filter, off in the middle.
- **Tempo slider:** the tempo, within the range set in the Sound tab: slower at the top, faster at the bottom.
- **Channel fader:** the volume.
- **Jog wheel:** seeks. A turn of its top is 1.8 s, like a record; the outer ring seeks more finely, and with **SHIFT** held it seeks 16 times as fast. To set a cue exactly, pause, turn the jog wheel to the spot and press a dark pad.

These are the controls of deck 1. Knobs and faders take over once they reach the value in the app, so nothing jumps. Deck 2, the EQ knobs and the crossfader do nothing yet.

If a control does not do what it should, open **MIDI monitor** in the dialog, copy the messages and send them with a bug report. On Windows, close other DJ software first: only one program can use a MIDI device there.

## Keyboard shortcuts

Press **?** for the full list. The main ones: Space play and pause, ← and → seek 5 s (30 s with Shift), N next, P previous, 1–8 hot cues, I and O the in and out markers, Q snap to the beat, W the detail waveform, − and + the tempo, V the next view, [ and ] the presets, F fullscreen, Ctrl+Z undo.

## About

FibeStation is a work in progress: expect rough edges. Bug reports and ideas are very welcome at fipreroll+app@gmail.com.

Everything runs locally in your browser; your music, images and settings stay on your computer.

The default logo is set in Pacifico by Vernon Adams (SIL Open Font License 1.1). Audio and video go through Mediabunny, key lock uses Signalsmith Stretch.
