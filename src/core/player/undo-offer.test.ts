import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, reducer, type AppAction, type AppState } from '../state/app-state';
import { createStore } from '../state/store';
import { UNDO_SECONDS, UndoOffer } from './undo-offer';

function setup() {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  return { store, offer: new UndoOffer(store) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the undo of a removal', () => {
  it('is offered for a few seconds; then what it needed is let go', () => {
    const { store, offer } = setup();
    const restore = vi.fn();
    const release = vi.fn();
    offer.offer('Removed “One”', restore, release);
    expect(store.state.undo).toBe('Removed “One”');
    vi.advanceTimersByTime(UNDO_SECONDS * 1000 - 1);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.state.undo).toBeNull();
    // Too late: nothing comes back.
    offer.undo();
    expect(restore).not.toHaveBeenCalled();
  });

  it('undoes the last one once, and a new one lets the one before go', () => {
    const { store, offer } = setup();
    const first = { restore: vi.fn(), release: vi.fn() };
    const second = { restore: vi.fn(), release: vi.fn() };
    offer.offer('Cleared the markers', first.restore, first.release);
    offer.offer('Cleared the queue (2 tracks)', second.restore, second.release);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(store.state.undo).toBe('Cleared the queue (2 tracks)');
    offer.undo();
    offer.undo();
    expect(second.restore).toHaveBeenCalledTimes(1);
    expect(second.release).not.toHaveBeenCalled();
    expect(first.restore).not.toHaveBeenCalled();
    expect(store.state.undo).toBeNull();
    // Its time running out later changes nothing.
    vi.advanceTimersByTime(UNDO_SECONDS * 1000);
    expect(second.release).not.toHaveBeenCalled();
  });

  it('can be dropped, as when the app ends', () => {
    const { store, offer } = setup();
    const release = vi.fn();
    offer.offer('Deleted cue 1', vi.fn(), release);
    offer.drop();
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.state.undo).toBeNull();
  });
});
