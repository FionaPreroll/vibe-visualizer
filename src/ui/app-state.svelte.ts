import { getContext, setContext } from 'svelte';
import type { AppAction, AppState, Track } from '../core/state/app-state';
import type { Store } from '../core/state/store';

/**
 * The app's state as Svelte state, for the components (#57): a signal for each part, which a
 * change of the store sets only where that part changed. So a component depends on the parts
 * it reads, and nothing runs for it when an action leaves them as they were. The store stays
 * the source: the Player, the renderer and the controllers follow it themselves; this follows
 * it once for all components.
 */
export class AppStateView {
  tracks: AppState['tracks'];
  currentId: AppState['currentId'];
  playing: AppState['playing'];
  settings: AppState['settings'];
  visuals: AppState['visuals'];
  kaleido: AppState['kaleido'];
  sound: AppState['sound'];
  live: AppState['live'];
  error: AppState['error'];
  undo: AppState['undo'];
  /** The track playing or paused, or null. */
  readonly currentTrack: Track | null;
  private readonly stop: () => void;

  constructor(store: Store<AppState, AppAction>) {
    const state = store.state;
    this.tracks = $state.raw(state.tracks);
    this.currentId = $state.raw(state.currentId);
    this.playing = $state.raw(state.playing);
    this.settings = $state.raw(state.settings);
    this.visuals = $state.raw(state.visuals);
    this.kaleido = $state.raw(state.kaleido);
    this.sound = $state.raw(state.sound);
    this.live = $state.raw(state.live);
    this.error = $state.raw(state.error);
    this.undo = $state.raw(state.undo);
    this.currentTrack = $derived(this.tracks.find((track) => track.id === this.currentId) ?? null);
    // A part set to what it is already tells nobody.
    this.stop = store.subscribe((next) => {
      this.tracks = next.tracks;
      this.currentId = next.currentId;
      this.playing = next.playing;
      this.settings = next.settings;
      this.visuals = next.visuals;
      this.kaleido = next.kaleido;
      this.sound = next.sound;
      this.live = next.live;
      this.error = next.error;
      this.undo = next.undo;
    });
  }

  /** Stops following the store. */
  dispose(): void {
    this.stop();
  }
}

const KEY = Symbol('app-state');

export function provideAppState(view: AppStateView): void {
  setContext(KEY, view);
}

/** The app's state, for a component of the app. */
export function useAppState(): AppStateView {
  const view = getContext<AppStateView | undefined>(KEY);
  if (!view) throw new Error('No app state in this component tree');
  return view;
}
