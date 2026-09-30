import { FLUX_DELAY, type Analyzer } from './analyzer';
import { LEVEL_FLOOR_DB, LEVEL_STEP } from './bars';
import type { OnsetFeatures } from './beat-grid';
import { SPECTRUM_BANDS } from './features';

/**
 * Collects what the beat grid of a file needs from every analysis frame (AN-07): the onset
 * strength, the accent, whether there is sound, the kick and snare rises, and a coarse spectrum
 * every {@link LEVEL_STEP} frames. The lists grow as needed: about 33 bytes per frame, 20 MB for
 * a two-hour mix.
 */
export class GridFeatureCollector {
  private onset: Float32Array;
  private accent: Float32Array;
  private active: Uint8Array;
  private kick: Float32Array;
  private snare: Float32Array;
  private levels: Uint8Array;
  /** Sum of the spectrum over the frames of the current level step (dB). */
  private readonly sum = new Float64Array(SPECTRUM_BANDS);
  private length = 0;

  /** `capacity`: the frames expected (the lists grow beyond it). */
  constructor(
    private readonly analyzer: Analyzer,
    capacity = 1024,
  ) {
    const frames = Math.ceil(Math.max(16, capacity) / LEVEL_STEP) * LEVEL_STEP;
    this.onset = new Float32Array(frames);
    this.accent = new Float32Array(frames);
    this.active = new Uint8Array(frames);
    this.kick = new Float32Array(frames);
    this.snare = new Float32Array(frames);
    this.levels = new Uint8Array(Math.ceil(frames / LEVEL_STEP) * SPECTRUM_BANDS);
  }

  /** Takes the frame the analyzer has just completed. */
  push(): void {
    const analyzer = this.analyzer;
    if (this.length === this.onset.length) this.grow();
    const at = this.length++;
    this.onset[at] = analyzer.flux;
    this.accent[at] = analyzer.accent;
    this.active[at] = analyzer.active ? 1 : 0;
    this.kick[at] = analyzer.kick;
    this.snare[at] = analyzer.snare;
    const spectrum = analyzer.spectrumDb;
    for (let b = 0; b < SPECTRUM_BANDS; b++) this.sum[b]! += spectrum[b]!;
    if (this.length % LEVEL_STEP === 0) this.flushLevels(LEVEL_STEP);
  }

  /** The features of the frames so far. */
  finish(): OnsetFeatures {
    const partial = this.length % LEVEL_STEP;
    if (partial > 0) this.flushLevels(partial);
    const frames = this.length;
    return {
      frameRate: this.analyzer.sampleRate / this.analyzer.hop,
      onset: this.onset.subarray(0, frames),
      accent: this.accent.subarray(0, frames),
      active: this.active.subarray(0, frames),
      kick: this.kick.subarray(0, frames),
      snare: this.snare.subarray(0, frames),
      levels: this.levels.subarray(0, Math.ceil(frames / LEVEL_STEP) * SPECTRUM_BANDS),
      delay: FLUX_DELAY,
    };
  }

  /** Stores the mean of the last `frames` spectra as the levels of their step. */
  private flushLevels(frames: number): void {
    const offset = Math.floor((this.length - 1) / LEVEL_STEP) * SPECTRUM_BANDS;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const db = this.sum[b]! / frames;
      this.levels[offset + b] = Math.max(0, Math.min(255, Math.round((db - LEVEL_FLOOR_DB) * 2)));
      this.sum[b] = 0;
    }
  }

  private grow(): void {
    const grow = <T extends Float32Array | Uint8Array>(old: T, next: T) => {
      next.set(old);
      return next;
    };
    const frames = this.onset.length * 2;
    this.onset = grow(this.onset, new Float32Array(frames));
    this.accent = grow(this.accent, new Float32Array(frames));
    this.active = grow(this.active, new Uint8Array(frames));
    this.kick = grow(this.kick, new Float32Array(frames));
    this.snare = grow(this.snare, new Float32Array(frames));
    this.levels = grow(this.levels, new Uint8Array((frames / LEVEL_STEP) * SPECTRUM_BANDS));
  }
}
