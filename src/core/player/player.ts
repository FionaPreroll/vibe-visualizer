import { nearestBeat } from '../analysis/beat-grid';
import { rateLimits, TEMPO_STEP, type SoundSettings } from '../audio/dsp/sound-settings';
import { AudioEngine } from '../audio/engine/audio-engine';
import {
  closeInput,
  openDevice,
  openDisplay,
  type InputDevice,
  type LiveSourceKind,
} from '../audio/live-input';
import { entriesFromFiles, type QueueEntry } from '../library/folder-reader';
import type { ProbeResult } from '../library/probe.worker';
import ProbeWorker from '../library/probe.worker.ts?worker';
import { accessOf, loadQueue, requestAccess, saveQueue } from '../library/queue-store';
import { TrackAnalyzer, type TrackAnalysisState } from '../library/track-analyzer';
import { readCover, writeCover } from '../library/track-covers';
import { sameTrackColors, sanitizeTrackColors, type TrackColors } from '../render/cover-palette';
import { GridEditor } from './grid-editor';
import { Library } from './library';
import { LiveSource } from './live-source';
import { StateSync } from './state-sync';
import { Transport } from './transport';
import { UndoOffer } from './undo-offer';
import {
  CUE_COUNT,
  initialState,
  reducer,
  sanitizeTrackLook,
  shownTitle,
  trackEdit,
  type AppAction,
  type AppState,
  type Marks,
  type Settings,
  type Track,
  type TrackLook,
} from '../state/app-state';
import type { KaleidoSceneId, KaleidoSettings, ParamValue } from '../render/kaleido-settings';
import type { LogoSpectrumSettings } from '../render/visual-settings';
import { keepStorage } from '../state/keep-storage';
import {
  flushWrites,
  loadKaleido,
  loadSettings,
  loadSound,
  loadTrackData,
  loadVisuals,
  saveKaleido,
  saveSettings,
  saveSound,
  saveTrackData,
  saveVisuals,
  whenStorageFails,
} from '../state/persistence';
import { appParts, watch, type AppParts } from '../state/select';
import { createStore, type Store } from '../state/store';
import { WorkerClient } from '../util/worker-rpc';

/** Speed change while nudging (TMP-03). */
export const NUDGE = 0.04;
export type { StreamFile } from './transport';

/**
 * Connects the queue state with the audio engine: every user command goes through here, is
 * recorded as an action, and drives the engine.
 */
export class Player {
  readonly store: Store<AppState, AppAction>;
  /** The parts of the state, each told to its subscribers only when it changes (#52). */
  readonly parts: AppParts;
  readonly engine = new AudioEngine();
  /** Waveforms and beat grids of the queue's tracks (a Svelte store). */
  readonly analysis = new TrackAnalyzer();
  private readonly probeClient = new WorkerClient(new ProbeWorker());
  /** The files behind the queue's entries. */
  private readonly library: Library;
  /** The last removal or deletion, while it can be undone. */
  private readonly undoOffer: UndoOffer;
  /** Stores the state as it changes. */
  private readonly sync: StateSync;
  /** The beat grids as the user wants them: tempo, one tempo throughout, corrections. */
  private readonly grids: GridEditor;
  /** Live input as the source, instead of the queue. */
  private readonly liveSource: LiveSource;
  /** Plays the queue: tracks between their markers, without gaps. */
  private readonly transport: Transport;
  /**
   * The files of the engine's stream (a Svelte store): the track heard and the one that follows,
   * by their tokens. The visuals know by the token which track the music they show comes from.
   */
  readonly stream: Transport['stream'];

