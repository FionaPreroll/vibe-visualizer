import { describe, expect, it } from 'vitest';
import { F, SPECTRUM_BANDS } from '../analysis/features';
import { CURVE_POINTS, SpectrumShaper } from './spectrum-shaper';
import { DEFAULT_LOGO_SPECTRUM, MAX_LAYERS, type LogoSpectrumSettings } from './visual-settings';

function frameWith(spectrum: (band: number) => number): Float32Array {
  const frame = new Float32Array(F.size);
  for (let b = 0; b < SPECTRUM_BANDS; b++) frame[F.spectrum + b] = spectrum(b);
  return frame;
}

/** Runs `seconds` at `fps` with the spectrum switching from `a` to `b` halfway. */
function run(fps: number, a: Float32Array, b: Float32Array, settings = DEFAULT_LOGO_SPECTRUM) {
  const shaper = new SpectrumShaper();
  const frames = Math.round(fps * 1.2);
  for (let i = 0; i < frames; i++) shaper.update(i < frames / 2 ? a : b, settings, 1 / fps);
  return shaper.curves;
}

const loud = frameWith((band) => (band < 16 ? 1 : 0.5));
const quiet = frameWith(() => 0.2);

describe('SpectrumShaper', () => {
  it('moves the same at 30, 60, 120 and 144 frames per second (VE-03)', () => {
    const at30 = run(30, loud, quiet);
    for (const [fps, tolerance] of [
      [60, 0.005],
      [120, 0.005],
      // 1.2 s is not a whole number of frames at 144 fps: the switch and the end differ by 3 ms.
      [144, 0.02],
    ] as const) {
      const other = run(fps, loud, quiet);
      let maxDifference = 0;
      for (let i = 0; i < at30.length; i++) {
        maxDifference = Math.max(maxDifference, Math.abs(other[i]! - at30[i]!));
      }
      expect(maxDifference).toBeLessThan(tolerance);
    }
  });

  it('puts the bass at the top and mirrors left and right', () => {
    const bassOnly = frameWith((band) => (band < 8 ? 1 : 0));
    const curves = run(60, bassOnly, bassOnly);
    expect(curves[0]).toBeGreaterThan(0.5);
    expect(curves[CURVE_POINTS / 2]).toBeLessThan(0.01);
    for (let i = 1; i < CURVE_POINTS / 2; i++) {
      expect(curves[CURVE_POINTS - i]).toBeCloseTo(curves[i]!, 5);
    }
  });

  it('keeps quiet parts under the noise floor at zero', () => {
    const curves = run(60, quiet, quiet);
    expect(Math.max(...curves)).toBe(0);
  });

  it('lets the colour layers trail behind the top layer when it falls', () => {
    const settings: LogoSpectrumSettings = { ...DEFAULT_LOGO_SPECTRUM, layerDelay: 0.2 };
    const shaper = new SpectrumShaper();
    for (let i = 0; i < 60; i++) shaper.update(loud, settings, 1 / 60);
    for (let i = 0; i < 10; i++) shaper.update(quiet, settings, 1 / 60);
    const top = shaper.curves[0]!;
    const back = shaper.curves[MAX_LAYERS * CURVE_POINTS]!;
    // The top layer has fallen, the back layers still hold part of the peak.
    expect(back).toBeGreaterThan(top + 0.1);
    for (let layer = 1; layer <= MAX_LAYERS; layer++) {
      expect(shaper.curves[layer * CURVE_POINTS]).toBeGreaterThanOrEqual(
        shaper.curves[(layer - 1) * CURVE_POINTS]! - 1e-6,
      );
    }
  });
});
