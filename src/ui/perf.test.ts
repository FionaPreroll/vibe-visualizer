import { describe, expect, it } from 'vitest';
import { evenness, spread } from './perf';

describe('the measurements of ?perf', () => {
  it('give the percentiles and the maximum', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(spread(values)).toEqual({ count: 100, p50: 51, p95: 96, p99: 100, max: 100 });
    expect(spread([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it('find an even move even, and the steps of a position that moves in jerks', () => {
    const times = Array.from({ length: 120 }, (_, i) => i * (1000 / 60));
    const smooth = times.map((time) => 10 + time / 1000);
    expect(evenness(times, smooth).sd).toBeLessThan(0.01);
    // Moving on in steps of 10 ms, read every 16.7 ms: 10 or 20 ms a frame.
    const stepped = times.map((time) => 10 + Math.floor(time / 10) / 100);
    const jerky = evenness(times, stepped);
    expect(jerky.sd).toBeGreaterThan(4);
    expect(jerky.max).toBeGreaterThan(6);
  });

  it('leave out frames that stand still, and jumps', () => {
    const times = Array.from({ length: 120 }, (_, i) => i * (1000 / 60));
    const positions = times.map((time, i) =>
      i < 30 ? 5 : i < 60 ? 5 + time / 1000 : 60 + time / 1000,
    );
    const result = evenness(times, positions);
    expect(result.sd).toBeLessThan(0.01);
    expect(result.frames).toBe(88);
  });
});
