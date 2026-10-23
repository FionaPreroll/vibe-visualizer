import { describe, expect, it } from 'vitest';
import {
  initialState,
  newTrack,
  reducer,
  type AppAction,
  type AppState,
} from '../core/state/app-state';
import { createStore } from '../core/state/store';
import { AppStateView } from './app-state.svelte';

function setup() {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  return { store, view: new AppStateView(store) };
}

describe('the app state of the components', () => {
  it('follows the store, part by part, until it is disposed', () => {
    const { store, view } = setup();
    const tracks = view.tracks;
    expect(view.settings).toBe(store.state.settings);
    store.dispatch({ type: 'settings/changed', changes: { volume: 0.5 } });
    expect(view.settings.volume).toBe(0.5);
    // A part the action left as it was is the same: nothing that reads it runs again.
    expect(view.tracks).toBe(tracks);
    store.dispatch({ type: 'player/error', message: 'Oops' });
    expect(view.error).toBe('Oops');
    view.dispose();
    store.dispatch({ type: 'player/error', message: null });
    expect(view.error).toBe('Oops');
  });

  it('gives the current track', () => {
    const { store, view } = setup();
    expect(view.currentTrack).toBeNull();
    store.dispatch({
      type: 'tracks/added',
      tracks: [
        newTrack('a', { name: 'a.wav', size: 1 }),
        newTrack('b', { name: 'b.wav', size: 1 }),
      ],
    });
    store.dispatch({ type: 'player/current', id: 'b' });
    expect(view.currentTrack?.id).toBe('b');
    store.dispatch({ type: 'tracks/removed', id: 'b' });
    expect(view.currentTrack).toBeNull();
  });
});
