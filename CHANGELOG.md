# Changelog

What changed in FibeStation, newest first. Until 1.0, the version is 0.9 with the day and the time of the build, such as 0.9.20261003.1432 (**About** shows yours), so the changes are listed by the day they came out.

## 6 October 2026

- **Lighter on the computer:** while a slider, a knob or a fader of a DJ controller moves, the app stores its settings at most four times a second instead of with every step, and the detail waveform is drawn only when something in it changes, so it costs nothing while the music is paused. The sliders and the sound follow every movement as before.
- **Reduce flashing** is on from the first start where the system asks for less motion (*Reduce motion* in the settings of Windows, macOS and others), until you choose otherwise.
- **The shortcuts** (**?**) list **Ctrl+Z** (**Cmd+Z** on a Mac), which undoes removing a track, clearing the queue, deleting a cue or clearing the markers.
- **What the app keeps, and deleting it:** **Settings → Stored in this browser** shows how much the track analysis, the details of tracks, exports and the rest take, and deletes them by kind: the analysis or the details of tracks no longer in the queue, the analysis of all, an unfinished export, or everything. Each asks first and offers to save a backup before.
- **Fixes:** the buttons in the bar at the bottom stay where they are when the next track has markers and the one before had none, or the other way round; the markers show to the right of them, and the volume sits on the line of the timeline, out of their way.

## 5 October 2026

- **The lettering in the ring:** what you type in the top bar (double-click) or in **Settings** is now the text of the default logo in the ring only; the app keeps its name, *FibeStation*, in the window's title, About and its notices.
- **An image under the Kaleidoscope behind, tinted on its own:** **Image tint** colours just that image; *Darken* and *Tint* still take the whole background. The background's settings are grouped by what they change.
- **Fixes:** zoomed out, the Kaleidoscope fills the picture instead of showing a disc with black around it, and moving its zoom no longer makes it flicker. Its motion is smoother too, above all on screens that show more than 60 frames a second. Set back to 0, the hue cycle brings the look's own colours back. The cover art in the ring no longer blinks as the first track starts.
- **Any MIDI controller:** a controller the app does not know can be taught in the DJ controller dialog, control by control (MIDI learn), and kept as yours, exported and imported. A report of it can be saved and sent to us, so that it can come with the app.
- **A second screen:** **⋯ → Second screen** puts the visuals into a window of their own, for a projector or another monitor, in fullscreen there (**F** or a double-click), while the controls stay in the tab. With two screens, Chrome and Edge can put it on the other one by themselves.
- **A look per track:** in the dialog of a track (✎ or **F2**), **Look** gives it a preset of its own, of the Logo Spectrum or the Kaleidoscope: when the track plays, the visuals take it, also in videos of several tracks. It is kept for the file.
- **Only the sound:** the export can save the music with its tempo and effects as a WAV file, without a video (*Only the sound (WAV)* in the export dialog).
- **A draft first:** the export's format *Draft, quick to check* makes a small video (360 pixels, 30 fps) in a fraction of the time, to check a long video before making it in HD.
- **Exports in the tab's title:** while a video is made, the title of the tab shows how far it is, and how it ended until you look at the tab. If you like, a notification says when it is done (**Tell me when it is done** in the export dialog).

## 4 October 2026

- **Neon Ribbons, in a new light:** fine rings of light and soft, out-of-focus lights instead of fractal blossoms and little flowers, a colour that drifts along each tube, cool colours (*Iris*), and a haze instead of plain black (**Haze**, for every Kaleidoscope scene). *Neon Mandala* and *Lava Braid* follow. The look of before stays as the preset *Flower Power*, and looks you saved keep theirs.
- **Rain:** the particles of the Logo Spectrum can fall as rain, streaks in a wind that sways and that the bass blows, faster when the music is loud. The new preset *Night Rain* shows it.
- **Mini player:** the visuals in a small window of their own, on top while you work in other tabs and apps, with the track playing, play and pause, and skip (**⋯ → Mini player** or **M**, in Chrome, Edge and Firefox).
- **A tidier top bar:** what is used now and then (the safe areas, *Only the music*, the picture as a PNG and the DJ controller) is in **⋯** now, so the bar fits narrower windows; there the modes show only their icons.

## 3 October 2026

