import type { AppState } from './app-state';

/**
 * Parts of the state that tell their subscribers only when they change (#52). Every action makes
 * a new state, also each step of a slider: what reads the whole state works again at each one,
 * what reads a part only when that part changed. A part is picked from the state and compared
 * with the last one, by `Object.is` unless told otherwise. The subscribe contract is Svelte's, so
 * that components read a part as `$part`; the core stays without Svelte.
 */

/** What can be subscribed to: a store, or a part of one. */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

/** The part `pick` takes from what `source` holds, told to its subscribers when it changes. */
export function select<S, T>(
  source: Readable<S>,
  pick: (state: S) => T,
  equals: (a: T, b: T) => boolean = Object.is,
): Readable<T> {
  return {
    subscribe(run) {
      let seen = false;
      let last: T;
      return source.subscribe((state) => {
        const value = pick(state);
        if (seen && equals(last, value)) return;
        seen = true;
        last = value;
        run(value);
      });
    },
  };
}

/**
 * Calls `run` with each new value of `readable` and the one before it, from now on (not with the
 * value it has now): for the code outside the components that follows a part of the state.
 */
export function watch<T>(readable: Readable<T>, run: (value: T, previous: T) => void): () => void {
  let seen = false;
  let previous: T;
  return readable.subscribe((value) => {
    const before = previous;
    previous = value;
    if (seen) run(value, before);
    seen = true;
  });
}

/** The parts of the app's state that the UI and the player follow. */
export function appParts(store: Readable<AppState>) {
  return {
    tracks: select(store, (state) => state.tracks),
    currentId: select(store, (state) => state.currentId),
    /** The track playing or paused, or null. */
    currentTrack: select(
      store,
      (state) => state.tracks.find((track) => track.id === state.currentId) ?? null,
    ),
    playing: select(store, (state) => state.playing),
    settings: select(store, (state) => state.settings),
    visuals: select(store, (state) => state.visuals),
    kaleido: select(store, (state) => state.kaleido),
    sound: select(store, (state) => state.sound),
    live: select(store, (state) => state.live),
    error: select(store, (state) => state.error),
    undo: select(store, (state) => state.undo),
  };
}

export type AppParts = ReturnType<typeof appParts>;
