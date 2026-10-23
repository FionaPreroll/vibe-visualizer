import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredQueue } from '../library/queue-store';
import { initialState, newTrack, reducer, type AppAction, type AppState } from '../state/app-state';
import { appParts } from '../state/select';
import { createStore } from '../state/store';
import { QUEUE_SAVE_DELAY, StateSync, type StateStorage } from './state-sync';

function setup(restored: Promise<void> = Promise.resolve()) {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  const storage = {
    saveSettings: vi.fn(),
    saveSound: vi.fn(),
    saveVisuals: vi.fn(),
    saveKaleido: vi.fn(),
    saveTrackData: vi.fn(),
    saveQueue: vi.fn(async (_queue: StoredQueue) => {}),
    flushWrites: vi.fn(),
  } satisfies StateStorage;
  // The queue as the player stores it, here only the ids.
  const queue = (): StoredQueue => ({
    entries: store.state.tracks.map((track) => ({ id: track.id, info: {} as never, handle: null })),
    currentId: store.state.currentId,
  });
  const sync = new StateSync(appParts(store), storage, queue, restored);
  return { store, storage, sync };
}

/** A track whose file is known, as after probing. */
function track(id: string, fingerprint = `file-${id}`) {
  return { ...newTrack(id, { name: `${id}.wav`, size: 1 }), fingerprint };
}

const savedIds = (storage: ReturnType<typeof setup>['storage']) =>
  storage.saveQueue.mock.calls.map(([queue]) => queue.entries.map((entry) => entry.id));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the stored state', () => {
  it('keeps each kind of setting when it changes, and only then', () => {
    const { store, storage } = setup();
    expect(storage.saveSettings).not.toHaveBeenCalled();
    store.dispatch({ type: 'settings/changed', changes: { volume: 0.5 } });
    expect(storage.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.5 }));
    store.dispatch({ type: 'sound/changed', changes: { rate: 1.04 } });
    store.dispatch({ type: 'visuals/changed', changes: { sensitivity: 1.5 } });
    store.dispatch({ type: 'kaleido/scene', scene: 'crystal' });
    expect(storage.saveSound).toHaveBeenCalledTimes(1);
    expect(storage.saveVisuals).toHaveBeenCalledTimes(1);
    expect(storage.saveKaleido).toHaveBeenCalledTimes(1);
    expect(storage.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps the details of the files that changed', () => {
    const { store, storage } = setup();
    const unprobed = newTrack('c', { name: 'c.wav', size: 1 });
    store.dispatch({ type: 'tracks/added', tracks: [track('a'), track('b'), unprobed] });
    // New files are kept as they are; one not probed yet has nothing to keep.
    expect(storage.saveTrackData.mock.calls.map(([fingerprint]) => fingerprint)).toEqual([
      'file-a',
      'file-b',
    ]);
    storage.saveTrackData.mockClear();
    store.dispatch({ type: 'tracks/marked', id: 'b', mark: 'in', seconds: 2 });
    expect(storage.saveTrackData).toHaveBeenCalledTimes(1);
    expect(storage.saveTrackData).toHaveBeenCalledWith(
      'file-b',
      expect.objectContaining({ marks: { in: 2, out: null } }),
    );
    // Playing changes no file's details.
    store.dispatch({ type: 'player/current', id: 'a' });
    expect(storage.saveTrackData).toHaveBeenCalledTimes(1);
  });

  it('saves the queue once after a burst of changes', async () => {
    const { store, storage } = setup();
    store.dispatch({ type: 'tracks/added', tracks: [track('a')] });
    await vi.advanceTimersByTimeAsync(QUEUE_SAVE_DELAY - 100);
    store.dispatch({ type: 'tracks/added', tracks: [track('b')] });
    store.dispatch({ type: 'player/current', id: 'b' });
    await vi.advanceTimersByTimeAsync(QUEUE_SAVE_DELAY - 1);
    expect(storage.saveQueue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(savedIds(storage)).toEqual([['a', 'b']]);
    expect(storage.saveQueue.mock.lastCall?.[0].currentId).toBe('b');
  });

  it('does not save the queue before the one of the last visit is back', async () => {
    let restore = () => {};
    const { store, storage } = setup(new Promise((resolve) => (restore = resolve)));
    store.dispatch({ type: 'tracks/added', tracks: [track('new')] });
    await vi.advanceTimersByTimeAsync(QUEUE_SAVE_DELAY * 3);
    expect(storage.saveQueue).not.toHaveBeenCalled();
    store.dispatch({
      type: 'tracks/restored',
      tracks: [track('old')],
      currentId: null,
    });
    restore();
    await vi.advanceTimersByTimeAsync(0);
    // Saved as it is then: the queue of the last visit, and what was added meanwhile.
    expect(savedIds(storage)).toEqual([['old', 'new']]);
  });

  it('saves at once when the page is hidden, and when it ends', async () => {
    const { store, storage, sync } = setup();
    sync.flush();
    expect(storage.flushWrites).toHaveBeenCalledTimes(1);
    // Nothing waits: the queue is not saved again.
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.saveQueue).not.toHaveBeenCalled();

    store.dispatch({ type: 'tracks/added', tracks: [track('a')] });
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(savedIds(storage)).toEqual([['a']]);
    // The save that waited is done: it does not come again.
    await vi.advanceTimersByTimeAsync(QUEUE_SAVE_DELAY);
    expect(storage.saveQueue).toHaveBeenCalledTimes(1);

    store.dispatch({ type: 'player/current', id: 'a' });
    sync.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.saveQueue).toHaveBeenCalledTimes(2);
    // Then it follows the state no more.
    store.dispatch({ type: 'settings/changed', changes: { volume: 0.2 } });
    store.dispatch({ type: 'tracks/added', tracks: [track('b')] });
    await vi.advanceTimersByTimeAsync(QUEUE_SAVE_DELAY);
    expect(storage.saveSettings).not.toHaveBeenCalled();
    expect(storage.saveQueue).toHaveBeenCalledTimes(2);
  });
});
