import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadResult, NextFile } from '../audio/engine/audio-engine';
import type { TrackAnalyzer } from '../library/track-analyzer';
import {
  initialState,
  newTrack,
  reducer,
  type AppAction,
  type AppState,
  type Marks,
  type Settings,
} from '../state/app-state';
import { createStore } from '../state/store';
import { SCRUB_SEEK_MS, Transport, type TransportEngine } from './transport';

/** The engine as the transport knows it: it opens what it is told; the test plays it on. */
class FakeEngine implements TransportEngine {
  paused = true;
  position = 0;
  heardToken = 0;
  ended = false;
  /** False: the stream already took what was planned before, or passed the old end. */
  takes = true;
  /** What follows the heard file, as last given. */
  private next: NextFile | null = null;
  readonly loads: { file: string; start: number; end: number | null; next: string | null }[] = [];
  readonly seeks: { seconds: number; end: number | null; next: string | null }[] = [];
  readonly queued: { after: number; next: string | null }[] = [];
  readonly ends: { token: number; end: number | null }[] = [];
  start = vi.fn(async () => {});
  setFileAnalysis = vi.fn();

  async load(
    file: File,
    start: number,
    token: number,
    end: number | null = null,
    next: NextFile | null = null,
  ): Promise<LoadResult> {
    this.loads.push({ file: file.name, start, end, next: next?.file.name ?? null });
    this.heardToken = token;
    this.position = start;
    this.ended = false;
    this.next = next;
    return {
      generation: this.loads.length,
      duration: 60,
      sampleRate: 48000,
      channels: 2,
      codec: 'pcm',
    };
  }

  async seek(
    seconds: number,
    token: number,
    _file: File,
    end: number | null = null,
    next: NextFile | null = null,
  ): Promise<void> {
    this.seeks.push({ seconds, end, next: next?.file.name ?? null });
    this.heardToken = token;
    this.position = seconds;
    this.ended = false;
    this.next = next;
  }

  async queueNext(after: number, next: NextFile | null): Promise<boolean> {
    this.queued.push({ after, next: next?.file.name ?? null });
    if (this.takes) this.next = next;
    return this.takes;
  }

  async setEnd(token: number, end: number | null): Promise<boolean> {
    this.ends.push({ token, end });
    return this.takes;
  }

  async unload(): Promise<void> {
    this.heardToken = 0;
    this.next = null;
  }

  displayPosition(): number {
    return this.position;
  }

  /** The heard file plays to its end: what follows is heard without a gap, or the stream ends. */
  playOn(): void {
    if (!this.next) {
      this.ended = true;
      return;
    }
    this.heardToken = this.next.token;
    this.position = this.next.start;
    this.next = null;
  }
}

/** A track whose file is there, 60 s long. */
function track(id: string, marks: Marks = { in: null, out: null }) {
  return {
    ...newTrack(id, { name: `${id}.wav`, size: 1 }),
    status: 'ready' as const,
    duration: 60,
    fingerprint: `fp-${id}`,
    marks,
  };
}