  constructor() {
    this.store = createStore<AppState, AppAction>(
      initialState(loadSettings(), loadVisuals(), loadKaleido(), loadSound()),
      reducer,
    );
    this.parts = appParts(this.store);
    this.grids = new GridEditor(
      this.store,
      this.analysis,
      (id) => this.library.file(id),
      () => this.position,
    );
    this.undoOffer = new UndoOffer(this.store);
    this.engine.volume = this.state.settings.volume;
    this.engine.inputGainDecibels = this.state.settings.inputGain;
    this.engine.syncOffset = this.state.settings.syncOffset / 1000;
    this.engine.sound = this.state.sound;
    // The sound stopped without being asked to (NF-09): the music pauses, and the error says
    // why. Play starts it again.
    this.engine.onTrouble = (message) => this.transport.troubled(message);
    whenStorageFails((error) =>
      this.reportError(
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? "The browser's storage is full: changes are not saved, and are gone after a reload. Free some space on the disk."
          : 'This browser does not let the app store anything: changes are gone after a reload.',
      ),
    );
    this.liveSource = new LiveSource(
      this.store,
      this.engine,
      { openDevice, openDisplay, closeInput },
      () => this.pause(),
    );
    this.library = new Library(
      this.store,
      {
        probe: (file) => this.probeClient.call<ProbeResult>('probe', { file }),
        loadQueue,
        accessOf,
        requestAccess,
        loadTrackData,
        readCover,
        writeCover,
        keepStorage,
      },
      (fingerprint, file, first) => this.grids.analyse(fingerprint, file, first),
      (fingerprint) => this.analysis.forget(fingerprint),
    );
    this.transport = new Transport(
      this.store,
      this.engine,
      this.library,
      this.analysis,
      (fingerprint, file, first) => this.grids.analyse(fingerprint, file, first),
      this.liveSource,
    );
    this.stream = this.transport.stream;
    const { settings, sound } = this.parts;
    watch(sound, (now) => (this.engine.sound = now));
    watch(settings, (now) => {
      this.engine.volume = now.volume;
      this.engine.inputGainDecibels = now.inputGain;
      this.engine.syncOffset = now.syncOffset / 1000;
    });
    this.sync = new StateSync(
      this.parts,
      { saveSettings, saveSound, saveVisuals, saveKaleido, saveTrackData, saveQueue, flushWrites },
      () => this.library.storedQueue(),
      this.library.restored,
    );
    window.addEventListener('pagehide', this.flushSave);
    // A tab in the background can be discarded without a pagehide (on phones above all).
    document.addEventListener('visibilitychange', this.flushSave);
  }

  get state(): AppState {
    return this.store.state;
  }

  get currentTrack(): Track | null {
    return this.state.tracks.find((track) => track.id === this.state.currentId) ?? null;
  }

  /** Playback position of the current track in seconds. */
  get position(): number {
    return this.transport.position;
  }

  /** The playback position to show at `now`, moving on smoothly between the audio callbacks. */
  displayPosition(now = performance.now()): number {
    return this.transport.displayPosition(now);
  }

  /**
   * Plays the track with `id` from `startSeconds` (by default its in marker) to its out marker.
   * Call from a user gesture the first time.
   */
  playTrack(id: string, startSeconds?: number): Promise<void> {
    return this.transport.playTrack(id, startSeconds);
  }

  play(): Promise<void> {
    return this.transport.play();
  }

  pause(): void {
    this.transport.pause();
  }

  toggle(): Promise<void> {
    return this.transport.toggle();
  }

  /** Pauses and goes back to where the track starts (its in marker). */
  stop(): Promise<void> {
    return this.transport.stop();
  }

  seek(seconds: number): Promise<void> {
    return this.transport.seek(seconds);
  }

  /** Scrubs the playhead to `seconds` (the jog wheel): the position is there at once. */
  scrub(seconds: number): void {
    this.transport.scrub(seconds);
  }

  next(): Promise<void> {
    return this.transport.next();
  }

  /** Restarts the track (at its in marker), or goes to the previous one when near its start. */
  previous(): Promise<void> {
    return this.transport.previous();
  }

  private dispatch(action: AppAction): void {
    this.store.dispatch(action);
  }

  addFiles(files: Iterable<File>): void {
    this.library.add(entriesFromFiles(files));
  }

  /**
   * Appends files to the queue (SRC-01, SRC-03); a file that an entry of the last visit misses
   * brings that entry back instead (SRC-05).
   */
  addEntries(entries: readonly QueueEntry[]): void {
    this.library.add(entries);
  }

  /** Shows an error (from reading dropped files, for example). */
  reportError(message: string): void {
    this.dispatch({ type: 'player/error', message });
  }

