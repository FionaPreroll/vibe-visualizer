import type { BeatGrid } from '../analysis/beat-grid';
import type { TrackLoudness } from '../analysis/track-loudness';
import type { AudioEngine, NextFile } from '../audio/engine/audio-engine';
import type { TrackAnalyzer } from '../library/track-analyzer';
import { isPlayable, type AppAction, type AppState, type Track } from '../state/app-state';
import { select, watch } from '../state/select';
import type { Store } from '../state/store';
import { errorMessage } from '../util/format';
import type { Library } from './library';
import type { LiveSource } from './live-source';
import { nextTrack, previousTrack, type PlayOrder } from './play-order';

/** How often scrubbing (the jog wheel) seeks, at most, in ms; the moves in between add up. */
export const SCRUB_SEEK_MS = 60;

/** Where a track starts when it plays from the queue: its in marker (TR-09), or its start. */
export function startOf(track: Track | null | undefined): number {
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

/** What the transport needs of the engine: the AudioEngine, or a fake one. */
export type TransportEngine = Pick<
  AudioEngine,
  | 'start'
  | 'paused'
  | 'load'
  | 'seek'
  | 'unload'
  | 'queueNext'
  | 'setEnd'
  | 'setFileAnalysis'
  | 'position'
  | 'displayPosition'
  | 'heardToken'
  | 'ended'
>;

/**
 * Playing the queue (#55): playing, pausing, seeking and scrubbing a track between its markers
 * (TR-09), and the queue without gaps (PL-05): the engine knows files by tokens, and the
 * transport plans which file follows the heard one, in the order of shuffle and repeat (PL-04),
 * plans again when the queue, the order or the out marker changes, follows the stream into the
 * next file once it is heard, and moves on at the end.
 */
export class Transport {
  private loadedIdValue: string | null = null;
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
  private readonly stops: (() => void)[];
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
  /** The engine's last trouble (NF-09): its message goes once the music plays again. */
  private trouble: string | null = null;

  constructor(
    private readonly store: Store<AppState, AppAction>,
    private readonly engine: TransportEngine,
    /** The files of the queue's entries. */
    private readonly library: Pick<Library, 'file' | 'unlock'>,
    /** The waveforms and beat grids of the files, and the loudness, as they are found. */
    private readonly analysis: Pick<TrackAnalyzer, 'get' | 'subscribe'>,
    /** Asks for the analysis of a file that plays (it goes first). */
    private readonly analyse: (fingerprint: string, file: File, first: boolean) => void,
    /** Live input, which takes the place of the queue. */
    private readonly live: Pick<LiveSource, 'active' | 'stop'>,
  ) {
    this.stops = [
      watch(
        select(store, (state) => state.tracks),
        (now, before) => {
          // The playing track's out marker may have moved: its stream stops somewhere else now.
          const was = before.find((track) => track.id === this.loadedIdValue);
          const is = now.find((track) => track.id === this.loadedIdValue);
          if (was && is && was.marks !== is.marks) this.updateEnd();
          // The queue changed: the track that follows may be another one.
          this.planNext();
        },
      ),
      // The order changed: the track that follows may be another one.
      watch(
        select(store, ({ settings }) => `${settings.shuffle}:${settings.repeat}`),
        () => this.planNext(),
      ),
      // Beat grids go to the engine once they are known.
      analysis.subscribe(() => this.sendBeatGrids()),
    ];
    this.endCheck = setInterval(() => {
      this.followStream();
      this.advanceAtEnd();
      this.publishStream();
    }, 50);
  }

  /** The queue entry whose file the engine has, or null. */
  get loadedId(): string | null {
    return this.loadedIdValue;
  }

  /** Playback position of the current track in seconds. */
  get position(): number {
    if (this.loadedIdValue === null) return 0;
    const scrubbed = this.scrubPosition();
    if (scrubbed !== null) return scrubbed;
    // Just after a gapless transition the engine counts in the next file already; until the
    // player follows (within one check), the current track stays where it was last.
    if (this.engine.heardToken !== this.loadedToken) return this.lastPosition;
    this.lastPosition = this.engine.position;
    return this.lastPosition;
  }

  /**
   * The playback position to show (seconds) at `now` (as performance.now() gives it; an
   * animation frame's time, for what it draws): as {@link position}, but moving on smoothly
   * between the audio callbacks, for what moves with the music on screen (the playhead, the
   * detail waveform). What acts at the position (cues, markers, seeks) takes {@link position}.
   */
  displayPosition(now = performance.now()): number {
    if (this.loadedIdValue === null) return 0;
    const scrubbed = this.scrubPosition();
    if (scrubbed !== null) return scrubbed;
    if (this.engine.heardToken !== this.loadedToken) return this.lastPosition;
    // Kept for the gapless transition above: what is shown may be all that reads the position.
    this.lastPosition = this.engine.position;
    return this.engine.displayPosition(now);
  }

  /**
   * Plays the track with `id` from `startSeconds` (by default its in marker) to its out marker.
   * Call from a user gesture the first time.
   */
  async playTrack(id: string, startSeconds?: number): Promise<void> {
    // An entry of the last visit: the click that plays it can unlock it.
    const locked = this.state.tracks.find((track) => track.id === id)?.status === 'locked';
    if (locked && !this.library.file(id)) await this.library.unlock();
    const file = this.library.file(id);
    if (!file) return;
    // Choosing a track explicitly switches back from live input.
    if (this.live.active) this.live.stop();
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
      this.loadedIdValue = id;
      this.loadedToken = token;
      this.dispatch({ type: 'player/current', id });
      const fingerprint = this.currentTrack?.fingerprint;
      if (fingerprint) this.analyse(fingerprint, file, true);
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

  async play(): Promise<void> {
    if (this.state.playing || this.live.active) return;
    const current = this.state.currentId;
    if (current !== null && current === this.loadedIdValue) {
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
    if (this.loadedIdValue === null || this.live.active) return;
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

  async next(): Promise<void> {
    if (this.live.active) return;
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
    if (this.live.active) return;
    const id = previousTrack(this.state.tracks, this.state.currentId, this.played, this.order);
    const start = startOf(this.currentTrack);
    if (this.position - start > 3 || !id) await this.seek(start);
    else await this.playTrack(id);
  }

  /** Stops playing the loaded track and empties the engine (a newer load or seek is dropped). */
  async unload(): Promise<void> {
    this.pause();
    this.endScrub();
    this.request++;
    this.busy = false;
    this.loadedIdValue = null;
    this.plan = null;
    await this.engine.unload();
  }

  /**
   * The sound stopped without being asked to (NF-09): the music pauses, and the error says why.
   * Play starts it again.
   */
  troubled(message: string): void {
    if (this.state.playing) this.pause();
    this.trouble = message;
    this.dispatch({ type: 'player/error', message });
  }

  /** Stops following the stream and the state. */
  dispose(): void {
    clearInterval(this.endCheck);
    this.endScrub();
    for (const stop of this.stops) stop();
  }

  private get state(): AppState {
    return this.store.state;
  }

  private get currentTrack(): Track | null {
    const { tracks, currentId } = this.state;
    return tracks.find((track) => track.id === currentId) ?? null;
  }

  private dispatch(action: AppAction): void {
    this.store.dispatch(action);
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
    if (this.loadedIdValue !== null) wanted.set(this.loadedToken, this.loadedIdValue);
    const next = this.plan?.next;
    if (next) wanted.set(next.token, next.id);
    for (const [token, id] of wanted) {
      const track = this.state.tracks.find((entry) => entry.id === id) ?? null;
      const analysis = this.analysis.get(track?.fingerprint ?? null);
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
    if (this.loadedIdValue !== null && !this.live.active) {
      files.push({ token: this.loadedToken, id: this.loadedIdValue });
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
    const nextId = id !== null && this.library.file(id) ? id : null;
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
    const file = next ? this.library.file(next.id) : undefined;
    return next && file ? { file, token: next.token, start: next.start, end: next.end } : null;
  }

  /**
   * The playing track's out marker moved: the stream stops at the new one. If it has already
   * taken the audio beyond, it starts again at the current position.
   */
  private updateEnd(): void {
    if (this.loadedIdValue === null || this.live.active || this.busy) return;
    const token = this.loadedToken;
    const track = this.state.tracks.find((entry) => entry.id === this.loadedIdValue);
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
    if (this.loadedIdValue === null || this.live.active || this.busy) return;
    const heard = this.loadedToken;
    if (!this.updatePlan(heard, this.loadedIdValue)) return;
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
    if (this.loadedIdValue === null || this.live.active || this.busy) return;
    const token = this.engine.heardToken;
    if (token === this.loadedToken) return;
    const id = this.tokenTracks.get(token);
    if (!id || !this.library.file(id)) return;
    this.endScrub();
    this.loadedIdValue = id;
    this.loadedToken = token;
    this.dispatch({ type: 'player/current', id });
    this.notePlayed(id);
    const fingerprint = this.currentTrack?.fingerprint;
    const file = this.library.file(id);
    if (fingerprint && file) this.analyse(fingerprint, file, true);
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

  /** After a load or seek: the queue may have changed meanwhile. */
  private settle(request: number): void {
    if (request !== this.request) return;
    this.busy = false;
    this.planNext();
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
    const id = this.loadedIdValue;
    const file = id !== null ? this.library.file(id) : undefined;
    if (id === null || !file || this.live.active) return;
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

  /**
   * When the stream has played to its end: the queue is over, or the next track could not
   * follow without a gap (then it starts now).
   */
  private advanceAtEnd(): void {
    if (!this.state.playing || this.busy || this.loadedIdValue === null || !this.engine.ended)
      return;
    const plan = this.plan?.after === this.loadedToken ? this.plan : null;
    const next = plan
      ? (plan.next?.id ?? null)
      : nextTrack(this.state.tracks, this.loadedIdValue, this.played, this.order, true);
    if (next) void this.playTrack(next);
    else this.pause();
  }
}
