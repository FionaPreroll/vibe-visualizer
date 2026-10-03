# User guide

How to use FibeStation. The same guide opens in the app: click **?** in the top bar.

## Getting started

FibeStation turns music into visuals: a logo with a spectrum ring, or kaleidoscopic tunnels, all following the beat. Watch them live, go fullscreen for a DJ set, or render a video for YouTube or TikTok. Everything runs in your browser: nothing is uploaded.

1. **Add music.** Drop audio files or whole folders onto the window, or click **Add files** (the folder button next to it adds a folder). MP3, M4A, FLAC, Ogg, Opus and WAV work; several files make a queue. Double-click a track to play it, and press **Space** to pause.
2. **Pick a look.** The top bar switches between *Logo Spectrum*, *Kaleidoscope* and *Analysis*. The **Visuals** tab in the side panel has presets and every setting, and takes your own logo and background.
3. **Make a video or play live.** **Export** in the top bar renders a video of the track, of the part between two markers, or of several tracks of the queue (one video of them all, or a video of each). The camera next to it saves the picture as a thumbnail. **F** shows the visuals in fullscreen.

To visualise music from somewhere else (a DJ mixer, another app or a browser tab), use the **Live** tab instead of the queue.

The app is called *FibeStation* until you rename it: in **Settings** (the gear in the top bar), or with a double-click on the name in the top bar. The default logo shows the name too. **Settings** also makes and restores backups; this help only explains.

It works best in Chrome or Edge on a computer with a good graphics card, above all for the Kaleidoscope. Firefox works too; in Firefox the queue's files have to be added again after a reload.

## Queue and playback

- **Playing:** double-click a track, or select it and press **Enter**. Space plays and pauses, **N** and **P** go to the next and previous track, the arrow keys jump 5 s (30 s with Shift).
- **Order:** drag tracks to reorder them (or **Alt+↑** and **Alt+↓**). Folders are read with their subfolders and sorted by track number, or else by file name, so "2 …" comes before "10 …".
- **Gapless:** tracks follow each other without a gap, also between files with different sample rates.
- **Shuffle and repeat:** the buttons next to Stop (or **S** and **R**): shuffle plays every track once per round; repeat plays the queue again, or the track.
- **After a reload** the queue and the current track are still there. In Chrome and Edge the files come back too (after a browser restart, click **Allow** once in the queue); other browsers keep the entries, and adding the files or their folder again brings them back, with their cues.
- **Undo:** removing a track, clearing the queue, deleting a cue or clearing markers shows an *Undo* button for a few seconds (or press **Ctrl+Z**, **Cmd+Z** on a Mac).
- **Title and artist:** they come from the file's tags, or else from its name. To name a track yourself, click ✎ next to it (or select it and press **F2**). The queue, the transport, the track overlay and exports (the file name too) then show your names. They are kept for the file; *Use the file's* goes back to its tags.

## Waveforms, cues and markers

- **Timeline:** the transport bar shows the track's waveform, computed in the background, also for mixes of several hours. Click or drag it to seek.
- **Detail waveform:** above the transport (**W** switches it on and off), a few seconds around the playhead with every beat, and a stronger line on the first beat of each bar. Drag it to seek, scroll to zoom. The button in its corner switches the style: *3 bands* (lows blue, mids orange, highs white, as in Rekordbox) or *RGB*.
- **Hot cues:** eight per track. Press **1**–**8** (or click a pad) to set a cue where it is empty or to jump to it; **Shift+1**–**8** deletes it.
- **In and out markers:** press **I** and **O** (or the bracket buttons next to Stop) to mark the part of a track that plays and exports, such as a 30-second clip. A track from the queue starts at its in marker, and at its out marker the next one follows, crossing over in 10 ms so the cut does not click. With *repeat the track*, the part loops. Drag a marker on the timeline or in the detail waveform; with a marker focused, **←** and **→** move it by a beat. The chip next to the buttons shows the part and its length; click it to clear the markers.
- **Snap to the beat:** the magnet button (**Q**), on by default, puts markers and cues on the nearest beat when you set or drag them.
- Cues and markers are kept per file and come back whenever you add the file again.

## Beat grid and tempo

