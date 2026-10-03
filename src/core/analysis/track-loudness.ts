import type { Analyzer } from './analyzer';
import { BAND_NAMES } from './features';

/**
 * How loud a track gets: the levels its loud parts reach, as the analyzer measures them before
 * its auto-gain (dB). Known from the analysis of the whole file, they keep the auto-gain from
 * making a quiet part as big as the loud ones, so a quiet intro stays quiet against the drop.
 */
export interface TrackLoudness {
  /** The loudest band of the spectrum. */
  spectrum: number;
  /** The energy bands, in {@link BAND_NAMES} order. */
  bands: number[];
  /** The overall energy. */
  energy: number;
}

/** The loud parts: the level that this share of the frames with sound stays below. */
const QUANTILE = 0.95;
const MIN_DB = -120;
const MAX_DB = 20;
const STEP_DB = 0.25;
const STEPS = (MAX_DB - MIN_DB) / STEP_DB;
/** With fewer frames of sound (about 2 s), a file says too little about how loud it gets. */
const MIN_FRAMES = 200;
/** The measures: the loudest spectrum band, the energy, then each band. */
const MEASURES = 2 + BAND_NAMES.length;

/** Collects the levels of every analysis frame with sound, for the {@link TrackLoudness}. */
export class LoudnessCollector {
  private readonly counts = new Uint32Array(MEASURES * STEPS);
  private frames = 0;

  constructor(private readonly analyzer: Analyzer) {}

  /** Takes the levels of the analyzer's last frame. */
  push(): void {
    const analyzer = this.analyzer;
    if (!analyzer.active) return;
    this.frames++;
    this.add(0, analyzer.loudestDb);
    this.add(1, analyzer.energyDb);
    for (let n = 0; n < BAND_NAMES.length; n++) this.add(2 + n, analyzer.bandDb[n]!);
  }

  /** The levels of the loud parts; null for a file with too little sound to tell. */
  finish(): TrackLoudness | null {
    if (this.frames < MIN_FRAMES) return null;
    const level = (measure: number) => {
      const wanted = QUANTILE * this.frames;
      let count = 0;
      for (let step = 0; step < STEPS; step++) {
        count += this.counts[measure * STEPS + step]!;
        if (count >= wanted) return MIN_DB + (step + 0.5) * STEP_DB;
      }
      return MAX_DB;
    };
    return {
      spectrum: level(0),
      energy: level(1),
      bands: BAND_NAMES.map((_, n) => level(2 + n)),
    };
  }

  private add(measure: number, db: number): void {
    const step = Math.min(STEPS - 1, Math.max(0, Math.floor((db - MIN_DB) / STEP_DB)));
    this.counts[measure * STEPS + step]!++;
  }
}

/** Levels as stored (an export's manifest), checked; null for anything else. */
export function sanitizeLoudness(value: unknown): TrackLoudness | null {
  if (typeof value !== 'object' || value === null) return null;
  const { spectrum, energy, bands } = value as Record<string, unknown>;
  const valid = (db: unknown): db is number =>
    typeof db === 'number' && Number.isFinite(db) && db >= MIN_DB && db <= MAX_DB;
  if (!valid(spectrum) || !valid(energy) || !Array.isArray(bands)) return null;
  if (bands.length !== BAND_NAMES.length || !bands.every(valid)) return null;
  return { spectrum, energy, bands: [...(bands as number[])] };
}

/** The same levels (as sent again, a copy). */
export function sameLoudness(a: TrackLoudness, b: TrackLoudness): boolean {
  return (
    a.spectrum === b.spectrum &&
    a.energy === b.energy &&
    a.bands.length === b.bands.length &&
    a.bands.every((db, n) => db === b.bands[n])
  );
}
