import { AudioEngine } from '../audio/engine/audio-engine';
import type { ProbeResult } from '../library/probe.worker';
import ProbeWorker from '../library/probe.worker.ts?worker';
import {
  initialState,
  newTrack,
  reducer,
  type AppAction,
  type AppState,
  type Settings,
  type Track,
} from '../state/app-state';
import type { KaleidoSceneId, KaleidoSettings, ParamValue } from '../render/kaleido-settings';
import type { LogoSpectrumSettings } from '../render/visual-settings';
import {
  loadKaleido,
  loadSettings,
  loadVisuals,
  saveKaleido,
  saveSettings,
  saveVisuals,
} from '../state/persistence';
import { createStore, type Store } from '../state/store';
import { errorMessage } from '../util/format';
import { WorkerClient } from '../util/worker-rpc';

/**
 * Connects the queue state with the audio engine: every user command goes through here, is
 * recorded as an action, and drives the engine.
 */
export class Player {
  readonly store: Store<AppState, AppAction>;
  readonly engine = new AudioEngine();
  private readonly files = new Map<string, File>();
  private readonly probeClient = new WorkerClient(new ProbeWorker());
  private probing: Promise<void> = Promise.resolve();
  private loadedId: string | null = null;
  private busy = false;
  private readonly endCheck: ReturnType<typeof setInterval>;

  constructor() {
    this.store = createStore<AppState, AppAction>(
      initialState(loadSettings(), loadVisuals(), loadKaleido()),
      reducer,
    );
    this.engine.volume = this.state.settings.volume;
    let lastSettings = this.state.settings;
    let lastVisuals = this.state.visuals;
    let lastKaleido = this.state.kaleido;
    this.store.subscribe((state) => {
      if (state.visuals !== lastVisuals) {
        lastVisuals = state.visuals;
        saveVisuals(state.visuals);
      }
      if (state.kaleido !== lastKaleido) {
        lastKaleido = state.kaleido;
        saveKaleido(state.kaleido);
      }
      if (state.settings === lastSettings) return;
      lastSettings = state.settings;
      saveSettings(state.settings);
      this.engine.volume = state.settings.volume;
    });
    this.endCheck = setInterval(() => this.advanceAtEnd(), 100);
  }

  get state(): AppState {
    return this.store.state;
  }

  get currentTrack(): Track | null {
    return this.state.tracks.find((track) => track.id === this.state.currentId) ?? null;
  }

  /** Playback position of the current track in seconds. */
  get position(): number {
    return this.loadedId !== null ? this.engine.position : 0;
  }

  private dispatch(action: AppAction): void {
    this.store.dispatch(action);
  }

  addFiles(files: Iterable<File>): void {
    const tracks: Track[] = [];
    for (const file of files) {
      const id = crypto.randomUUID();
      this.files.set(id, file);
      tracks.push(newTrack(id, file));
    }
    if (tracks.length === 0) return;
    this.dispatch({ type: 'tracks/added', tracks });
    for (const track of tracks) {
      this.probing = this.probing.then(() => this.probe(track.id));
    }
  }

  private async probe(id: string): Promise<void> {
    const file = this.files.get(id);
    if (!file) return;
    const result = await this.probeClient
      .call<ProbeResult>('probe', { file })
      .catch((error: unknown): ProbeResult => ({
        status: 'unsupported',
        reason: errorMessage(error),
      }));
    if (!this.files.has(id)) return; // removed meanwhile
    if (result.status === 'unsupported') {
      this.dispatch({
        type: 'tracks/probed',
        id,
        info: {
          status: 'unsupported',
          reason: result.reason,
          title: null,
          artist: null,
          album: null,
          duration: null,
          sampleRate: null,
          codec: null,
          format: null,
          coverUrl: null,
        },
      });
      return;
    }
    const coverUrl = result.cover
      ? URL.createObjectURL(new Blob([result.cover.data], { type: result.cover.mimeType }))
      : null;
    this.dispatch({
      type: 'tracks/probed',
      id,
      info: {
        status: 'ready',
        reason: null,
        title: result.title,
        artist: result.artist,
        album: result.album,
        duration: result.duration,
        sampleRate: result.sampleRate,
        codec: result.codec,
        format: result.format,
        coverUrl,
      },
    });
  }

