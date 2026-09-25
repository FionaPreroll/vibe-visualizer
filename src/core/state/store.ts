/**
 * Minimal framework-free store. Every change is a typed action with a timestamp (NF-08); the
 * action log is the basis for recording and replaying sessions later. The subscribe contract
 * matches Svelte stores, so components can use `$store`.
 */

export type Timed<A> = A & { at: number };

export interface Store<S, A> {
  readonly state: S;
  readonly log: readonly Timed<A>[];
  dispatch(action: A): void;
  subscribe(listener: (state: S) => void): () => void;
}

export function createStore<S, A extends { type: string }>(
  initial: S,
  reducer: (state: S, action: A) => S,
  options: { logLimit?: number; now?: () => number } = {},
): Store<S, A> {
  const logLimit = options.logLimit ?? 10_000;
  const now = options.now ?? (() => performance.now());
  let state = initial;
  const log: Timed<A>[] = [];
  const listeners = new Set<(state: S) => void>();

  return {
    get state() {
      return state;
    },
    get log() {
      return log;
    },
    dispatch(action) {
      const timed = { ...action, at: now() };
      log.push(timed);
      if (log.length > logLimit) log.splice(0, log.length - logLimit);
      const next = reducer(state, timed);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}