Each file is analysed as a whole in the background. The visuals then follow its beats and its tempo instead of guessing them live, and the grid knows where the bars start. The analysis also measures how loud the track gets, so a quiet intro moves the visuals less than the drop; until it is done (the first seconds of a new file), the Logo Spectrum does not shake, zoom or pulse with the bass. A single track keeps one tempo, and a track with a fixed tempo gets a straight grid, as in DJ software; a long mix keeps its tempo changes.

- **The BPM** of each track shows in the queue. Where the grid changes tempo, it shows each one ("178 · 119"), and the timeline marks the changes.
- **Correcting the tempo:** click the BPM. Double it, halve it, multiply or divide it by 1.5 (for a track read at a related tempo, such as 87 instead of 174), hold one of the tempos the grid found for the whole track, type the tempo, or tap it (click **Tap** on every beat, or press Space while it has the focus), then **Set**. *Automatic* goes back to the tempo found. The grid follows at once, and the choice is kept for the file.
- **Tempo range:** at the bottom of that menu, for all tracks without a tempo set by hand: *Auto*, *60–120*, *90–150* or *120–200*. For drum & bass choose *120–200*: in the automatic range it often reads at 2/3 or half its tempo.
- **Correcting the grid:** the buttons at the bottom left of the detail waveform correct the grid of the playing track. *1 here* makes the beat at the playhead the first of its bar, *◂ bar ▸* moves the bars by a beat, *◂ ms ▸* moves the grid by 5 ms (1 ms with Shift), and **Shift+drag** on the waveform moves it with the mouse; ↺ goes back to the grid as found. The correction is kept for the file.

## Visuals

The top bar switches the stage between three views:

- **Logo Spectrum:** your logo in the middle, a spectrum ring of colour layers around it, star particles and a background image. Everything is set in **Visuals**: presets (built in, or save your own), the ring (a filled shape, bars, lines or dots, growing outward, inward or both ways; palette or your own colours, layers, size, frequency range, rotation, glow), how it reacts (quick settings *Smooth*, *Punchy*, *Twitchy*, or each value), the logo (an image, or the cover art of the track playing; zoom and position inside the circle, rim, shadow, bass pulse, and *Spin like a record* at 33⅓, 45 or 78 rpm: it turns while the music plays, at the tempo, and stands while paused), the background (an image, fill or fit, position, blur, darkening, a colour tint; or a Kaleidoscope, live behind the ring), the motion (zoom on the bass, a camera shake on kicks, a slow drift of the background) and the particles. For a ring that grows inward, make the logo smaller, or it covers the inner part.
- **Kaleidoscope:** feedback visuals folded into mirrored segments. Three scenes: *Vortex* (a swirling tunnel of fibrous strands pulled into a glowing core), *Crystal Mandala* (glowing stars and crystal shards flying out of a star-shaped tunnel) and *Neon Ribbons* (neon tubes weaving around the centre, over and under each other, with orange fractal blossoms and small flowers floating away). In **Visuals**: presets, the scene, symmetry, motion, colour, how strongly it reacts, and each scene's own parameters (for Neon Ribbons: how many ribbons and lobes, how far they swing, their thickness and depth, the blossoms and the flowers).
- **Analysis:** what the visuals react to: the spectrum, band energies, kick, snare and hi-hat, the beat and the tempo.

Double-click a slider's label to reset it. **V** switches to the next view, **[** and **]** to the previous or next preset. Your images and settings are kept in the browser.