  /** Plays the track with `id` from `startSeconds`. Call from a user gesture the first time. */
  async playTrack(id: string, startSeconds = 0): Promise<void> {
    const file = this.files.get(id);
    if (!file) return;
    this.busy = true;
    try {
      await this.engine.start();
      this.engine.paused = true;
      await this.engine.load(file, startSeconds);
      this.loadedId = id;
      this.dispatch({ type: 'player/current', id });
      this.engine.paused = false;
      this.dispatch({ type: 'player/playing', playing: true });
      this.dispatch({ type: 'player/error', message: null });
    } catch (error) {
      this.engine.paused = true;
      this.dispatch({ type: 'player/playing', playing: false });
      this.dispatch({
        type: 'player/error',
        message: `Cannot play ${file.name}: ${errorMessage(error)}`,
      });
    } finally {
      this.busy = false;
    }
  }

  async play(): Promise<void> {
    if (this.state.playing) return;
    const current = this.state.currentId;
    if (current !== null && current === this.loadedId) {
      await this.engine.start();
      if (this.engine.ended) {
        await this.playTrack(current, 0);
        return;
      }
      this.engine.paused = false;
      this.dispatch({ type: 'player/playing', playing: true });
      return;
    }
    const id = current ?? this.state.tracks.find((track) => track.status !== 'unsupported')?.id;
    if (id) await this.playTrack(id);
  }

  pause(): void {
    this.engine.paused = true;
    this.dispatch({ type: 'player/playing', playing: false });
  }

  async toggle(): Promise<void> {
    if (this.state.playing) this.pause();
    else await this.play();
  }

  async stop(): Promise<void> {
    this.pause();
    await this.seek(0);
  }

  async seek(seconds: number): Promise<void> {
    if (this.loadedId === null) return;
    const duration = this.currentTrack?.duration ?? Infinity;
    const target = Math.max(0, Math.min(seconds, duration - 0.05));
    this.busy = true;
    try {
      await this.engine.seek(target);
      this.dispatch({ type: 'player/seeked', seconds: target });
    } catch (error) {
      this.dispatch({ type: 'player/error', message: errorMessage(error) });
    } finally {
      this.busy = false;
    }
  }

  async next(): Promise<void> {
    const id = this.neighbour(1);
    if (id) await this.playTrack(id);
  }

  /** Restarts the track, or goes to the previous one when near its start. */
  async previous(): Promise<void> {
    const id = this.neighbour(-1);
    if (this.position > 3 || !id) await this.seek(0);
    else await this.playTrack(id);
  }

  async remove(id: string): Promise<void> {
    if (id === this.loadedId) {
      this.pause();
      this.loadedId = null;
      await this.engine.unload();
    }
    this.releaseCover(id);
    this.files.delete(id);
    this.dispatch({ type: 'tracks/removed', id });
  }

  move(from: number, to: number): void {
    this.dispatch({ type: 'tracks/moved', from, to });
  }

  async clear(): Promise<void> {
    this.pause();
    this.loadedId = null;
    await this.engine.unload();
    for (const track of this.state.tracks) this.releaseCover(track.id);
    this.files.clear();
    this.dispatch({ type: 'tracks/cleared' });
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

  /**
   * Sets the in or out marker of the current track (TR-09), at the playback position unless
   * given; null clears it.
   */
  mark(mark: 'in' | 'out', seconds: number | null = this.position): void {
    const id = this.state.currentId;
    if (id === null) return;
    this.dispatch({ type: 'tracks/marked', id, mark, seconds });
  }

  /** The file behind a queue entry (for the export). */
  fileFor(id: string): File | null {
    return this.files.get(id) ?? null;
  }

  updateSettings(changes: Partial<Settings>): void {
    this.dispatch({ type: 'settings/changed', changes });
  }

  dismissError(): void {
    this.dispatch({ type: 'player/error', message: null });
  }

  dispose(): void {
    clearInterval(this.endCheck);
    this.probeClient.terminate();
    void this.engine.dispose();
  }

  private releaseCover(id: string): void {
    const url = this.state.tracks.find((track) => track.id === id)?.coverUrl;
    if (url) URL.revokeObjectURL(url);
  }

  /** The next playable track in `direction`, or null. */
  private neighbour(direction: 1 | -1): string | null {
    const tracks = this.state.tracks;
    let index = tracks.findIndex((track) => track.id === this.state.currentId);
    if (index < 0) return null;
    for (index += direction; index >= 0 && index < tracks.length; index += direction) {
      if (tracks[index]!.status !== 'unsupported') return tracks[index]!.id;
    }
    return null;
  }

  /** Moves on when the current track has played to its end. */
  private advanceAtEnd(): void {
    if (!this.state.playing || this.busy || this.loadedId === null || !this.engine.ended) return;
    const next = this.neighbour(1);
    if (next) void this.playTrack(next);
    else this.pause();
  }
}
