import { F, SPECTRUM_BANDS } from '../analysis/features';
import { MAX_LAYERS, type LogoSpectrumSettings } from './visual-settings';

/**
 * Turns the analysis spectrum into the curves of the spectrum ring (LS-05, LS-06, LS-08): one
 * value per angle for the top layer and for each colour layer behind it.
 *
 * All smoothing is exponential in real time (factor 1 − e^(−dt/τ)), so the ring moves the same
 * at 30, 60 or 144 frames per second, and in the export (VE-03).
 */

/** Samples around the full circle, clockwise from the top. */
export const CURVE_POINTS = 256;

/** Frequency range of the analysis spectrum (see Analyzer). */
const SPECTRUM_MIN_HZ = 30;
const SPECTRUM_MAX_HZ = 16000;
/** Emphasises peaks: quiet bands shrink more than loud ones. */
const CONTRAST = 2;
/** Soft upper limit of a curve value. */
const LIMIT = 1.5;
/**
 * Longest internal step, in seconds. The layers chase a moving target, which only matches
 * across frame rates when the steps are small; slow frame rates take several steps per frame.
 */
const MAX_STEP = 1 / 240;

export class SpectrumShaper {
  /** curves[layer * CURVE_POINTS + i], layer 0 = top layer, then the colour layers. */
  readonly curves = new Float32Array((MAX_LAYERS + 1) * CURVE_POINTS);
  private readonly bands = new Float32Array(SPECTRUM_BANDS);
  private readonly shaped = new Float32Array(CURVE_POINTS);
  private kernel = new Float32Array(1);
  private kernelSmoothing = -1;

  /** Advances by `dt` seconds towards the spectrum in `frame` (layout F). */
  update(frame: Float32Array, settings: LogoSpectrumSettings, dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9));
    for (let step = 0; step < steps; step++) this.step(frame, settings, dt / steps);
  }

  private step(frame: Float32Array, settings: LogoSpectrumSettings, dt: number): void {
    // Temporal attack/release per band, after tilt, noise threshold and contrast.
    const attack = 1 - Math.exp(-dt / Math.max(1e-4, settings.attack));
    const release = 1 - Math.exp(-dt / Math.max(1e-4, settings.release));
    const threshold = settings.threshold;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const position = b / (SPECTRUM_BANDS - 1);
      let value = frame[F.spectrum + b]! - settings.tilt * (0.35 - position) * 0.3;
      value = Math.max(0, (value - threshold) / (1 - threshold));
      value = settings.sensitivity * value ** CONTRAST;
      const current = this.bands[b]!;
      this.bands[b] = current + (value - current) * (value > current ? attack : release);
    }

    // Map the frequency range around the circle (mirrored: bass at the top on both sides).
    const logMin = Math.log(Math.max(SPECTRUM_MIN_HZ, settings.minFrequency));
    const logMax = Math.log(Math.min(SPECTRUM_MAX_HZ, settings.maxFrequency));
    const logSpan = Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const turn = i / CURVE_POINTS;
      const x = settings.mirror ? 1 - Math.abs(1 - 2 * turn) : turn;
      const frequency = Math.exp(logMin + (logMax - logMin) * x);
      const band = (Math.log(frequency / SPECTRUM_MIN_HZ) / logSpan) * SPECTRUM_BANDS - 0.5;
      this.shaped[i] = catmullRom(this.bands, band);
    }

    // Smoothing along the ring (circular Gaussian), then the soft limit.
    this.updateKernel(settings.smoothing);
    const kernel = this.kernel;
    const radius = (kernel.length - 1) / 2;
    const top = this.curves;
    for (let i = 0; i < CURVE_POINTS; i++) {
      let sum = 0;
      for (let k = 0; k < kernel.length; k++) {
        const j = (i + k - radius + CURVE_POINTS) % CURVE_POINTS;
        sum += this.shaped[j]! * kernel[k]!;
      }
      top[i] = LIMIT * Math.tanh(Math.max(0, sum) / LIMIT);
    }

    // Colour layers: each rises with the one in front of it but falls back more slowly, so
    // peaks leave a coloured trail behind the top layer (the rainbow fringe).
    const lag = settings.layerDelay > 0 ? 1 - Math.exp(-dt / settings.layerDelay) : 1;
    for (let layer = 1; layer <= MAX_LAYERS; layer++) {
      const base = layer * CURVE_POINTS;
      const front = base - CURVE_POINTS;
      for (let i = 0; i < CURVE_POINTS; i++) {
        const ahead = this.curves[front + i]!;
        const current = this.curves[base + i]!;
        this.curves[base + i] = ahead >= current ? ahead : current + (ahead - current) * lag;
      }
    }
  }

  reset(): void {
    this.curves.fill(0);
    this.bands.fill(0);
  }

  private updateKernel(smoothing: number): void {
    if (smoothing === this.kernelSmoothing) return;
    this.kernelSmoothing = smoothing;
    const sigma = Math.max(0.3, smoothing * (CURVE_POINTS / 24));
    const radius = Math.ceil(sigma * 3);
    const kernel = new Float32Array(radius * 2 + 1);
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const weight = Math.exp(-0.5 * (k / sigma) ** 2);
      kernel[k + radius] = weight;
      sum += weight;
    }
    for (let k = 0; k < kernel.length; k++) kernel[k]! /= sum;
    this.kernel = kernel;
  }
}

/** Catmull-Rom interpolation of `values` at a fractional index (clamped at the ends). */
function catmullRom(values: Float32Array, position: number): number {
  const last = values.length - 1;
  const clamped = Math.max(0, Math.min(last, position));
  const i = Math.floor(clamped);
  const t = clamped - i;
  const p0 = values[Math.max(0, i - 1)]!;
  const p1 = values[i]!;
  const p2 = values[Math.min(last, i + 1)]!;
  const p3 = values[Math.min(last, i + 2)]!;
  return (
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  );
}