- **Presets:** each mode has built-in presets and your own (type a name and click **Save**). The star makes the preset shown a favourite (★ in the list); the shuffle button picks another preset at random, from your favourites if you have two or more. **Export yours** saves your presets of the mode to a file, and **Import** adds the presets of such a file to yours (a name that is taken gets a number). Seven built-in Logo Spectrum presets have a Kaleidoscope behind the ring (*Blue-Pink Vortex*, the look the app starts with, *Mandala Core*, *Ember Record*, *Bloom Halo*, *Ribbon Lines*, *Aurora Disc* and *Lava Bars*), so the preset switching moves between both kinds of looks.
- **Preset switching:** in **Visuals → Preset switching** the presets change by themselves: every so many seconds of music (silence does not count), every so many bars (of four beats; through a break without beats it counts on at the tempo), or on the drops, when the bass and the kick come back after a quieter part. It goes to the next preset or a random one, from all presets of the mode or from your favourites, with a morph of up to 10 s (0 cuts). A preset you pick or a setting you change stays for a whole stretch. Exports switch the same way.
- **Kaleidoscope behind:** a Kaleidoscope behind the Logo Spectrum's ring has a look of its own, part of the Logo Spectrum's: presets and the preset switching carry it, and the Kaleidoscope mode keeps its own look. It starts as the Kaleidoscope mode is set up. To change it, click **Set up the Kaleidoscope behind…** under the background, or **Kaleidoscope behind** at the top of **Visuals**: the same controls and presets as in the Kaleidoscope mode, without leaving the Logo Spectrum (also while live input plays).
- **Track info:** in **Visuals → Track info**, the title and artist of the track playing over the visuals, in both modes and in exports. Choose the font (Montserrat, Bebas Neue, Playfair Display, Space Mono, Pacifico or Orbitron), the position (nine places, inside the title-safe frame), the colour and the size. It fades in at the start of each track and out before its end; with *Stays for* it fades out after a while instead of staying. A **progress bar** and the **time** (played and the length, at the tempo) can go under the text. Changing a setting shows the text for a moment, so you can see it even between tracks. With **Show the cover art of the track playing** in **Visuals → Logo**, the Logo Spectrum shows each track's cover in the circle; tracks without one show the logo image.
- **Display:** in **Visuals → Display**, the resolution the visuals draw at (50–100 % of the screen's), which is lowered on its own while the visuals stutter and raised again once they run smoothly (exports always render at their own resolution); and **Reduce flashing**, which damps sudden jumps in brightness, in exports too. The welcome at the first start offers it as well.
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

Click **Export** in the top bar. Choose a format (*YouTube 1080p60*, *YouTube 4K30*, *TikTok / Shorts 1080×1920*, or your own size and frame rate), the quality, and the range: the whole track, the part between the markers, or **tracks of the queue**. The export uses the same scenes, analysis, settings, tempo and effects as the preview, so the video looks and sounds like what you see and hear.

- **Several tracks in one video**, such as a mix or an album: choose *Tracks of the queue* and tick the tracks to include (all are ticked at first). They play in the order of the queue, each between its markers, and follow each other as in the player: without a gap, crossing over in 10 ms where a track stops at its out marker. The track overlay names each track while it plays, and the logo shows each one's cover art if that is set up.
- **Chapters:** a video of several tracks comes with a list of where each track starts ("0:00 Artist – Title", one per line). Paste it into the video's description on YouTube, and YouTube shows the chapters on the timeline. **Copy** puts the list on the clipboard, **Save as text** saves it as a file. YouTube shows chapters only for three tracks or more, each at least 10 seconds long; the dialog says when that is not the case.
- **A video of each track**, e.g. to upload an album track by track: choose *Tracks of the queue*, tick the tracks, and pick *A video of each*. The videos are made one after the other, each between its markers and named after its track (a second one of the same name gets a number). In Chrome and Edge you pick a folder, and each video is written into it; other browsers keep the videos in browser storage, each with a **Download** button, until the next export. Cancelling keeps the videos finished before. If a video fails, resuming it goes on with the rest.
- **Fade in and out:** the picture fades from and to black at the start and the end of the video, over 1–5 seconds, and the sound with it.

- The video is rendered frame by frame, independent of the speed of your graphics card: a slower machine takes longer, and the result is always smooth.
- In Chrome and Edge you pick the file first, and the video is written straight into it. Other browsers download it at the end.
- The format is MP4 (H.264 and AAC); a browser without H.264 encoding writes WebM instead.
- The track overlay and the cover art go into the video as set up for the preview; the dialog says when they do.
- You can pause or cancel the export, and close the dialog while it runs. Long exports are written in segments; if the tab crashes or you reload, the app offers to resume where it stopped. If the sound was not finished yet, it asks you to add the tracks to the queue again first. After a reload, a video of each track resumes only the video it was making.
- **A picture for a thumbnail:** the camera button in the top bar (or **C**) saves the picture on the stage as a PNG, named after the track playing: 1280×720 for 16:9, the size YouTube recommends for thumbnails, and 720 pixels on the shorter side for the other aspect ratios. It shows what the stage shows at that moment, the track overlay included; pause where you like the picture.

## DJ controller

Play the app from a Pioneer DJ DDJ-FLX2 over USB. Click the controller button in the top bar (next to **Export**), then **Connect**; the browser asks once for access to MIDI devices. This works in Chrome and Edge, and in Firefox after it installs a small add-on for the permission; Safari has no MIDI. Next time the app connects by itself.

- **PLAY/PAUSE:** play and pause. It lights while the music plays and blinks while paused.
- **CUE:** as on a CDJ, with the in marker as the cue point. Paused, it sets the in marker at the playhead (on the beat when snapping is on). Held at the cue point, the music plays until you let go, then goes back to it; press **PLAY** while holding **CUE** to play on. While playing, **CUE** goes back to the cue point and pauses. It lights at the cue point and blinks while paused elsewhere. So a clip starts where you want: pause, turn the jog wheel to the spot, press **CUE**.
- **Pads in HOT CUE mode:** hot cues 1–8, like the keys 1–8: a dark pad sets its cue at the playhead, a lit pad jumps to it. **SHIFT** + pad deletes the cue.
- **CFX:** the DJ filter, off in the middle.
- **Tempo slider:** the tempo, within the range set in the Sound tab: slower at the top, faster at the bottom.
- **Channel fader:** the volume.
- **Jog wheel:** seeks. A turn of its top is 1.8 s, like a record; the outer ring seeks more finely, and with **SHIFT** held it seeks 16 times as fast. To set a cue exactly, pause, turn the jog wheel to the spot and press a dark pad.

These are the controls of deck 1. Knobs and faders take over once they reach the value in the app, so nothing jumps. Deck 2, the EQ knobs and the crossfader do nothing yet.

If a control does not do what it should, open **MIDI monitor** in the dialog, copy the messages and send them with a bug report. On Windows, close other DJ software first: only one program can use a MIDI device there.

## Backup

In **Settings** (the gear in the top bar), **Save a backup** puts everything the app keeps in this browser into one file, to move it to another browser or computer, or to keep it safe: the settings, your presets, the cues, markers, tempos and names of your tracks, and the background and logo images. **With the track analysis** adds the waveforms and beat grids found, so no track needs to be analysed again; the file gets larger (about 0.3 MB for five minutes of music). The music files and the queue are not in it: add the files again where you restore it, and their cues and markers come back with them.

**Restore a backup** replaces everything the app keeps in this browser with what is in the file; it says what that is first. Then the app reloads. The queue stays as it is, and so does the analysis of the tracks if the backup has none.

## Keyboard shortcuts

Press **?** for the full list. The main ones: Space play and pause, ← and → seek 5 s (30 s with Shift), N next, P previous, 1–8 hot cues, I and O the in and out markers, Q snap to the beat, W the detail waveform, − and + the tempo, V the next view, [ and ] the presets, F fullscreen, Ctrl+Z undo.

## When something goes wrong

- **The visuals stop:** when the graphics card is reset (with heavy scenes, after sleep, or when a laptop changes its graphics chip), the visuals start again by themselves within a second. When that happens again and again, they wait for a click on **Try again**. An export goes on by itself from its last finished part.
- **The music stops:** when the sound stops by itself (the audio device was unplugged, or the system took the sound), the music pauses and a message says what happened. Press **Play** to go on.
- **Something went wrong:** an error the app did not expect shows at the bottom. **Copy details** copies what a bug report needs, and **Report…** opens a mail with it. A part of the app that failed shows **Try again**, while the rest goes on.
- **A new version is out:** when the app was updated while it is open, a note offers to **Reload**.
- **Storage:** the app asks the browser to keep its data, so that it is not cleared when the disk runs low (Firefox asks you, the first time you add an image or export). When the browser's storage is full, a message says that changes are not saved.
- **System check:** below, what this browser offers the app: the graphics, the encoders for videos, and the storage. **Copy the report** puts it on the clipboard for a bug report.
- **The browser:** the app needs a current browser, with WebGL 2. If something is missing, it says what instead of starting. When it is WebGL 2 in Chrome, Edge or Firefox, turn on graphics acceleration in the browser's settings.

## About

FibeStation is a work in progress: expect rough edges. Bug reports and ideas are very welcome at fipreroll+app@gmail.com.

Everything runs locally in your browser; your music, images and settings stay on your computer.

FibeStation has no licence yet: all rights reserved. It contains parts of others, which keep their own licences: **Licences** lists them with their texts. Among them are Mediabunny for audio and video, Signalsmith Stretch for the key lock, FFmpeg's AAC encoder for the sound of MP4 exports in browsers without one of their own, and the fonts, such as Pacifico for the default logo.
