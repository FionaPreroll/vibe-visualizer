import type { BeatGrid } from './beat-grid';

/**
 * The user's correction of a file's beat grid (TR-11): the grid moved by `shift` seconds (its
 * phase), and the bars counted in fours from the beat nearest to `downbeat` (seconds, in the grid
 * as the analysis found it; null keeps the bars the analysis found). Kept per file, and applied
 * to every grid of the file, also to one computed anew for a corrected tempo: the downbeat is a
 * time, not a beat number.
 */
export interface GridEdit {
  shift: number;
  downbeat: number | null;
}

export const NO_GRID_EDIT: GridEdit = { shift: 0, downbeat: null };
/** How far the grid can be moved, in seconds (half a beat at 60 BPM). */
export const GRID_SHIFT_LIMIT = 0.5;

const BEATS_PER_BAR = 4;

export function isGridEdited(edit: GridEdit): boolean {
  return edit.shift !== 0 || edit.downbeat !== null;
}

export function sameGridEdit(a: GridEdit, b: GridEdit): boolean {
  return a.shift === b.shift && a.downbeat === b.downbeat;
}

/** A shift within {@link GRID_SHIFT_LIMIT}, rounded to a tenth of a millisecond. */
export function clampShift(seconds: number): number {
  const limited = Math.max(-GRID_SHIFT_LIMIT, Math.min(GRID_SHIFT_LIMIT, seconds));
  return Math.round(limited * 10000) / 10000 || 0;
}

/** The grid with the correction applied: a new grid, or `grid` itself without a correction. */
export function applyGridEdit(grid: BeatGrid, edit: GridEdit): BeatGrid {
  if (!isGridEdited(edit)) return grid;
  const count = grid.beats.length;
  const beats = grid.beats.map((time) => time + edit.shift);
  let beatInBar = grid.beatInBar;
  if (edit.downbeat !== null && count > 0) {
    const anchor = nearestIndex(grid.beats, edit.downbeat);
    beatInBar = Uint8Array.from(
      { length: count },
      (_, k) => (((k - anchor) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR,
    );
  }
  return beatInBar
    ? { beats, confidence: grid.confidence, beatInBar }
    : { beats, confidence: grid.confidence };
}

/**
 * The correction that makes the beat of `grid` (the corrected grid) nearest to `time` the first
 * of its bar, or `edit` unchanged without beats.
 */
export function downbeatAt(grid: BeatGrid, edit: GridEdit, time: number): GridEdit {
  if (grid.beats.length === 0) return edit;
  const index = nearestIndex(grid.beats, time);
  return { ...edit, downbeat: grid.beats[index]! - edit.shift };
}

/**
 * The correction that counts the bars one beat later (`direction` 1) or earlier (-1), from the
 * downbeat nearest to `time` in `grid` (the corrected grid).
 */
export function shiftBars(
  grid: BeatGrid,
  edit: GridEdit,
  time: number,
  direction: -1 | 1,
): GridEdit {
  const count = grid.beats.length;
  if (count === 0) return edit;
  const position = (k: number) => grid.beatInBar?.[k] ?? k % BEATS_PER_BAR;
  // The downbeat nearest to `time`.
  const near = nearestIndex(grid.beats, time);
  let anchor = -1;
  for (let distance = 0; distance < count && anchor < 0; distance++) {
    for (const k of [near - distance, near + distance]) {
      if (k >= 0 && k < count && position(k) === 0) {
        anchor = k;
        break;
      }
    }
  }
  if (anchor < 0) anchor = near;
  const next = Math.max(0, Math.min(count - 1, anchor + direction));
  // At the first or last beat, a whole bar the other way instead.
  const target = next === anchor ? anchor - direction * (BEATS_PER_BAR - 1) : next;
  const index = Math.max(0, Math.min(count - 1, target));
  return { ...edit, downbeat: grid.beats[index]! - edit.shift };
}

/** Index of the beat nearest to `time` (the beats ascending, at least one). */
function nearestIndex(beats: Float64Array, time: number): number {
  let low = 0;
  let high = beats.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (beats[middle]! < time) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(beats[low - 1]! - time) <= Math.abs(beats[low]! - time)) return low - 1;
  return low;
}
