import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_GRID_EDIT } from '../analysis/grid-edit';
import type { QueueEntry } from '../library/folder-reader';
import type { ProbeResult } from '../library/probe.worker';
import type { Access, StoredEntry, StoredQueue } from '../library/queue-store';
import {
  CUE_COUNT,
  initialState,
  reducer,
  type AppAction,
  type AppState,
  type TrackData,
} from '../state/app-state';
import { createStore } from '../state/store';
import { Library, type LibraryServices } from './library';

/** What the probe finds in a file: by default a ready one, the fingerprint from its name. */
function ready(
  file: File,
  tags: { title?: string; trackNumber?: number; fingerprint?: string } = {},
): ProbeResult {
  return {
    status: 'ready',
    fingerprint: tags.fingerprint ?? `fp-${file.name}`,
    title: tags.title ?? null,
    artist: null,
    album: null,
    trackNumber: tags.trackNumber ?? null,
    discNumber: null,
    duration: 60,
    sampleRate: 44100,
    channels: 2,
    codec: 'pcm',
    format: 'WAV',
    cover: null,
  };
}

function entry(name: string, folder: string | null = null, size = 1000): QueueEntry {
  return { file: new File([new Uint8Array(size)], name), handle: null, folder };
}

/** A handle to `file` (null: its file is gone), with the access the browser gives. */
function handle(file: File | null, access: Access) {
  return {
    access,
    getFile: vi.fn(async () => {
      if (!file) throw new DOMException('gone', 'NotFoundError');
      return file;
    }),
  } as unknown as FileSystemFileHandle & { access: Access };
}

function stored(id: string, name: string, fileHandle: FileSystemFileHandle | null): StoredEntry {
  return {
    id,
    info: {
      fileName: name,
      size: 1000,
      title: name.replace('.wav', ''),
      artist: null,
      album: null,
      duration: 60,
      sampleRate: 44100,
      codec: 'pcm',
      format: 'WAV',
      fingerprint: `fp-${name}`,
    },
    handle: fileHandle,
  };
}

const MARKED: TrackData = {
  cues: Array<number | null>(CUE_COUNT).fill(null),
  marks: { in: 2, out: null },
  tempo: null,
  fixedTempo: false,
  gridEdit: NO_GRID_EDIT,
  edit: null,
  colors: null,
  look: null,
};

