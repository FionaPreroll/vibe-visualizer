import {
  hintRange,
  nearestBeat,
  TEMPO_HINT_RANGE,
  TEMPO_RANGES,
  type BeatGrid,
} from '../analysis/beat-grid';
import {
  clampShift,
  downbeatAt,
  NO_GRID_EDIT,
  sameGridEdit,
  shiftBars,
  type GridEdit,
} from '../analysis/grid-edit';
import type { TrackLoudness } from '../analysis/track-loudness';
import { rateLimits, TEMPO_STEP, type SoundSettings } from '../audio/dsp/sound-settings';
import { AudioEngine, type NextFile } from '../audio/engine/audio-engine';
import {
  closeInput,
  openDevice,
  openDisplay,
  type InputDevice,
  type LiveSourceKind,
  type OpenedInput,
} from '../audio/live-input';
import { entriesFromFiles, type QueueEntry } from '../library/folder-reader';
import type { ProbeResult } from '../library/probe.worker';
import ProbeWorker from '../library/probe.worker.ts?worker';
import {
  accessOf,
  loadQueue,
  requestAccess,
  saveQueue,
  storedInfo,
  type Access,
  type StoredQueue,
} from '../library/queue-store';
import { TrackAnalyzer, type TrackAnalysisState } from '../library/track-analyzer';
import { readCover, writeCover } from '../library/track-covers';
import { sameTrackColors, sanitizeTrackColors, type TrackColors } from '../render/cover-palette';
import { nextTrack, previousTrack, type PlayOrder } from './play-order';
import {
  CUE_COUNT,
  initialState,
  isPlayable,
  newTrack,
  reducer,
  restoredTrack,
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
import { createStore, type Store } from '../state/store';
import { errorMessage } from '../util/format';
import { WorkerClient } from '../util/worker-rpc';

/** Speed change while nudging (TMP-03). */
export const NUDGE = 0.04;
/** How long a removal or deletion can be undone (seconds). */
const UNDO_SECONDS = 8;
/** How often scrubbing (the jog wheel) seeks, at most, in ms; the moves in between add up. */
const SCRUB_SEEK_MS = 60;

/** Where a track starts when it plays from the queue: its in marker (TR-09), or its start. */
function startOf(track: Track | null | undefined): number {
  return track?.marks.in ?? 0;
}

/**
 * Where playback of `track` from `position` on stops: at its out marker while that lies ahead,
 * otherwise at its end (null). So the markers make a play range, and the queue moves on at the
 * out marker; past it (after a seek) the track plays to its end.
 */
function endFrom(track: Track | null | undefined, position: number): number | null {
  const out = track?.marks.out ?? null;
  return out !== null && position < out ? out : null;
}

/** A file in the engine's stream, by the engine's token: the one heard, or the one that follows. */
export interface StreamFile {
  token: number;
  /** The queue entry it plays. */
  id: string;
}

/**
 * Connects the queue state with the audio engine: every user command goes through here, is
 * recorded as an action, and drives the engine.
 */
export class Player {
  readonly store: Store<AppState, AppAction>;
  readonly engine = new AudioEngine();
  /** Waveforms and beat grids of the queue's tracks (a Svelte store). */
  readonly analysis = new TrackAnalyzer();
  private readonly files = new Map<string, File>();
  /** Handles to the files, where the browser gives them: the queue keeps them (SRC-05). */
  private readonly handles = new Map<string, FileSystemFileHandle>();
  private readonly probeClient = new WorkerClient(new ProbeWorker());
  private probing: Promise<void> = Promise.resolve();
  /** The covers the user gave files (LS-21), by fingerprint: object URLs, null for none. */
  private readonly ownCovers = new Map<string, Promise<string | null>>();
  /** Resolves once the queue of the last visit is back (it is saved only after that). */
  private readonly restored: Promise<void>;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private unlocking: Promise<void> | null = null;
  private loadedId: string | null = null;
  /** The engine knows files by tokens: the heard one, and which track each token stands for. */
  private loadedToken = 0;
  private lastToken = 0;
  private readonly tokenTracks = new Map<number, string>();
  /**
   * What follows the heard file without a gap (PL-04, PL-05): planned for the file with token
   * `after`, with the shuffle and repeat settings `order`; `next` is null when nothing follows.
   */
  private plan: {
    after: number;
    order: string;
    /** The next track, and the range it plays (its markers when planned). */
    next: { id: string; token: number; start: number; end: number | null } | null;
  } | null = null;
  /** Position of the loaded track when last read (shown while the engine counts in another). */
  private lastPosition = 0;
  /**
   * While the playhead is scrubbed (the jog wheel): where it was put, and when
   * (performance.now()). The position shows it at once, moving on with the music while playing;
   * the engine follows at most every SCRUB_SEEK_MS.
   */
  private scrubbed: { seconds: number; at: number } | null = null;
  private scrubTimer: ReturnType<typeof setTimeout> | undefined;
  private scrubMoved = false;
  /** The newest seek of the scrubbing: once it is done, the engine is where the playhead is. */
  private scrubSeek: Promise<void> = Promise.resolve();
  /** The last removal or deletion, while it can be undone; `release` lets it go for good. */
  private undoEntry: {
    restore: () => void;
    release: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** The beat grids and loudness the engine has, by token. */
  private readonly sentGrids = new Map<
    number,
    { grid: BeatGrid | null; loudness: TrackLoudness | null }
  >();
  /** Tracks played in this shuffle round, oldest first (PL-04). */
  private played: string[] = [];
  private busy = false;
  /** Counts loads and seeks: a newer one replaces older ones in the engine. */
  private request = 0;
  private readonly endCheck: ReturnType<typeof setInterval>;
  /** The live input's stream while it is the source. */
  private liveInput: OpenedInput | null = null;
  private streamFiles: readonly StreamFile[] = [];
  private readonly streamListeners = new Set<(files: readonly StreamFile[]) => void>();
  /**
   * The files of the engine's stream (a Svelte store): the track heard and the one that follows,
   * by their tokens. The visuals know by the token which track the music they show comes from.
   */
  readonly stream = {
    subscribe: (listener: (files: readonly StreamFile[]) => void): (() => void) => {
      this.streamListeners.add(listener);
      listener(this.streamFiles);
      return () => this.streamListeners.delete(listener);
    },
  };
  /** Increases with every start or stop of live input; stale attempts are dropped. */
  private liveToken = 0;
  /** The engine's last trouble (NF-09): its message goes once the music plays again. */
  private trouble: string | null = null;

  constructor() {
    this.store = createStore<AppState, AppAction>(
      initialState(loadSettings(), loadVisuals(), loadKaleido(), loadSound()),
      reducer,
    );
    this.engine.volume = this.state.settings.volume;
    this.engine.inputGainDecibels = this.state.settings.inputGain;
    this.engine.syncOffset = this.state.settings.syncOffset / 1000;
    this.engine.sound = this.state.sound;
    // The sound stopped without being asked to (NF-09): the music pauses, and the error says
    // why. Play starts it again.
    this.engine.onTrouble = (message) => {
      if (this.state.playing) this.pause();
      this.trouble = message;
      this.reportError(message);
    };
    whenStorageFails((error) =>
      this.reportError(
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? "The browser's storage is full: changes are not saved, and are gone after a reload. Free some space on the disk."
          : 'This browser does not let the app store anything: changes are gone after a reload.',
      ),
    );
    this.updateTrackerRange();
    let lastSettings = this.state.settings;
    let lastVisuals = this.state.visuals;
    let lastKaleido = this.state.kaleido;
    let lastSound = this.state.sound;
    let lastTracks = this.state.tracks;
    let lastCurrent = this.state.currentId;
    this.store.subscribe((state) => {
      this.updateTrackerRange();
      const queueChanged =
        state.tracks !== lastTracks ||
        state.settings.shuffle !== lastSettings.shuffle ||
        state.settings.repeat !== lastSettings.repeat;
      if (state.tracks !== lastTracks || state.currentId !== lastCurrent) this.scheduleSave();
      lastCurrent = state.currentId;
      if (state.tracks !== lastTracks) {
        this.storeTrackData(lastTracks, state.tracks);
        // The playing track's out marker may have moved: its stream stops somewhere else now.
        const before = lastTracks.find((track) => track.id === this.loadedId);
        const after = state.tracks.find((track) => track.id === this.loadedId);
        lastTracks = state.tracks;
        if (before && after && before.marks !== after.marks) this.updateEnd();
      }
      // The queue or the order changed: the track that follows may be another one.
      if (queueChanged) this.planNext();
      if (state.sound !== lastSound) {
        lastSound = state.sound;
        saveSound(state.sound);
        this.engine.sound = state.sound;
      }
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
      this.engine.inputGainDecibels = state.settings.inputGain;
      this.engine.syncOffset = state.settings.syncOffset / 1000;
    });
    this.endCheck = setInterval(() => {
      this.followStream();
      this.advanceAtEnd();
      this.publishStream();
    }, 50);
    // Beat grids go to the engine once they are known.
    this.analysis.subscribe(() => this.sendBeatGrids());
    this.restored = this.restore().catch((error: unknown) => {
      console.error('The queue of the last visit could not be restored', error);
    });
    window.addEventListener('pagehide', this.flushSave);
  }

  /** A new token for the file of track `id`. */
  private newToken(id: string): number {
    const token = ++this.lastToken;
    this.tokenTracks.set(token, id);
    // Only recent tokens can still come back from the engine.
    for (const old of this.tokenTracks.keys()) {
      if (old > token - 32) break;
      this.tokenTracks.delete(old);
    }
    return token;
  }

  /** Gives the engine the beat grids of the heard and the next file, when they change. */
  private sendBeatGrids(): void {
    const wanted = new Map<number, string>();
    if (this.loadedId !== null) wanted.set(this.loadedToken, this.loadedId);
    const next = this.plan?.next;
    if (next) wanted.set(next.token, next.id);
    for (const [token, id] of wanted) {
      const track = this.state.tracks.find((entry) => entry.id === id) ?? null;
      const analysis = this.analysisOf(track);
      const grid = analysis?.grid ?? null;
      const loudness = analysis?.loudness ?? null;
      const sent = this.sentGrids.get(token);
      if (sent && sent.grid === grid && sent.loudness === loudness) continue;
      this.sentGrids.set(token, { grid, loudness });
      this.engine.setFileAnalysis(token, grid, loudness);
    }
    for (const token of this.sentGrids.keys()) {
      if (!wanted.has(token)) this.sentGrids.delete(token);
    }
    this.publishStream();
  }

  /** Tells the subscribers of {@link stream} when the heard or the next file changed. */
  private publishStream(): void {
    const files: StreamFile[] = [];
    if (this.loadedId !== null && !this.live) {
      files.push({ token: this.loadedToken, id: this.loadedId });
      const next = this.plan?.after === this.loadedToken ? this.plan.next : null;
      if (next) files.push({ token: next.token, id: next.id });
    }
    const old = this.streamFiles;
    const same =
      old.length === files.length &&
      files.every((file, i) => file.token === old[i]!.token && file.id === old[i]!.id);
    if (same) return;
    this.streamFiles = files;
    for (const listener of this.streamListeners) listener(files);
  }

  private get order(): PlayOrder {
    return { shuffle: this.state.settings.shuffle, repeat: this.state.settings.repeat };
  }

  /**
   * Plans what follows the file with token `after`, the track `currentId` (PL-04, PL-05). A plan
   * for the same file stays while it still fits (a shuffled pick is kept). Returns true if it
   * changed.
   */
  private updatePlan(after: number, currentId: string): boolean {
    const order = this.order;
    const key = `${order.shuffle}:${order.repeat}`;
    const old = this.plan?.after === after ? this.plan : null;
    const kept = old?.next ?? null;
    const keep =
      kept !== null &&
      order.shuffle &&
      order.repeat !== 'one' &&
      old?.order === key &&
      kept.id !== currentId &&
      this.state.tracks.some((track) => track.id === kept.id && isPlayable(track));
    const id = keep ? kept.id : nextTrack(this.state.tracks, currentId, this.played, order, true);
    const nextId = id !== null && this.files.has(id) ? id : null;
    const track = this.state.tracks.find((entry) => entry.id === nextId);
    const start = startOf(track);
    const end = track?.marks.out ?? null;
    if (old && (old.next?.id ?? null) === nextId) {
      old.order = key;
      // The same track, but its markers moved: the same file, with another range.
      if (!old.next || (old.next.start === start && old.next.end === end)) return false;
      old.next = { ...old.next, start, end };
      return true;
    }
    this.plan = {
      after,
      order: key,
      next: nextId === null ? null : { id: nextId, token: this.newToken(nextId), start, end },
    };
    return true;
  }

  /** The planned next file, as the engine takes it. */
  private nextFile(): NextFile | null {
    const next = this.plan?.next;
    const file = next ? this.files.get(next.id) : undefined;
    return next && file ? { file, token: next.token, start: next.start, end: next.end } : null;
  }

  /**
   * The playing track's out marker moved: the stream stops at the new one. If it has already
   * taken the audio beyond, it starts again at the current position.
   */
  private updateEnd(): void {
    if (this.loadedId === null || this.live || this.busy) return;
    const token = this.loadedToken;
    const track = this.state.tracks.find((entry) => entry.id === this.loadedId);
    void this.engine.setEnd(token, endFrom(track, this.position)).then(
      (taken) => {
        const still = token === this.loadedToken && this.engine.heardToken === token;
        if (!taken && still && !this.busy) void this.seek(this.position);
      },
      () => undefined,
    );
  }

  /**
   * Plans again what follows the heard file (the queue or the order changed, or another file is
   * heard) and tells the engine. If the stream already runs into the file planned before, it
   * starts again at the current position, with the new plan.
   */
  private planNext(): void {
    if (this.loadedId === null || this.live || this.busy) return;
    const heard = this.loadedToken;
    if (!this.updatePlan(heard, this.loadedId)) return;
    this.sendBeatGrids();
    void this.engine.queueNext(heard, this.nextFile()).then(
      (taken) => {
        const still = heard === this.loadedToken && this.engine.heardToken === heard;
        if (!taken && still && !this.busy) void this.seek(this.position);
      },
      () => undefined,
    );
  }

  /** Follows the stream into the next file once it is heard (a gapless transition). */
  private followStream(): void {
    if (this.loadedId === null || this.live || this.busy) return;
    const token = this.engine.heardToken;
    if (token === this.loadedToken) return;
    const id = this.tokenTracks.get(token);
    if (!id || !this.files.has(id)) return;
    this.endScrub();
    this.loadedId = id;
    this.loadedToken = token;
    this.dispatch({ type: 'player/current', id });
    this.notePlayed(id);
    const fingerprint = this.currentTrack?.fingerprint;
    const file = this.files.get(id);
    if (fingerprint && file) this.requestAnalysis(fingerprint, file, true);
    // What follows this file: the stream waits for the answer at its end.
    this.planNext();
  }

  /**
   * Remembers `id` as played in this shuffle round. Once all have played, the next one starts a
   * new round (with repeat off, the plan then ends the queue instead).
   */
  private notePlayed(id: string): void {
    const playable = this.state.tracks.filter(isPlayable);
    const complete = playable.every((track) => this.played.includes(track.id));
    this.played = complete ? [id] : [...this.played.filter((entry) => entry !== id), id];
  }

  get state(): AppState {
    return this.store.state;
  }

  get currentTrack(): Track | null {
    return this.state.tracks.find((track) => track.id === this.state.currentId) ?? null;
  }

  /** Playback position of the current track in seconds. */
  get position(): number {
    if (this.loadedId === null) return 0;
    const scrubbed = this.scrubPosition();
    if (scrubbed !== null) return scrubbed;
    // Just after a gapless transition the engine counts in the next file already; until the
    // player follows (within one check), the current track stays where it was last.
    if (this.engine.heardToken !== this.loadedToken) return this.lastPosition;
    this.lastPosition = this.engine.position;
    return this.lastPosition;
  }

  private dispatch(action: AppAction): void {
    this.store.dispatch(action);
  }

  addFiles(files: Iterable<File>): void {
    this.addEntries(entriesFromFiles(files));
  }

  /**
   * Appends files to the queue (SRC-01, SRC-03). A file that an entry of the last visit misses
   * brings that entry back instead (SRC-05). The files of a folder are sorted by track number
   * once probed, where their tags have one.
   */
  addEntries(entries: readonly QueueEntry[]): void {
    const tracks: Track[] = [];
    const ids: string[] = [];
    const folders = new Map<string, string[]>();
    for (const entry of entries) {
      const { file, handle } = entry;
      const waiting = this.state.tracks.find(
        (track) =>
          (track.status === 'missing' || track.status === 'locked') &&
          track.fileName === file.name &&
          track.size === file.size &&
          !this.files.has(track.id),
      );
      const id = waiting?.id ?? crypto.randomUUID();
      this.files.set(id, file);
      if (handle) this.handles.set(id, handle);
      if (waiting) this.dispatch({ type: 'tracks/access', id, status: 'probing' });
      else tracks.push(newTrack(id, file));
      ids.push(id);
      if (entry.folder === null) continue;
      const group = folders.get(entry.folder);
      if (group) group.push(id);
      else folders.set(entry.folder, [id]);
    }
    if (tracks.length > 0) this.dispatch({ type: 'tracks/added', tracks });
    const probes = new Map(ids.map((id) => [id, this.queueProbe(id)]));
    if (folders.size > 0) void this.arrange([...folders.values()], probes);
  }

  /** Shows an error (from reading dropped files, for example). */
  reportError(message: string): void {
    this.dispatch({ type: 'player/error', message });
  }

  /** Probes the entry after the ones before it; null when it was removed meanwhile. */
  private queueProbe(id: string): Promise<ProbeResult | null> {
    const result = this.probing.then(() => this.probe(id));
    this.probing = result.then(() => undefined);
    return result;
  }

  /**
   * Sorts the files of each folder by disc and track number, once they are probed, unless the
   * user has moved them meanwhile (SRC-03). A folder in which a file has no number stays sorted
   * by name.
   */
  private async arrange(
    folders: string[][],
    probes: Map<string, Promise<ProbeResult | null>>,
  ): Promise<void> {
    for (const ids of folders) {
      const results = await Promise.all(ids.map((id) => probes.get(id)));
      const found = ids.flatMap((id, index) => {
        const result = results[index];
        return result?.status === 'ready' ? [{ id, index, result }] : [];
      });
      if (found.length < 2 || found.some(({ result }) => result.trackNumber === null)) continue;
      const number = (result: ProbeResult & { status: 'ready' }) =>
        (result.discNumber ?? 1) * 10000 + result.trackNumber!;
      const sorted = [...found]
        .sort((a, b) => number(a.result) - number(b.result) || a.index - b.index)
        .map(({ id }) => id);
      const listed = new Set(sorted);
      const now = this.state.tracks
        .filter((track) => listed.has(track.id))
        .map((track) => track.id);
      const before = found.map(({ id }) => id).filter((id) => now.includes(id));
      const moved = now.join('\n') !== before.join('\n');
      if (!moved && sorted.some((id, index) => id !== before[index])) {
        this.dispatch({ type: 'tracks/arranged', ids: sorted });
      }
    }
  }

  private async probe(id: string): Promise<ProbeResult | null> {
    const file = this.files.get(id);
    if (!file) return null;
    const result = await this.probeClient
      .call<ProbeResult>('probe', { file })
      .catch((error: unknown): ProbeResult => ({
        status: 'unsupported',
        reason: errorMessage(error),
      }));
    if (this.files.get(id) !== file) return null; // removed (or replaced) meanwhile
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
          fingerprint: null,
        },
      });
      return result;
    }
    const coverUrl = result.cover
      ? URL.createObjectURL(new Blob([result.cover.data], { type: result.cover.mimeType }))
      : null;
    const stored = loadTrackData(result.fingerprint, result.duration);
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
        fingerprint: result.fingerprint,
        ...(stored ? { stored } : {}),
      },
    });
    this.loadOwnCover(result.fingerprint);
    // Waveform and beat grid in the background; the track that plays first.
    this.requestAnalysis(result.fingerprint, file, id === this.state.currentId);
    return result;
  }

  /**
   * Shows the cover the user gave the file of `fingerprint` (LS-21), if there is one: read once,
   * one object URL for every entry of the file.
   */
  private loadOwnCover(fingerprint: string): void {
    let cover = this.ownCovers.get(fingerprint);
    if (!cover) {
      cover = readCover(fingerprint).then(
        (blob) => (blob ? URL.createObjectURL(blob) : null),
        () => null,
      );
      this.ownCovers.set(fingerprint, cover);
    }
    void cover.then((url) => {
      if (url && this.ownCovers.get(fingerprint) === cover) {
        this.dispatch({ type: 'tracks/cover', fingerprint, url });
      }
    });
  }

  /**
   * Gives the file of track `id` a cover of the user's (LS-21), made by `prepareCover`, for
   * every entry of that file; it shows instead of the file's, in the queue, on the logo and in
   * exports, and is kept for the file. Null takes it away.
   */
  async setOwnCover(id: string, cover: Blob | null): Promise<void> {
    const fingerprint = this.state.tracks.find((track) => track.id === id)?.fingerprint;
    if (!fingerprint) return;
    const url = cover ? URL.createObjectURL(cover) : null;
    const previous = this.ownCovers.get(fingerprint);
    this.ownCovers.set(fingerprint, Promise.resolve(url));
    this.dispatch({ type: 'tracks/cover', fingerprint, url });
    void previous?.then((old) => old && URL.revokeObjectURL(old));
    if (cover) void keepStorage();
    await writeCover(fingerprint, cover);
  }

  /** Brings back the queue of the last visit (SRC-05), with the files the browser still gives. */
  private async restore(): Promise<void> {
    const stored = await loadQueue();
    if (!stored || stored.entries.length === 0) return;
    const tracks: Track[] = [];
    for (const { id, info, handle } of stored.entries) {
      const access = handle ? await accessOf(handle).catch((): Access => 'denied') : 'denied';
      const file = handle && access === 'granted' ? await handle.getFile().catch(() => null) : null;
      const status = file ? 'probing' : access === 'prompt' ? 'locked' : 'missing';
      if (file) this.files.set(id, file);
      if (handle && status !== 'missing') this.handles.set(id, handle);
      const data =
        info.fingerprint && info.duration !== null
          ? loadTrackData(info.fingerprint, info.duration)
          : null;
      tracks.push(restoredTrack(id, info, status, data));
    }
    this.dispatch({ type: 'tracks/restored', tracks, currentId: stored.currentId });
    // The user's covers show at once, also for files that need permission first.
    for (const track of tracks) if (track.fingerprint) this.loadOwnCover(track.fingerprint);
    for (const track of tracks) if (track.status === 'probing') void this.queueProbe(track.id);
  }

  /**
   * Asks for access to the files of the last visit (SRC-05); call it from a click. The browser
   * may ask once for all of them; if the user declines, the rest stays locked.
   */
  unlock(): Promise<void> {
    this.unlocking ??= this.unlockAll().finally(() => (this.unlocking = null));
    return this.unlocking;
  }

  private async unlockAll(): Promise<void> {
    for (const track of this.state.tracks.filter((entry) => entry.status === 'locked')) {
      const handle = this.handles.get(track.id);
      if (!handle || this.files.has(track.id)) continue;
      const access = await accessOf(handle).catch((): Access => 'denied');
      if (access === 'prompt' && !(await requestAccess(handle).catch(() => false))) return;
      const file = access === 'denied' ? null : await handle.getFile().catch(() => null);
      if (!this.state.tracks.some((entry) => entry.id === track.id)) continue; // removed
      if (!file) {
        this.handles.delete(track.id);
        this.dispatch({ type: 'tracks/access', id: track.id, status: 'missing' });
        continue;
      }
      this.files.set(track.id, file);
      this.dispatch({ type: 'tracks/access', id: track.id, status: 'probing' });
      void this.queueProbe(track.id);
    }
  }

  /** Saves the queue soon (SRC-05): changes come in bursts. */
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 400);
  }

  private readonly flushSave = () => {
    flushWrites();
    if (this.saveTimer !== undefined) void this.save();
  };

  private async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.restored;
    const queue: StoredQueue = {
      entries: this.state.tracks.map((track) => ({
        id: track.id,
        info: storedInfo(track),
        handle: this.handles.get(track.id) ?? null,
      })),
      currentId: this.state.currentId,
    };
    await saveQueue(queue);
  }

  /**
   * Sets the tempo (BPM) of the beat grid of track `id` and of every other entry of its file
   * (TMP-06), e.g. double the tempo found; null lets the grid find the tempo again. The grid is
   * computed anew in the background; tempos outside {@link TEMPO_HINT_RANGE} are ignored.
   */
  setTempo(id: string, bpm: number | null): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!fingerprint) return;
    if (bpm !== null && !(bpm >= TEMPO_HINT_RANGE.min && bpm <= TEMPO_HINT_RANGE.max)) return;
    const tempo = bpm === null ? null : Math.round(bpm * 100) / 100;
    if (tempo === track.tempo) return;
    this.dispatch({ type: 'tracks/tempo', fingerprint, tempo });
    const entry = this.state.tracks.find(
      (other) => other.fingerprint === fingerprint && this.files.has(other.id),
    );
    const file = entry ? this.files.get(entry.id) : undefined;
    if (file) this.requestAnalysis(fingerprint, file, id === this.state.currentId);
  }

  /**
   * The waveform and beat grid of a file: analysed in the background (the one that plays
   * first), with the tempo given for it (TMP-06) or in the tempo range (AN-12), and its grid
   * corrected as the user did (TR-11).
   */
  private requestAnalysis(fingerprint: string, file: File, first: boolean): void {
    const track = this.state.tracks.find((entry) => entry.fingerprint === fingerprint);
    this.analysis.setEdit(fingerprint, track?.gridEdit ?? NO_GRID_EDIT);
    this.analysis.request(fingerprint, file, first, {
      tempo: track?.tempo ?? null,
      range: this.state.settings.bpmRange,
      fixed: track?.fixedTempo ?? false,
    });
  }

  /**
   * One tempo throughout for track `id` and every other entry of its file (TR-12), or not: its
   * beat grid is computed anew, straight from the start to the end, with bars that keep their
   * place.
   */
  setFixedTempo(id: string, fixed: boolean): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!fingerprint || track.fixedTempo === fixed) return;
    this.dispatch({ type: 'tracks/fixed', fingerprint, fixed });
    const entry = this.state.tracks.find(
      (other) => other.fingerprint === fingerprint && this.files.has(other.id),
    );
    const file = entry ? this.files.get(entry.id) : undefined;
    if (file) this.requestAnalysis(fingerprint, file, id === this.state.currentId);
  }

  /**
   * Gives the file of track `id` colours for the visuals (VE-12), for every entry of that file:
   * its cover's, colours of the user's own, or the look's; null: its cover's, as found.
   */
  /** The look the visuals take when the track starts (PR-06); null: none. */
  setTrackLook(id: string, look: TrackLook | null): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!track || !fingerprint) return;
    const next = sanitizeTrackLook(look);
    if (JSON.stringify(next) === JSON.stringify(track.look)) return;
    this.dispatch({ type: 'tracks/look', fingerprint, look: next });
  }

  setTrackColors(id: string, colors: TrackColors | null): void {
    const track = this.state.tracks.find((entry) => entry.id === id);
    const fingerprint = track?.fingerprint;
    if (!fingerprint || sameTrackColors(track.colors, colors)) return;
    this.dispatch({ type: 'tracks/colors', fingerprint, colors: sanitizeTrackColors(colors) });
  }

  /** New grids in the new tempo range (AN-12) for the files without a tempo given. */
  private regridAll(): void {
    const done = new Set<string>();
    const current = this.currentTrack;
    const tracks = current ? [current, ...this.state.tracks] : this.state.tracks;
    for (const track of tracks) {
      const file = this.files.get(track.id);
      if (!track.fingerprint || !file || done.has(track.fingerprint)) continue;
      done.add(track.fingerprint);
      if (track.tempo === null) this.requestAnalysis(track.fingerprint, file, track === current);
    }
  }

  /**
   * Corrects the beat grid of the current track (TR-11), for every entry of its file: `change`
   * gives the new correction from the corrected grid and the correction so far. With `commit`
   * false only the grid follows (while the grid is dragged); the correction is kept once it is
   * committed.
   */
  private editGrid(change: (grid: BeatGrid, edit: GridEdit) => GridEdit, commit = true): void {
    const track = this.currentTrack;
    const fingerprint = track?.fingerprint;
    const grid = this.analysisOf(track)?.grid;
    if (!track || !fingerprint || !grid) return;
    const edit = change(grid, track.gridEdit);
    this.analysis.setEdit(fingerprint, edit);
    if (commit && !sameGridEdit(edit, track.gridEdit)) {
      this.dispatch({ type: 'tracks/grid', fingerprint, edit });
    }
  }

  /** The beat nearest to the playhead becomes the first of its bar (TR-11). */
  setDownbeat(): void {
    this.editGrid((grid, edit) => downbeatAt(grid, edit, this.position));
  }

  /** The bars start one beat later (1) or earlier (-1) (TR-11). */
  moveBars(direction: -1 | 1): void {
    this.editGrid((grid, edit) => shiftBars(grid, edit, this.position, direction));
  }

  /** Moves the beat grid by `seconds` (TR-11): later for a positive value. */
  nudgeGrid(seconds: number): void {
    this.editGrid((_, edit) => ({ ...edit, shift: clampShift(edit.shift + seconds) }));
  }

  /**
   * Moves the beat grid to `shift` seconds from where the analysis put it (TR-11), as it is
   * dragged; `commit` once the drag ends.
   */
  shiftGrid(shift: number, commit: boolean): void {
    this.editGrid((_, edit) => ({ ...edit, shift: clampShift(shift) }), commit);
  }

  /** The beat grid of the current track as the analysis found it (TR-11). */
  resetGrid(): void {
    this.editGrid(() => NO_GRID_EDIT);
  }

  /**
   * Sets the tempo (BPM) of the live input (TMP-06): the live beat tracking keeps close to it;
   * null lets it find the tempo itself. Tempos outside {@link TEMPO_HINT_RANGE} are ignored.
   */
  setLiveTempo(bpm: number | null): void {
    if (bpm !== null && !(bpm >= TEMPO_HINT_RANGE.min && bpm <= TEMPO_HINT_RANGE.max)) return;
    const tempo = bpm === null ? null : Math.round(bpm * 100) / 100;
    if (tempo !== this.state.live.tempo) this.dispatch({ type: 'live/tempo', tempo });
  }

  /**
   * The range of the live beat tracking (for live input, and for files until their grid is
   * there): around the tempo given for the live input (TMP-06), or the tempo range (AN-12).
   */
  private updateTrackerRange(): void {
    const { live, settings } = this.state;
    this.engine.tempoRange =
      live.status === 'on' && live.tempo !== null
        ? hintRange(live.tempo)
        : settings.bpmRange === 'auto'
          ? null
          : TEMPO_RANGES[settings.bpmRange];
  }

  /** Waveform and beat grid of a track, once analysed (TR-03, AN-07). */
  analysisOf(track: Track | null): TrackAnalysisState | undefined {
    return this.analysis.get(track?.fingerprint ?? null);
  }

  /** True while live input is the source (the transport is idle then). */
  get live(): boolean {
    return this.state.live.status !== 'off';
  }

  /** The audio input used last, or null for the default input. */
  get lastInputDevice(): InputDevice | null {
    const { inputDevice, inputDeviceLabel } = this.state.settings;
    return inputDevice ? { id: inputDevice, label: inputDeviceLabel } : null;
  }

  /**
   * Makes live input the source (IN-01, IN-02): an audio input (`device`: that input, or the
   * default one for null) or a tab or the screen (`display`). The queue pauses. Call from a
   * user gesture: the browser asks for permission.
   */
  async startLive(kind: LiveSourceKind, device: InputDevice | null = null): Promise<void> {
    const token = ++this.liveToken;
    this.dispatch({ type: 'live/starting', kind });
    try {
      await this.engine.start();
      const opened = kind === 'device' ? await openDevice(device) : await openDisplay();
      if (token !== this.liveToken) {
        closeInput(opened.stream);
        return;
      }
      const previous = this.liveInput;
      this.pause();
      // Every new source starts unmonitored: a microphone could feed back, a shared tab
      // already plays by itself.
      this.engine.monitorInput = false;
      try {
        this.engine.connectInput(opened.stream);
      } catch (error) {
        closeInput(opened.stream);
        if (previous) this.engine.connectInput(previous.stream);
        // Some browsers only accept inputs at the engine's sample rate.
        throw new Error(
          error instanceof DOMException && error.name === 'NotSupportedError'
            ? 'This browser cannot use this input at 48 kHz. Set the device to 48 kHz in the system sound settings, or use Chrome.'
            : errorMessage(error),
          { cause: error },
        );
      }
      if (previous) closeInput(previous.stream);
      this.liveInput = opened;
      for (const track of opened.stream.getAudioTracks()) {
        // Unplugged, or sharing stopped in the browser's bar.
        track.addEventListener('ended', () => {
          if (this.liveInput === opened) {
            this.stopLive(kind === 'display' ? 'Sharing has ended.' : 'The audio input was lost.');
          }
        });
      }
      this.dispatch({ type: 'live/started', kind, label: opened.label });
      if (kind === 'device') {
        const { inputDevice, inputDeviceLabel } = this.state.settings;
        const id = opened.device?.id ?? '';
        const label = opened.device?.label ?? '';
        if (id !== inputDevice || label !== inputDeviceLabel) {
          this.updateSettings({ inputDevice: id, inputDeviceLabel: label });
        }
      }
    } catch (error) {
      if (token !== this.liveToken) return;
      this.dispatch({
        type: 'live/failed',
        message: errorMessage(error),
        running: this.liveInput !== null,
      });
    }
  }

  /** Back to the queue as the source; monitoring goes off. */
  stopLive(reason: string | null = null): void {
    this.liveToken++;
    this.engine.monitorInput = false;
    this.engine.disconnectInput();
    if (this.liveInput) closeInput(this.liveInput.stream);
    this.liveInput = null;
    this.dispatch({ type: 'live/stopped', reason });
  }

  /** Hearing the live input through the app (IN-04). */
  setMonitor(monitor: boolean): void {
    this.engine.monitorInput = monitor;
    this.dispatch({ type: 'live/monitor', monitor });
  }

  /** Plays the track with `id` from `startSeconds`. Call from a user gesture the first time. */
  /**
   * Plays the track with `id` from `startSeconds` (by default its in marker) to its out marker.
   * Call from a user gesture the first time.
   */
  async playTrack(id: string, startSeconds?: number): Promise<void> {
    // An entry of the last visit: the click that plays it can unlock it.
    const locked = this.state.tracks.find((track) => track.id === id)?.status === 'locked';
    if (locked && !this.files.has(id)) await this.unlock();
    const file = this.files.get(id);
    if (!file) return;
    // Choosing a track explicitly switches back from live input.
    if (this.live) this.stopLive();
    this.endScrub();
    const request = ++this.request;
    this.busy = true;
    try {
      await this.engine.start();
      this.engine.paused = true;
      // The planned next track is open in the engine already.
      const planned = this.plan?.next;
      const token = planned?.id === id ? planned.token : this.newToken(id);
      // What follows is planned first: the engine opens it right away, for a gapless start.
      this.notePlayed(id);
      this.updatePlan(token, id);
      const track = this.state.tracks.find((entry) => entry.id === id);
      const start = startSeconds ?? startOf(track);
      await this.engine.load(file, start, token, endFrom(track, start), this.nextFile());
      if (request !== this.request) return;
      this.loadedId = id;
      this.loadedToken = token;
      this.dispatch({ type: 'player/current', id });
      const fingerprint = this.currentTrack?.fingerprint;
      if (fingerprint) this.requestAnalysis(fingerprint, file, true);
      this.sendBeatGrids();
      this.engine.paused = false;
      this.dispatch({ type: 'player/playing', playing: true });
      this.dispatch({ type: 'player/error', message: null });
    } catch (error) {
      if (request !== this.request) return;
      this.engine.paused = true;
      this.dispatch({ type: 'player/playing', playing: false });
      this.dispatch({
        type: 'player/error',
        message: `Cannot play ${file.name}: ${errorMessage(error)}`,
      });
    } finally {
      this.settle(request);
    }
  }

  /** After a load or seek: the queue may have changed meanwhile. */
  private settle(request: number): void {
    if (request !== this.request) return;
    this.busy = false;
    this.planNext();
  }

  async play(): Promise<void> {
    if (this.state.playing || this.live) return;
    const current = this.state.currentId;
    if (current !== null && current === this.loadedId) {
      await this.engine.start();
      if (this.engine.ended) {
        await this.playTrack(current);
        return;
      }
      this.anchorScrub();
      this.engine.paused = false;
      this.dispatch({ type: 'player/playing', playing: true });
      if (this.trouble !== null && this.state.error === this.trouble) {
        this.dispatch({ type: 'player/error', message: null });
      }
      this.trouble = null;
      return;
    }
    // The current entry, unless its file is not there (then the first one that plays).
    const entry = this.state.tracks.find((track) => track.id === current);
    const usable = entry && (isPlayable(entry) || entry.status === 'locked');
    const id = usable ? entry.id : this.state.tracks.find(isPlayable)?.id;
    if (id) await this.playTrack(id);
  }

  pause(): void {
    this.anchorScrub();
    this.engine.paused = true;
    this.dispatch({ type: 'player/playing', playing: false });
  }

  async toggle(): Promise<void> {
    if (this.state.playing) this.pause();
    else await this.play();
  }

  /** Pauses and goes back to where the track starts (its in marker). */
  async stop(): Promise<void> {
    this.pause();
    await this.seek(startOf(this.currentTrack));
  }

  async seek(seconds: number): Promise<void> {
    this.endScrub();
    await this.seekTo(seconds);
  }

  /**
   * Scrubs the playhead to `seconds` (the jog wheel): the position is there at once, and the
   * engine follows at most every SCRUB_SEEK_MS, so the playhead moves smoothly while seeks
   * start new streams. A seek ends it.
   */
  scrub(seconds: number): void {
    if (this.loadedId === null || this.live) return;
    const duration = this.currentTrack?.duration ?? Infinity;
    this.scrubbed = {
      seconds: Math.max(0, Math.min(seconds, duration - 0.05)),
      at: performance.now(),
    };
    if (this.scrubTimer !== undefined) {
      this.scrubMoved = true;
      return;
    }
    this.seekScrubbed();
  }

  /** Seeks to where the playhead is scrubbed; then again after SCRUB_SEEK_MS if it moved on. */
  private seekScrubbed(): void {
    const target = this.scrubPosition();
    if (target === null) return;
    const seek = this.seekTo(target);
    this.scrubSeek = seek;
    this.scrubTimer = setTimeout(() => {
      this.scrubTimer = undefined;
      if (this.scrubMoved) {
        this.scrubMoved = false;
        this.seekScrubbed();
        return;
      }
      // At rest: once the last seek is done, the engine's position takes over again.
      void seek.then(() => {
        if (this.scrubSeek === seek && this.scrubTimer === undefined) this.scrubbed = null;
      });
    }, SCRUB_SEEK_MS);
  }

  /** Where the playhead is scrubbed to, moving on with the music; null when not scrubbing. */
  private scrubPosition(): number | null {
    if (!this.scrubbed) return null;
    const { seconds, at } = this.scrubbed;
    if (!this.state.playing) return seconds;
    const duration = this.currentTrack?.duration ?? Infinity;
    return Math.min(duration, seconds + ((performance.now() - at) / 1000) * this.state.sound.rate);
  }

  /** Before playing or pausing: the scrubbed position counts from now. */
  private anchorScrub(): void {
    const seconds = this.scrubPosition();
    if (seconds !== null) this.scrubbed = { seconds, at: performance.now() };
  }

  private endScrub(): void {
    clearTimeout(this.scrubTimer);
    this.scrubTimer = undefined;
    this.scrubMoved = false;
    this.scrubbed = null;
  }

  private async seekTo(seconds: number): Promise<void> {
    const id = this.loadedId;
    const file = id !== null ? this.files.get(id) : undefined;
    if (id === null || !file || this.live) return;
    const duration = this.currentTrack?.duration ?? Infinity;
    const target = Math.max(0, Math.min(seconds, duration - 0.05));
    const request = ++this.request;
    this.busy = true;
    try {
      // A seek starts a new stream: what follows goes with it again.
      this.updatePlan(this.loadedToken, id);
      const end = endFrom(this.currentTrack, target);
      await this.engine.seek(target, this.loadedToken, file, end, this.nextFile());
      if (request !== this.request) return;
      this.dispatch({ type: 'player/seeked', seconds: target });
    } catch (error) {
      if (request !== this.request) return;
      this.dispatch({ type: 'player/error', message: errorMessage(error) });
    } finally {
      this.settle(request);
    }
  }

  async next(): Promise<void> {
    if (this.live) return;
    // The planned track (open in the engine already), unless that is this one again.
    const planned = this.plan?.after === this.loadedToken ? this.plan.next : null;
    const id =
      planned && planned.id !== this.state.currentId
        ? planned.id
        : nextTrack(this.state.tracks, this.state.currentId, this.played, this.order, false);
    if (id) await this.playTrack(id);
  }

  /** Restarts the track (at its in marker), or goes to the previous one when near its start. */
  async previous(): Promise<void> {
    if (this.live) return;
    const id = previousTrack(this.state.tracks, this.state.currentId, this.played, this.order);
    const start = startOf(this.currentTrack);
    if (this.position - start > 3 || !id) await this.seek(start);
    else await this.playTrack(id);
  }

  /** Removes a track from the queue (it can be undone for a moment). */
  async remove(id: string): Promise<void> {
    const index = this.state.tracks.findIndex((track) => track.id === id);
    const track = this.state.tracks[index];
    if (!track) return;
    const current = this.state.currentId === id;
    const kept = this.keepFiles([track]);
    if (id === this.loadedId) await this.unload();
    this.files.delete(id);
    this.handles.delete(id);
    this.dispatch({ type: 'tracks/removed', id });
    this.offerUndo(
      `Removed “${shownTitle(track)}”`,
      () => this.putBack(index, [track], current ? id : null, kept),
      () => this.forgetTracks([track]),
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
    const kept = this.keepFiles(tracks);
    await this.unload();
    this.files.clear();
    this.handles.clear();
    this.dispatch({ type: 'tracks/cleared' });
    this.offerUndo(
      tracks.length === 1
        ? 'Cleared the queue (1 track)'
        : `Cleared the queue (${tracks.length} tracks)`,
      () => this.putBack(0, tracks, current, kept),
      () => this.forgetTracks(tracks),
    );
  }

  /** The files and handles of `tracks`, to put them back on undo. */
  private keepFiles(tracks: readonly Track[]) {
    return tracks.map((track) => ({
      id: track.id,
      file: this.files.get(track.id),
      handle: this.handles.get(track.id),
    }));
  }

  /** Undoes a removal: the tracks and their files return at `index`. */
  private putBack(
    index: number,
    tracks: Track[],
    currentId: string | null,
    kept: ReturnType<Player['keepFiles']>,
  ): void {
    for (const { id, file, handle } of kept) {
      if (file) this.files.set(id, file);
      if (handle) this.handles.set(id, handle);
    }
    this.dispatch({ type: 'tracks/inserted', index, tracks, currentId });
    // A probe that was running when they went was dropped.
    for (const track of tracks) if (track.status === 'probing') void this.queueProbe(track.id);
  }

  /**
   * Removed tracks are gone for good: their covers, and the analyses and own covers (shown, not
   * stored) that no entry needs any more.
   */
  private forgetTracks(tracks: readonly Track[]): void {
    for (const track of tracks) {
      if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
      const fingerprint = track.fingerprint;
      if (fingerprint && !this.state.tracks.some((entry) => entry.fingerprint === fingerprint)) {
        this.analysis.forget(fingerprint);
        const cover = this.ownCovers.get(fingerprint);
        this.ownCovers.delete(fingerprint);
        void cover?.then((url) => url && URL.revokeObjectURL(url));
      }
    }
  }

  /** Offers to undo what was just done, for a few seconds or until the next such action. */
  private offerUndo(label: string, restore: () => void, release: () => void = () => {}): void {
    this.dropUndo();
    const timer = setTimeout(() => this.dropUndo(), UNDO_SECONDS * 1000);
    this.undoEntry = { restore, release, timer };
    this.dispatch({ type: 'undo/offered', label });
  }

  private dropUndo(): void {
    const entry = this.undoEntry;
    if (!entry) return;
    clearTimeout(entry.timer);
    this.undoEntry = null;
    entry.release();
    this.dispatch({ type: 'undo/offered', label: null });
  }

  /** Undoes the last removal or deletion, while that is offered (Ctrl+Z). */
  undo(): void {
    const entry = this.undoEntry;
    if (!entry) return;
    clearTimeout(entry.timer);
    this.undoEntry = null;
    entry.restore();
    this.dispatch({ type: 'undo/offered', label: null });
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
      this.offerUndo(`Cleared the ${mark} marker`, () => this.restoreMarks(track.id, marks));
    }
  }

  /** Clears both markers of the current track (it can be undone for a moment). */
  clearMarks(): void {
    const track = this.currentTrack;
    if (!track || (track.marks.in === null && track.marks.out === null)) return;
    const marks = track.marks;
    this.dispatch({ type: 'tracks/marked', id: track.id, mark: 'in', seconds: null });
    this.dispatch({ type: 'tracks/marked', id: track.id, mark: 'out', seconds: null });
    this.offerUndo('Cleared the markers', () => this.restoreMarks(track.id, marks));
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
      this.offerUndo(`Deleted cue ${index + 1}`, restore);
    }
  }

  /** The file behind a queue entry (for the export). */
  fileFor(id: string): File | null {
    return this.files.get(id) ?? null;
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
    if (this.state.settings.bpmRange !== range) this.regridAll();
  }

  dismissError(): void {
    this.dispatch({ type: 'player/error', message: null });
  }

  dispose(): void {
    clearInterval(this.endCheck);
    this.endScrub();
    this.dropUndo();
    window.removeEventListener('pagehide', this.flushSave);
    this.flushSave();
    if (this.liveInput) closeInput(this.liveInput.stream);
    this.probeClient.terminate();
    this.analysis.dispose();
    void this.engine.dispose();
  }

  /**
   * Keeps the cues, markers, tempo, grid correction, names and colours of each file (TR-05), so
   * they come back with it.
   */
  private storeTrackData(previous: readonly Track[], next: readonly Track[]): void {
    const before = new Map(previous.map((track) => [track.id, track]));
    for (const track of next) {
      if (!track.fingerprint) continue;
      const old = before.get(track.id);
      const unchanged =
        old?.fingerprint === track.fingerprint &&
        old.cues === track.cues &&
        old.marks === track.marks &&
        old.tempo === track.tempo &&
        old.fixedTempo === track.fixedTempo &&
        old.gridEdit === track.gridEdit &&
        old.edit === track.edit &&
        old.colors === track.colors &&
        old.look === track.look;
      if (!unchanged) {
        const { cues, marks, tempo, fixedTempo, gridEdit, edit, colors, look } = track;
        saveTrackData(track.fingerprint, {
          cues,
          marks,
          tempo,
          fixedTempo,
          gridEdit,
          edit,
          colors,
          look,
        });
      }
    }
  }

  /** Stops playing the loaded track and empties the engine (a newer load or seek is dropped). */
  private async unload(): Promise<void> {
    this.pause();
    this.endScrub();
    this.request++;
    this.busy = false;
    this.loadedId = null;
    this.plan = null;
    await this.engine.unload();
  }

  /**
   * When the stream has played to its end: the queue is over, or the next track could not
   * follow without a gap (then it starts now).
   */
  private advanceAtEnd(): void {
    if (!this.state.playing || this.busy || this.loadedId === null || !this.engine.ended) return;
    const plan = this.plan?.after === this.loadedToken ? this.plan : null;
    const next = plan
      ? (plan.next?.id ?? null)
      : nextTrack(this.state.tracks, this.loadedId, this.played, this.order, true);
    if (next) void this.playTrack(next);
    else this.pause();
  }
}
