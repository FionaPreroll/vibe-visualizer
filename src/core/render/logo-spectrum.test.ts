import { describe, expect, it } from 'vitest';
import { backgroundDrift, cameraShake } from './logo-spectrum';
import { NO_CAMERA } from './post';

describe('Logo Spectrum motion (LS-03)', () => {
  it('drifts only when asked, gently and within the crop', () => {
    expect(backgroundDrift(0, 12.3)).toEqual({ zoom: 1, x: 0, y: 0 });
    for (let time = 0; time < 120; time += 0.7) {
      const drift = backgroundDrift(1, time);
      expect(drift.zoom).toBeGreaterThanOrEqual(1);
      expect(drift.zoom).toBeLessThanOrEqual(1.12);
      expect(Math.abs(drift.x)).toBeLessThanOrEqual(0.8);
      expect(Math.abs(drift.y)).toBeLessThanOrEqual(0.8);
    }
    // Slow: a tenth of a second moves it very little.
    const a = backgroundDrift(1, 30);
    const b = backgroundDrift(1, 30.1);
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThan(0.03);
  });

  it('shakes with the kick, within the zoom, the same way for the same time', () => {
    expect(cameraShake(0, 1, 5, 16 / 9)).toBe(NO_CAMERA);
    const still = cameraShake(1, 0, 5, 16 / 9);
    expect(Math.abs(still.x) + Math.abs(still.y)).toBe(0);
    let largest = 0;
    for (let time = 0; time < 10; time += 0.013) {
      const camera = cameraShake(1, 1, time, 16 / 9);
      // What the zoom crops away on each side covers the offset.
      const margin = (1 - 1 / camera.zoom) / 2;
      expect(Math.abs(camera.x)).toBeLessThanOrEqual(margin);
      expect(Math.abs(camera.y)).toBeLessThanOrEqual(margin);
      largest = Math.max(largest, Math.abs(camera.y));
    }
    expect(largest).toBeGreaterThan(0.008);
    expect(cameraShake(0.5, 0.8, 3.21, 1)).toEqual(cameraShake(0.5, 0.8, 3.21, 1));
  });
});
