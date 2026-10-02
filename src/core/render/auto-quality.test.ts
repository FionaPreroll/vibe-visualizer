import { describe, expect, it } from 'vitest';
import { AutoQuality, QUALITY_STEP, RENDER_SCALE_RANGE } from './auto-quality';

/** Feeds `seconds` measurements of `fps`; returns the scales after each. */
function feed(quality: AutoQuality, fps: number, seconds: number): number[] {
  const scales: number[] = [];
  for (let i = 0; i < seconds; i++) {
    quality.update(fps);
    scales.push(quality.scale);
  }
  return scales;
}

describe('auto-quality (VE-07)', () => {
  it('steps down while the frame rate stays low, not in the first seconds', () => {
    const quality = new AutoQuality();
    // A slow start (compiling shaders) does not count.
    feed(quality, 10, 3);
    expect(quality.scale).toBe(1);
    feed(quality, 60, 5);
    // Three slow seconds: one step down; three more: another.
    expect(feed(quality, 30, 6)).toEqual([1, 1, 0.875, 0.875, 0.875, 0.75]);
    // Never below the lowest scale.
    feed(quality, 20, 60);
    expect(quality.scale).toBe(RENDER_SCALE_RANGE.min);
  });

  it('leaves a screen alone that is simply slower (30 Hz, battery saver)', () => {
    const quality = new AutoQuality();
    feed(quality, 30, 120);
    expect(quality.scale).toBe(1);
    // Short dips do not count.
    for (let i = 0; i < 20; i++) feed(quality, i % 3 === 0 ? 12 : 30, 1);
    expect(quality.scale).toBe(1);
  });

  it('steps up after a smooth while, but not right after a step down', () => {
    const quality = new AutoQuality();
    feed(quality, 60, 5);
    feed(quality, 30, 3);
    expect(quality.scale).toBe(1 - QUALITY_STEP);
    // Smooth again: it holds the lower scale for a minute, then steps up.
    const scales = feed(quality, 60, 70);
    expect(scales[50]).toBe(1 - QUALITY_STEP);
    expect(quality.scale).toBe(1);
    quality.reset();
    expect(quality.scale).toBe(1);
  });
});
