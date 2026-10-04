import { describe, expect, it } from 'vitest';
import { stateSquare } from './kaleidoscope';

describe('the Kaleidoscope state', () => {
  it('holds the circle the corners of the frame turn on, at its pixel density', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [2560, 1080],
    ] as const) {
      const { side, reach } = stateSquare(width, height);
      // The corner, in units of half the frame's height, lies inside the square.
      expect(reach).toBeGreaterThan(Math.hypot(width / height, 1));
      // A pixel of the state is a pixel of the frame: its height spans height / 2 per unit.
      expect(side / (2 * reach)).toBeCloseTo(height / 2, 0);
    }
    // Upright or across, the frame turns on the same circle.
    expect(stateSquare(1080, 1920).side).toBe(stateSquare(1920, 1080).side);
  });

  it('keeps to the largest side, covering the same circle with fewer pixels', () => {
    const uhd = stateSquare(3840, 2160);
    expect(uhd.side).toBe(4096);
    expect(uhd.reach).toBeCloseTo(stateSquare(1920, 1080).reach);
    expect(stateSquare(1920, 1080, 2048).side).toBe(2048);
  });
});