/** The queue's files, with fake services; `probe` answers as `answer` says, at once. */
function setup(
  options: {
    lastVisit?: StoredQueue | null;
    answer?: (file: File) => Promise<ProbeResult> | ProbeResult;
  } = {},
) {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  const answer = options.answer ?? ((file: File) => ready(file));
  const services = {
    probe: vi.fn(async (file: File) => answer(file)),
    loadQueue: vi.fn(async () => options.lastVisit ?? null),
    accessOf: vi.fn(async (fileHandle: FileSystemFileHandle) => {
      return (fileHandle as FileSystemFileHandle & { access: Access }).access;
    }),
    requestAccess: vi.fn(async () => true),
    loadTrackData: vi.fn((fingerprint: string): TrackData | null =>
      fingerprint === 'fp-marked.wav' ? MARKED : null,
    ),
    readCover: vi.fn(async (): Promise<Blob | null> => null),
    writeCover: vi.fn(async () => {}),
    keepStorage: vi.fn(async () => true),
  } satisfies LibraryServices;
  const analyse = vi.fn<(fingerprint: string, file: File, first: boolean) => void>();
  const forgetAnalysis = vi.fn<(fingerprint: string) => void>();
  const library = new Library(store, services, analyse, forgetAnalysis);
  const tracks = () => store.state.tracks;
  const settled = () =>
    vi.waitFor(() => expect(tracks().map((track) => track.status)).not.toContain('probing'));
  return { store, services, analyse, forgetAnalysis, library, tracks, settled };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the files behind the queue', () => {
  it('are probed one after the other, with what is kept for each file, and then analysed', async () => {
    let release = () => {};
    const first = new Promise<void>((resolve) => (release = resolve));
    const { library, services, analyse, tracks, settled } = setup({
      answer: async (file) => {
        if (file.name === 'one.wav') await first;
        return ready(file, { title: file.name.toUpperCase() });
      },
    });
    library.add([entry('one.wav'), entry('marked.wav')]);
    expect(tracks().map((track) => [track.title, track.status])).toEqual([
      ['one', 'probing'],
      ['marked', 'probing'],
    ]);
    await vi.waitFor(() => expect(services.probe).toHaveBeenCalledTimes(1));
    release();
    await settled();
    expect(services.probe).toHaveBeenCalledTimes(2);
    expect(tracks().map((track) => [track.title, track.status, track.fingerprint])).toEqual([
      ['ONE.WAV', 'ready', 'fp-one.wav'],
      ['MARKED.WAV', 'ready', 'fp-marked.wav'],
    ]);
    expect(tracks()[1]!.marks).toEqual({ in: 2, out: null });
    expect(analyse.mock.calls.map(([fingerprint, , first]) => [fingerprint, first])).toEqual([
      ['fp-one.wav', false],
      ['fp-marked.wav', false],
    ]);
  });

  it('say which file cannot be played, and why', async () => {
    const { library, tracks, settled } = setup({
      answer: (file) =>
        file.name === 'notes.wav'
          ? { status: 'unsupported', reason: 'unknown file format' }
          : Promise.reject(new Error('cannot be read')),
    });
    library.add([entry('notes.wav'), entry('broken.wav')]);
    await settled();
    expect(tracks().map((track) => [track.status, track.reason])).toEqual([
      ['unsupported', 'unknown file format'],
      ['unsupported', 'cannot be read'],
    ]);
  });

  it('of a folder are sorted by their track numbers, unless moved meanwhile', async () => {
    const numbers: Record<string, number> = { 'a.wav': 3, 'b.wav': 1, 'c.wav': 2 };
    const { library, store, tracks, settled } = setup({
      answer: (file) => ready(file, { trackNumber: numbers[file.name]! }),
    });
    library.add([entry('a.wav', 'Album'), entry('b.wav', 'Album'), entry('c.wav', 'Album')]);
    await settled();
    await vi.waitFor(() =>
      expect(tracks().map((track) => track.fileName)).toEqual(['b.wav', 'c.wav', 'a.wav']),
    );

    // Moved by the user before the probes are done: the user's order stays.
    Object.assign(numbers, { 'f.wav': 3, 'g.wav': 1, 'h.wav': 2 });
    library.add([entry('f.wav', 'Other'), entry('g.wav', 'Other'), entry('h.wav', 'Other')]);
    store.dispatch({ type: 'tracks/moved', from: 5, to: 3 });
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      tracks()
        .map((track) => track.fileName)
        .slice(3),
    ).toEqual(['h.wav', 'f.wav', 'g.wav']);
  });

  it('come back from the last visit as the browser gives them, and are unlocked on request', async () => {
    const one = new File([new Uint8Array(1000)], 'one.wav');
    const two = new File([new Uint8Array(1000)], 'marked.wav');
    const { library, services, tracks, store } = setup({
      lastVisit: {
        entries: [
          stored('e1', 'one.wav', handle(one, 'granted')),
          stored('e2', 'marked.wav', handle(two, 'prompt')),
          stored('e3', 'three.wav', null),
          stored('e4', 'four.wav', handle(null, 'granted')),
        ],
        currentId: 'e2',
      },
    });
    await library.restored;
    await vi.waitFor(() => expect(tracks()[0]!.status).toBe('ready'));
    expect(tracks().map((track) => [track.id, track.title, track.status])).toEqual([
      ['e1', 'one', 'ready'],
      ['e2', 'marked', 'locked'],
      ['e3', 'three', 'missing'],
      ['e4', 'four', 'missing'],
    ]);
    expect(store.state.currentId).toBe('e2');
    // What is kept for a file comes with it, also before it is unlocked.
    expect(tracks()[1]!.marks).toEqual({ in: 2, out: null });
    expect(library.file('e2')).toBeUndefined();

    // A declined request leaves it locked.
    services.requestAccess.mockResolvedValueOnce(false);
    await library.unlock();
    expect(tracks()[1]!.status).toBe('locked');
    await library.unlock();
    await vi.waitFor(() => expect(tracks()[1]!.status).toBe('ready'));
    expect(library.file('e2')).toBe(two);

    // A file of the last visit added again brings its entry back.
    const again = entry('three.wav');
    library.add([again]);
    await vi.waitFor(() => expect(tracks()[2]!.status).toBe('ready'));
    expect(tracks()).toHaveLength(4);
    expect(library.file('e3')).toBe(again.file);

    expect(library.storedQueue()).toEqual({
      entries: [
        expect.objectContaining({ id: 'e1', handle: expect.anything() }),
        expect.objectContaining({ id: 'e2', handle: expect.anything() }),
        expect.objectContaining({ id: 'e3', handle: null }),
        expect.objectContaining({ id: 'e4', handle: null }),
      ],
      currentId: 'e2',
    });
  });

  it('are taken out and put back on undo, probed again if they were not yet', async () => {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const { library, services, analyse, store, tracks } = setup({
      answer: async (file) => {
        await waiting;
        return ready(file);
      },
    });
    library.add([entry('one.wav')]);
    const [track] = tracks();
    await vi.waitFor(() => expect(services.probe).toHaveBeenCalledTimes(1));
    const taken = library.take([track!]);
    store.dispatch({ type: 'tracks/removed', id: track!.id });
    release();
    // The probe of the file taken out is dropped.
    await services.probe.mock.results[0]!.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tracks()).toEqual([]);
    expect(analyse).not.toHaveBeenCalled();
    taken.putBack(0, track!.id);
    expect(store.state.currentId).toBe(track!.id);
    await vi.waitFor(() => expect(tracks()[0]!.status).toBe('ready'));
    expect(services.probe).toHaveBeenCalledTimes(2);
  });

  it('keep the user’s cover for every entry of a file, and let it go with the last one', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { library, services, forgetAnalysis, store, tracks, settled } = setup({
      answer: (file) => ready(file, { fingerprint: 'same' }),
    });
    library.add([entry('one.wav'), entry('copy.wav')]);
    await settled();
    const [one, copy] = tracks();
    await library.setOwnCover(one!.id, new Blob(['png'], { type: 'image/png' }));
    const url = tracks()[0]!.ownCoverUrl;
    expect(url).toMatch(/^blob:/);
    expect(tracks()[1]!.ownCoverUrl).toBe(url);
    expect(services.writeCover).toHaveBeenCalledWith('same', expect.any(Blob));
    expect(services.keepStorage).toHaveBeenCalled();

    // One entry goes: the other still needs the analysis and the cover.
    const takenOne = library.take([one!]);
    store.dispatch({ type: 'tracks/removed', id: one!.id });
    takenOne.forget();
    expect(forgetAnalysis).not.toHaveBeenCalled();
    const takenCopy = library.take([copy!]);
    store.dispatch({ type: 'tracks/removed', id: copy!.id });
    takenCopy.forget();
    expect(forgetAnalysis).toHaveBeenCalledWith('same');
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith(url));
  });
});
