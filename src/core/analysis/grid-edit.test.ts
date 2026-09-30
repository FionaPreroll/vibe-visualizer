import { describe, expect, it } from 'vitest';
import type { BeatGrid } from './beat-grid';
import {
  applyGridEdit,
  clampShift,
  downbeatAt,
  GRID_SHIFT_LIMIT,
  isGridEdited,
  NO_GRID_EDIT,
  shiftBars,
} from './grid-edit';

/** Twelve beats at 120 BPM from 1 s on, the analysis putting the downbeat on the second beat. */
function grid(): BeatGrid {
  return {
    beats: Float64Array.from({ length: 12 }, (_, k) => 1 + k * 0.5),
    confidence: new Float32Array(12).fill(1),
    beatInBar: Uint8Array.from({ length: 12 }, (_, k) => (k + 3) % 4),
  };
}

describe('beat grid correction', () => {
  it('leaves a grid without a correction as it is', () => {
    const found = grid();
    expect(applyGridEdit(found, NO_GRID_EDIT)).toBe(found);
    expect(isGridEdited(NO_GRID_EDIT)).toBe(false);
  });

  it('moves the grid and counts the bars from the downbeat', () => {
    const found = grid();
    const edited = applyGridEdit(found, { shift: 0.02, downbeat: 3.01 });
    expect(edited.beats[0]).toBeCloseTo(1.02, 9);
    expect(edited.beats[11]).toBeCloseTo(6.52, 9);
    // The beat at 3 s (the fifth) is the downbeat, and so is every fourth from it.
    expect(Array.from(edited.beatInBar!)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    expect(edited.confidence).toBe(found.confidence);
    // The found grid is unchanged.
    expect(found.beats[0]).toBe(1);
  });

  it('sets the downbeat at the beat nearest to a time, in the grid as found', () => {
    const shifted = { shift: 0.1, downbeat: null };
    const edited = applyGridEdit(grid(), shifted);
    // The playhead near the corrected beat at 2.6 s: the found beat at 2.5 s is the downbeat.
    const edit = downbeatAt(edited, shifted, 2.63);
    expect(edit).toEqual({ shift: 0.1, downbeat: 2.5 });
    const positions = applyGridEdit(grid(), edit).beatInBar!;
    expect(positions[3]).toBe(0);
    expect(positions[4]).toBe(1);
  });

  it('moves the bars by a beat, from the downbeat nearest to a time', () => {
    const found = grid();
    // The downbeats as found are at 1.5, 3.5 and 5.5 s; the one near 3.4 s moves a beat later.
    const later = shiftBars(found, NO_GRID_EDIT, 3.4, 1);
    expect(later.downbeat).toBe(4);
    expect(applyGridEdit(found, later).beatInBar![6]).toBe(0);
    const earlier = shiftBars(found, NO_GRID_EDIT, 3.4, -1);
    expect(earlier.downbeat).toBe(3);
    // Twice later from a correction: two beats after the first downbeat.
    const twice = shiftBars(applyGridEdit(found, later), later, 4, 1);
    expect(twice.downbeat).toBe(4.5);
    // At the first beat, a beat earlier is a bar later minus a beat.
    const start = { shift: 0, downbeat: 1 };
    const wrapped = shiftBars(applyGridEdit(found, start), start, 1, -1);
    expect(applyGridEdit(found, wrapped).beatInBar![0]).toBe(1);
  });

  it('keeps a shift within the limit, to a tenth of a millisecond', () => {
    expect(clampShift(0.01234)).toBe(0.0123);
    expect(clampShift(3)).toBe(GRID_SHIFT_LIMIT);
    expect(clampShift(-3)).toBe(-GRID_SHIFT_LIMIT);
    expect(Object.is(clampShift(-0.00001), 0)).toBe(true);
  });
});