function setup(tracks: ReturnType<typeof track>[], settings: Partial<Settings> = {}) {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  store.dispatch({ type: 'tracks/added', tracks });
  store.dispatch({ type: 'settings/changed', changes: settings });
  const engine = new FakeEngine();
  const files = new Map(tracks.map((entry) => [entry.id, new File([], entry.fileName)]));
  const library = { file: (id: string) => files.get(id), unlock: vi.fn(async () => {}) };
  // No track has its analysis yet: the engine gets no grids.
  const analysis: Pick<TrackAnalyzer, 'get' | 'subscribe'> = {
    get: () => undefined,
    subscribe: (listener) => {
      listener(new Map());
      return () => {};
    },
  };
  const analyse = vi.fn<(fingerprint: string, file: File, first: boolean) => void>();
  const live = {
    active: false,
    stop: vi.fn(() => {
      live.active = false;
    }),
  };
  const transport = new Transport(store, engine, library, analysis, analyse, live);
  /** The 50 ms checks of the stream. */
  const tick = () => vi.advanceTimersByTimeAsync(50);
  return { store, engine, transport, analyse, live, tick };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('playing the queue', () => {
  it('plays a track between its markers, with the next one ready to follow', async () => {
    const { store, engine, transport, analyse } = setup([
      track('a', { in: 2, out: 10 }),
      track('b'),
    ]);
    await transport.playTrack('a');
    expect(engine.loads).toEqual([{ file: 'a.wav', start: 2, end: 10, next: 'b.wav' }]);
    expect(store.state).toMatchObject({ currentId: 'a', playing: true, error: null });
    expect(engine.paused).toBe(false);
    expect(transport.position).toBe(2);
    expect(analyse).toHaveBeenCalledWith('fp-a', expect.any(File), true);
    transport.dispose();
  });

  it('follows the stream into the next track without a gap, and stops after the last one', async () => {
    const { store, engine, transport, tick } = setup([track('a'), track('b'), track('c')]);
    const heard: string[][] = [];
    transport.stream.subscribe((files) => heard.push(files.map((file) => file.id)));
    await transport.playTrack('a');
    await tick();
    expect(heard.at(-1)).toEqual(['a', 'b']);

    engine.playOn();
    await tick();
    expect(store.state.currentId).toBe('b');
    expect(engine.queued.at(-1)?.next).toBe('c.wav');
    expect(heard.at(-1)).toEqual(['b', 'c']);

    engine.playOn();
    await tick();
    expect(store.state.currentId).toBe('c');
    // Nothing follows the last track with repeat off: at its end, the music stops.
    expect(engine.queued.at(-1)?.next).toBeNull();
    engine.playOn();
    await tick();
    expect(store.state.playing).toBe(false);
    expect(engine.paused).toBe(true);
    transport.dispose();
  });

  it('plans again when the order changes: the queue starts over, or the track repeats', async () => {
    const { store, engine, transport } = setup([track('a'), track('b')], { repeat: 'all' });
    await transport.playTrack('b');
    expect(engine.loads.at(-1)?.next).toBe('a.wav');
    store.dispatch({ type: 'settings/changed', changes: { repeat: 'one' } });
    await vi.waitFor(() => expect(engine.queued.at(-1)?.next).toBe('b.wav'));
    store.dispatch({ type: 'settings/changed', changes: { repeat: 'off' } });
    await vi.waitFor(() => expect(engine.queued.at(-1)?.next).toBeNull());
    transport.dispose();
  });

  it('plans again when the queue changes; if the stream took the old plan, it starts anew', async () => {
    const { store, engine, transport } = setup([track('a'), track('b'), track('c')]);
    await transport.playTrack('a');
    engine.position = 12;
    store.dispatch({ type: 'tracks/moved', from: 2, to: 1 });
    await vi.waitFor(() => expect(engine.queued.at(-1)?.next).toBe('c.wav'));
    expect(engine.seeks).toEqual([]);

    // Too late for the stream: it starts again where the music is, with the new plan.
    engine.takes = false;
    store.dispatch({ type: 'tracks/moved', from: 2, to: 1 });
    await vi.waitFor(() =>
      expect(engine.seeks).toEqual([{ seconds: 12, end: null, next: 'b.wav' }]),
    );
    transport.dispose();
  });

  it('moves where the stream stops with the out marker of the track playing', async () => {
    const { store, engine, transport } = setup([track('a'), track('b')]);
    await transport.playTrack('a');
    store.dispatch({ type: 'tracks/marked', id: 'a', mark: 'out', seconds: 20 });
    await vi.waitFor(() => expect(engine.ends.at(-1)?.end).toBe(20));
    // The marker of another track changes only what is planned to follow.
    store.dispatch({ type: 'tracks/marked', id: 'b', mark: 'in', seconds: 5 });
    await vi.waitFor(() => expect(engine.queued.length).toBeGreaterThan(0));
    expect(engine.ends).toHaveLength(1);

    // Already past the new end: the stream starts again where the music is.
    engine.takes = false;
    engine.position = 15;
    store.dispatch({ type: 'tracks/marked', id: 'a', mark: 'out', seconds: 14 });
    await vi.waitFor(() => expect(engine.seeks.at(-1)).toMatchObject({ seconds: 15, end: null }));
    transport.dispose();
  });

  it('scrubs at once on screen, and seeks at most every 60 ms; a seek ends it', async () => {
    const { engine, transport } = setup([track('a')]);
    await transport.playTrack('a');
    transport.pause();
    transport.scrub(5);
    transport.scrub(6);
    transport.scrub(7);
    expect(transport.position).toBe(7);
    await vi.waitFor(() => expect(engine.seeks.map((seek) => seek.seconds)).toEqual([5]));
    await vi.advanceTimersByTimeAsync(SCRUB_SEEK_MS);
    expect(engine.seeks.map((seek) => seek.seconds)).toEqual([5, 7]);
    await vi.advanceTimersByTimeAsync(SCRUB_SEEK_MS * 3);
    expect(engine.seeks).toHaveLength(2);

    // Beyond the end it stops just before it.
    transport.scrub(80);
    expect(transport.position).toBeCloseTo(59.95);
    await transport.seek(30);
    expect(transport.position).toBe(30);
    transport.dispose();
  });

  it('goes back to the start of the track, or to the track before near its start', async () => {
    const { store, engine, transport } = setup([track('a'), track('b', { in: 4, out: null })]);
    await transport.playTrack('b');
    engine.position = 20;
    await transport.previous();
    expect(engine.seeks.at(-1)?.seconds).toBe(4);
    engine.position = 5;
    await transport.previous();
    expect(store.state.currentId).toBe('a');
    expect(engine.loads.at(-1)?.file).toBe('a.wav');
    transport.dispose();
  });

  it('pauses on trouble with the sound and says why; playing again clears it', async () => {
    const { store, engine, transport } = setup([track('a')]);
    await transport.playTrack('a');
    transport.troubled('The audio device was lost.');
    expect(store.state).toMatchObject({ playing: false, error: 'The audio device was lost.' });
    expect(engine.paused).toBe(true);
    await transport.play();
    expect(store.state).toMatchObject({ playing: true, error: null });
    transport.dispose();
  });

  it('leaves live input for a track chosen to play, and idles while live input runs', async () => {
    const { engine, transport, live } = setup([track('a'), track('b')]);
    live.active = true;
    await transport.next();
    transport.scrub(3);
    expect(engine.loads).toEqual([]);
    await transport.playTrack('a');
    expect(live.stop).toHaveBeenCalled();
    expect(engine.loads).toHaveLength(1);
    transport.dispose();
  });
});
