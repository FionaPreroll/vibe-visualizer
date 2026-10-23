import { describe, expect, it, vi } from 'vitest';
import { initialState, reducer, type AppAction, type AppState } from './app-state';
import { appParts, select, watch } from './select';
import { createStore } from './store';

const store = () => createStore<AppState, AppAction>(initialState(), reducer);

describe('the parts of the state', () => {
  it('tell their subscribers at first, and then only when they change', () => {
    const app = store();
    const volume = select(app, (state) => state.settings.volume);
    const seen = vi.fn();
    const stop = volume.subscribe(seen);
    expect(seen).toHaveBeenLastCalledWith(0.8);
    app.dispatch({ type: 'settings/changed', changes: { shuffle: true } });
    expect(seen).toHaveBeenCalledTimes(1);
    app.dispatch({ type: 'settings/changed', changes: { volume: 0.5 } });
    expect(seen).toHaveBeenLastCalledWith(0.5);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    app.dispatch({ type: 'settings/changed', changes: { volume: 0.4 } });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('can be compared as told, and each subscriber has its own last value', () => {
    const app = store();
    const flags = select(
      app,
      (state) => [state.settings.shuffle, state.settings.quantize],
      (a, b) => a.every((value, index) => value === b[index]),
    );
    const first = vi.fn();
    const second = vi.fn();
    flags.subscribe(first);
    app.dispatch({ type: 'settings/changed', changes: { volume: 0.1 } });
    flags.subscribe(second);
    app.dispatch({ type: 'settings/changed', changes: { shuffle: true } });
    expect(first.mock.calls).toEqual([[[false, true]], [[true, true]]]);
    expect(second.mock.calls).toEqual([[[false, true]], [[true, true]]]);
  });

  it('are watched from now on, with the value before', () => {
    const app = store();
    const changes = vi.fn();
    watch(appParts(app).settings, (settings, before) => changes(settings.volume, before.volume));
    expect(changes).not.toHaveBeenCalled();
    app.dispatch({ type: 'settings/changed', changes: { volume: 0.5 } });
    app.dispatch({ type: 'settings/changed', changes: { volume: 0.3 } });
    expect(changes.mock.calls).toEqual([
      [0.5, 0.8],
      [0.3, 0.5],
    ]);
  });
});
