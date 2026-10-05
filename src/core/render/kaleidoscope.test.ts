import { describe, expect, it } from 'vitest';
import { nextHue, nextReach, stateSquare, viewReach } from './kaleidoscope';

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

  it('reaches as far as the view looks: zoomed out or off centre (KA-05)', () => {
    const aspect = 16 / 9;
    const base = stateSquare(1920, 1080).reach;
    // Zoom 1 in the middle: the square as before.
    expect(viewReach(aspect, 1, 0, 0)).toBeCloseTo(base);
    // Zoomed out to half, the frame's corners show what lies twice as far out.
    expect(viewReach(aspect, 0.5, 0, 0)).toBeCloseTo(base * 2);
    // Moved off centre, the far corner is further away.
    expect(viewReach(aspect, 1, 0.4, 0)).toBeCloseTo(Math.hypot(aspect * 1.8, 1) * 1.05);
    expect(viewReach(aspect, 1, -0.4, 0.4)).toBeCloseTo(Math.hypot(aspect * 1.8, 1.8) * 1.05);
  });

  it('changes its reach in steps, growing at once and shrinking two steps late', () => {
    const base = 2;
    // Zoomed in: never less than in the middle at zoom 1, where the light comes from.
    expect(nextReach(base, 1, base)).toBe(base);
    // Zoomed out: the step that holds what the view needs.
    const half = nextReach(base, base * 2, base);
    expect(half).toBeCloseTo(base * 2);
    const between = nextReach(base, base * 1.5, base);
    expect(between).toBeGreaterThanOrEqual(base * 1.5);
    expect(between).toBeLessThan(base * 1.5 * 2 ** (1 / 8) + 1e-9);
    // One step less is kept, two steps less are let go.
    expect(nextReach(base, half / 2 ** (1 / 8), half)).toBe(half);
    expect(nextReach(base, half / 2 ** (2 / 8), half)).toBeCloseTo(half / 2 ** (2 / 8));
    expect(nextReach(base, base, half)).toBe(base);
  });

  it('takes its colours back when the hue cycle stops', () => {
    const turn = Math.PI * 2;
    // One turn a minute: a quarter turn in 15 s, and it wraps instead of growing.
    let hue = 0;
    for (let i = 0; i < 15 * 60; i++) hue = nextHue(hue, 1, 1 / 60);
    expect(hue).toBeCloseTo(turn / 4, 3);
    for (let i = 0; i < 60 * 60; i++) hue = nextHue(hue, 1, 1 / 60);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(turn);
    // At 0 it goes back to the look's own colours within a few seconds, the short way round.
    hue = turn * 0.9;
    const first = nextHue(hue, 0, 1 / 60);
    expect(first).toBeLessThan(0);
    expect(first).toBeGreaterThan(-turn * 0.1);
    for (let i = 0; i < 4 * 60; i++) hue = nextHue(hue, 0, 1 / 60);
    expect(hue).toBe(0);
  });
});