  /**
   * Gives the file of track `id` a cover of the user's (LS-21), for every entry of that file;
   * null takes it away.
   */
  setOwnCover(id: string, cover: Blob | null): Promise<void> {
    return this.library.setOwnCover(id, cover);
  }

  /**
   * Asks for access to the files of the last visit (SRC-05); call it from a click. The browser
   * may ask once for all of them; if the user declines, the rest stays locked.
   */
  unlock(): Promise<void> {
    return this.library.unlock();
  }

  private readonly flushSave = () => this.sync.flush();

  /** The tempo of the beat grid of a file (TMP-06); null: found again (see {@link GridEditor}). */
  setTempo(id: string, bpm: number | null): void {
    this.grids.setTempo(id, bpm);
  }

  /** One tempo throughout for a file (TR-12), or not. */
  setFixedTempo(id: string, fixed: boolean): void {
    this.grids.setFixedTempo(id, fixed);
  }

  /** The look the visuals take when the track starts (PR-06); null: none. */
  setTrackLook(id: string, look: TrackLook | null): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!track || !fingerprint) return;
    const next = sanitizeTrackLook(look);
    if (JSON.stringify(next) === JSON.stringify(track.look)) return;
    this.dispatch({ type: 'tracks/look', fingerprint, look: next });
  }

  /**
   * Gives the file of track `id` colours for the visuals (VE-12), for every entry of that file:
   * its cover's, colours of the user's own, or the look's; null: its cover's, as found.
   */
  setTrackColors(id: string, colors: TrackColors | null): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!fingerprint || sameTrackColors(track.colors, colors)) return;
    this.dispatch({ type: 'tracks/colors', fingerprint, colors: sanitizeTrackColors(colors) });
  }

  /** The beat nearest to the playhead becomes the first of its bar (TR-11). */
  setDownbeat(): void {
    this.grids.setDownbeat();
  }

  /** The bars start one beat later (1) or earlier (-1) (TR-11). */
  moveBars(direction: -1 | 1): void {
    this.grids.moveBars(direction);
  }

  /** Moves the beat grid by `seconds` (TR-11): later for a positive value. */
  nudgeGrid(seconds: number): void {
    this.grids.nudge(seconds);
  }

  /** Moves the beat grid to `shift` seconds from where the analysis put it (TR-11). */
  shiftGrid(shift: number, commit: boolean): void {
    this.grids.shift(shift, commit);
  }

  /** The beat grid of the current track as the analysis found it (TR-11). */
  resetGrid(): void {
    this.grids.reset();
  }

  /** The tempo of the live input (TMP-06); null: found by the beat tracking. */
  setLiveTempo(bpm: number | null): void {
    this.liveSource.setTempo(bpm);
  }

  /** Waveform and beat grid of a track, once analysed (TR-03, AN-07). */
  analysisOf(track: Track | null): TrackAnalysisState | undefined {
    return this.analysis.get(track?.fingerprint ?? null);
  }

  /** True while live input is the source (the transport is idle then). */
  get live(): boolean {
    return this.liveSource.active;
  }

  /** The audio input used last, or null for the default input. */
  get lastInputDevice(): InputDevice | null {
    return this.liveSource.lastDevice;
  }

  /**
   * Makes live input the source (IN-01, IN-02): an audio input or a tab or the screen. Call
   * from a user gesture: the browser asks for permission.
   */
  startLive(kind: LiveSourceKind, device: InputDevice | null = null): Promise<void> {
    return this.liveSource.start(kind, device);
  }

  /** Back to the queue as the source; monitoring goes off. */
  stopLive(reason: string | null = null): void {
    this.liveSource.stop(reason);
  }

  /** Hearing the live input through the app (IN-04). */
  setMonitor(monitor: boolean): void {
    this.liveSource.setMonitor(monitor);
  }

  /** Removes a track from the queue (it can be undone for a moment). */
  async remove(id: string): Promise<void> {
    const index = this.state.tracks.findIndex((track) => track.id === id);
    const track = this.state.tracks[index];
    if (!track) return;
    const current = this.state.currentId === id;
    const taken = this.library.take([track]);
    if (id === this.transport.loadedId) await this.transport.unload();
    this.dispatch({ type: 'tracks/removed', id });
    this.undoOffer.offer(
      `Removed “${shownTitle(track)}”`,
      () => taken.putBack(index, current ? id : null),
      () => taken.forget(),
    );
  }

  move(from: number, to: number): void {
    this.dispatch({ type: 'tracks/moved', from, to });
  }

  /**
   * Gives track `id` the title and artist the user typed (LS-18), for every entry of its file;
   * what the file has already is no change, and an empty title keeps the file's.
   */
  renameTrack(id: string, title: string, artist: string): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    if (track) this.dispatch({ type: 'tracks/edited', id, edit: trackEdit(track, title, artist) });
  }

  /** Empties the queue (it can be undone for a moment). */
  async clear(): Promise<void> {
    const tracks = this.state.tracks;
    if (tracks.length === 0) return;
    const current = this.state.currentId;
    const taken = this.library.take(tracks);
    await this.transport.unload();
    this.dispatch({ type: 'tracks/cleared' });
    this.undoOffer.offer(
      tracks.length === 1
        ? 'Cleared the queue (1 track)'
        : `Cleared the queue (${tracks.length} tracks)`,
      () => taken.putBack(0, current),
      () => taken.forget(),
    );
  }

  /** Undoes the last removal or deletion, while that is offered (Ctrl+Z). */
  undo(): void {
    this.undoOffer.undo();
  }

  /** Changes parameters of the visuals (recorded as actions, like everything else). */
  updateVisuals(changes: Partial<LogoSpectrumSettings>): void {
    this.dispatch({ type: 'visuals/changed', changes });
  }

  /** Applies a preset: all visual parameters at once. */
  replaceVisuals(visuals: LogoSpectrumSettings): void {
    this.dispatch({ type: 'visuals/replaced', visuals });
  }

  /** Switches the Kaleidoscope scene (with the look that suits it). */
  setKaleidoScene(scene: KaleidoSceneId): void {
    this.dispatch({ type: 'kaleido/scene', scene });
  }

  /** Changes one Kaleidoscope parameter: a common one or one of a scene. */
  setKaleidoParam(scope: 'common' | KaleidoSceneId, key: string, value: ParamValue): void {
    this.dispatch({ type: 'kaleido/param', scope, key, value });
  }

  replaceKaleido(kaleido: KaleidoSettings): void {
    this.dispatch({ type: 'kaleido/replaced', kaleido });
  }

  /** The Kaleidoscope behind the Logo Spectrum (VE-08): another scene, with its look. */
  setLayerScene(scene: KaleidoSceneId): void {
    this.dispatch({ type: 'layer/scene', scene });
  }

  /** Changes one parameter of the Kaleidoscope behind the Logo Spectrum. */
  setLayerParam(scope: 'common' | KaleidoSceneId, key: string, value: ParamValue): void {
    this.dispatch({ type: 'layer/param', scope, key, value });
  }

  /** Puts a Kaleidoscope look (a preset) behind the Logo Spectrum. */
  replaceLayer(kaleido: KaleidoSettings): void {
    this.dispatch({ type: 'layer/replaced', kaleido });
  }

  /**
   * Sets the in or out marker of the current track (TR-09), at the playback position unless
   * given, on the nearest beat when quantizing (`snap`: a dragged marker is snapped already);
   * null clears it.
   */
  mark(mark: 'in' | 'out', seconds: number | null = this.position, snap = true): void {
    const track = this.currentTrack;
    if (!track) return;
    const marks = track.marks;
    const target = snap ? this.snap(seconds) : seconds;
    this.dispatch({ type: 'tracks/marked', id: track.id, mark, seconds: target });
    if (seconds === null && marks[mark] !== null) {
      this.undoOffer.offer(`Cleared the ${mark} marker`, () => this.restoreMarks(track.id, marks));
    }
  }

  /** Clears both markers of the current track (it can be undone for a moment). */
  clearMarks(): void {
    const track = this.currentTrack;
    if (!track || (track.marks.in === null && track.marks.out === null)) return;
    const marks = track.marks;
    this.dispatch({ type: 'tracks/marked', id: track.id, mark: 'in', seconds: null });
    this.dispatch({ type: 'tracks/marked', id: track.id, mark: 'out', seconds: null });
    this.undoOffer.offer('Cleared the markers', () => this.restoreMarks(track.id, marks));
  }

  private restoreMarks(id: string, marks: Marks): void {
    // The out marker first: an in marker behind a stale out marker would clear it.
    this.dispatch({ type: 'tracks/marked', id, mark: 'out', seconds: marks.out });
    this.dispatch({ type: 'tracks/marked', id, mark: 'in', seconds: marks.in });
  }

  /**
   * `seconds` on the nearest beat of the current track, while quantizing is on and its beat
   * grid has a clear beat there (TR-06); otherwise unchanged.
   */
  snap<T extends number | null>(seconds: T): T {
    if (seconds === null || !this.state.settings.quantize) return seconds;
    const grid = this.analysisOf(this.currentTrack)?.grid;
    return ((grid && nearestBeat(grid, seconds)) ?? seconds) as T;
  }

  /**
   * Hot cue `index` of the current track (TR-04): jumps to it, or sets it at the playback
   * position when it is empty.
   */
  async cue(index: number): Promise<void> {
    const track = this.currentTrack;
    if (!track || this.live || index < 0 || index >= CUE_COUNT) return;
    const seconds = track.cues[index] ?? null;
    if (seconds === null) this.setCue(index);
    else await this.seek(seconds);
  }

  /**
   * Sets hot cue `index` of the current track (at the playback position, on the nearest beat
   * when quantizing); null deletes it.
   */
  setCue(index: number, seconds: number | null = this.position): void {
    const track = this.currentTrack;
    if (!track) return;
    const old = track.cues[index] ?? null;
    this.dispatch({ type: 'tracks/cue', id: track.id, index, seconds: this.snap(seconds) });
    if (seconds === null && old !== null) {
      const restore = () =>
        this.dispatch({ type: 'tracks/cue', id: track.id, index, seconds: old });
      this.undoOffer.offer(`Deleted cue ${index + 1}`, restore);
    }
  }

  /** The file behind a queue entry (for the export). */
  fileFor(id: string): File | null {
    return this.library.file(id) ?? null;
  }

  /** Changes tempo or effect settings (TMP, FX). */
  updateSound(changes: Partial<SoundSettings>): void {
    this.dispatch({ type: 'sound/changed', changes });
  }

  /** Applies a sound preset (FX-10): all settings at once. */
  replaceSound(sound: SoundSettings): void {
    this.dispatch({ type: 'sound/replaced', sound });
  }

  /** Changes the tempo by a fine step (TMP-03), within the fader's range. */
  stepTempo(direction: -1 | 1): void {
    const sound = this.state.sound;
    const [low, high] = rateLimits(sound.tempoRange);
    // Rounded to the step, so repeated steps do not collect rounding errors.
    const rate = Math.round((sound.rate + direction * TEMPO_STEP) * 1000) / 1000;
    this.updateSound({ rate: Math.min(high, Math.max(low, rate)) });
  }

  /** Speeds up (1) or slows down (−1) for as long as it is held, 0 releases (TMP-03). */
  nudge(direction: -1 | 0 | 1): void {
    this.engine.nudge = 1 + direction * NUDGE;
  }

  updateSettings(changes: Partial<Settings>): void {
    const range = this.state.settings.bpmRange;
    this.dispatch({ type: 'settings/changed', changes });
    if (this.state.settings.bpmRange !== range) this.grids.regridAll();
  }

  dismissError(): void {
    this.dispatch({ type: 'player/error', message: null });
  }

  dispose(): void {
    this.transport.dispose();
    this.undoOffer.drop();
    window.removeEventListener('pagehide', this.flushSave);
    document.removeEventListener('visibilitychange', this.flushSave);
    this.sync.dispose();
    this.liveSource.dispose();
    this.probeClient.terminate();
    this.analysis.dispose();
    void this.engine.dispose();
  }
}
