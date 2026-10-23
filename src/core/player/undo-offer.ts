import type { AppAction, AppState } from '../state/app-state';
import type { Store } from '../state/store';

/** How long a removal or deletion can be undone (seconds). */
export const UNDO_SECONDS = 8;

/**
 * The last removal or deletion, while it can be undone (Ctrl+Z): for {@link UNDO_SECONDS}, or
 * until the next one. What it is shows in the state (`undo`).
 */
export class UndoOffer {
  private entry: {
    restore: () => void;
    release: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly store: Store<AppState, AppAction>) {}

  /**
   * Offers to undo what was just done: `restore` undoes it; `release` lets go for good what
   * `restore` would have needed, once the offer is gone.
   */
  offer(label: string, restore: () => void, release: () => void = () => {}): void {
    this.drop();
    const timer = setTimeout(() => this.drop(), UNDO_SECONDS * 1000);
    this.entry = { restore, release, timer };
    this.store.dispatch({ type: 'undo/offered', label });
  }

  /** Undoes the last removal or deletion, while that is offered. */
  undo(): void {
    const entry = this.entry;
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entry = null;
    entry.restore();
    this.store.dispatch({ type: 'undo/offered', label: null });
  }

  /** The offer goes: what was removed is gone for good. */
  drop(): void {
    const entry = this.entry;
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entry = null;
    entry.release();
    this.store.dispatch({ type: 'undo/offered', label: null });
  }
}