- **The colours of the track:** a switch under the palettes lets the visuals take the colours of the track playing, in both modes, live and in videos: those of its cover art, small bright details too, or colours you set for the track with ✎ (your own, or the look's), more or less colourful.
- **Covers of your own:** in the dialog for the title and artist (✎ or **F2**), a track gets a cover of its own, kept for the file: in the queue, as the logo and in exports, also where the file has none.
- **An image under the Kaleidoscope:** with the Kaleidoscope behind the Logo Spectrum, the background image can show under it.
- **Fixed tempo:** in the tempo menu of a track, one straight beat grid from start to end, so the bars no longer drift after a correction or through a break.
- **Fixes:** the Kaleidoscope no longer shows a turning rectangle when it spins: it fills the picture in every turn. The track's title no longer shows in full for a moment and then fades in again, when a track starts soon after the app opened or the visuals restarted.
- **Only the music:** the crossed-out eye in the top bar (or **B**) lets the visuals rest while the music plays on.
- **The queue scrolls** while you drag a track to its top or bottom, so a track can go far in one go.
- **A new default look:** *Blue-Pink Vortex*, neon lines around a logo that turns like a record, in front of a Vortex of its own. *Classic Rainbow*, the look before, stays a preset, and looks you saved keep theirs.
- **Versions:** each build has a version. **About** shows it, and the note of a new version says from which version to which.
- **Licences:** **Help → Licences** lists the parts of others in the app, with their licences.
- **Privacy:** **Help → Privacy** says what the app keeps in your browser, and what goes over the network: only its own files.
- **What's new:** this list, in the help.
- **Settings:** the gear in the top bar holds the app's name and the backup, which were in the help. The help only explains now, in three parts: the guide, what to do when something goes wrong, and about the app.
- **The app recovers by itself:** after the graphics card was reset, the visuals start again within a second, and an export goes on from where it was. When the sound stops by itself (the audio device was unplugged, the system took the sound), the music pauses with a message.
- **It says what went wrong:** an error the app did not expect shows, with details to copy and a mail to report it. A browser without something the app needs gets a page that says what it lacks. When the browser's storage is full, a message says so. A tab from before an update offers to reload.
- **System check:** the help shows what this browser offers the app (the graphics, the encoders, the storage), to copy into a bug report.
- **Fixes:** quiet intros no longer make the camera shake and the bass zoom as big as the drop. A drag that ends outside a dialog no longer closes it.
- **Under the hood:** the main paths are tested in Firefox too, a long test watches the memory, and the site sends a content security policy.

## 2 October 2026

- **The Kaleidoscope behind the Logo Spectrum,** live, with a look of its own; six presets mix both kinds of looks.
- **Like a record:** the logo or the cover art turns at 33⅓, 45 or 78 rpm with the music, and stands while paused.
- **Track info on screen:** the title and the artist, a progress bar and the time, in six fonts, live and in exports; the cover art of the track as the logo.
- **Videos:** the queue as one video, with chapters for YouTube and fades; a video of each track; the picture on the stage as a PNG, for a thumbnail.
- **Reduce flashing,** and a resolution that adapts when the visuals stutter.
- **Backup:** save and restore everything the app keeps, with or without the track analysis.

## 30 September 2026

- **Ring styles:** bars, lines or dots, outward, inward or both; a camera shake on kicks, a drift and a tint.
- **Presets switch by themselves:** every so many seconds or bars, or on the drops. Favourites, and presets in a file.
- **A new scene:** *Neon Ribbons*, neon tubes weaving around the centre.
- **DJ controller:** play the app from a Pioneer DJ DDJ-FLX2.
- **First look:** a welcome, a default logo with the app's name, and this help.
- **Tempo:** one tempo per track, straight beat grids for a fixed tempo, a tempo range, and the grid to correct (downbeat, bars, phase, drag). Bars and downbeats, BPM correction (×2, ÷2, ×1.5, ÷1.5), fast genres, two more waveform styles; the tempo of live input can be corrected too.
- **Smoother jog wheel:** the playhead follows it at once.

## 29 September 2026

- **Play ranges:** in and out markers with a short crossfade at the cuts, a loop with repeat one, markers that snap to the beat and can be dragged, undo, and a name of your own for the app.
- **Cues and waveforms:** a waveform of the whole track and a detail waveform, eight hot cues, folders in the queue, shuffle and repeat, gapless playback, the beat grid, A/V sync calibration and the list of shortcuts.
- **Tempo and effects:** tempo with vinyl or key lock, DJ filter, delay, reverb and a limiter, with presets such as *Slowed + Reverb* and *Nightcore*; exports sound the same.

## 25 September 2026

- **The first version:** play your music files in a queue, see them as the Logo Spectrum (your logo in a spectrum ring) or as the Kaleidoscope (*Vortex*, *Crystal Mandala*), react to kick, snare and hi-hat, and export videos for YouTube and TikTok, in segments that resume after a crash. Live input from an audio device or another tab.
