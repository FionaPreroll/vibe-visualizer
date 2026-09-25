import { BandFilter } from './filters';

/**
 * Causal kick, snare and hi-hat detection with a resolution of 128 samples (a "tick", 2.7 ms at
 * 48 kHz), much finer than the analysis hop.
 *
 * Each drum watches the energy envelope of its own frequency band. An onset is a rise of the
 * envelope above its minimum over the last 21 ms, picked at its local maximum. A candidate
 * becomes a hit if the rise is large enough and the envelope gets close to the band's recent
 * peak level, which rejects quieter instruments playing in the same band (bass notes under the
 * kick, vocals and guitars under the snare). The snare also needs a rise in the drum body band
 * (150–300 Hz), which tonal instruments above 1 kHz do not have.
 *
 * Thresholds were chosen on a synthetic EDM mix (eval/drum-mix.ts) and checked on real
 * recordings (MDB Drums, see tests/eval): see docs/ANALYSIS.md for the numbers.
 */

/** Samples per detection step. */
export const DRUM_TICK = 128;

/** The rise is measured against the minimum level of this many previous ticks (21 ms). */
const FLOOR_TICKS = 8;
/** Ring buffer length for levels and rises (a power of two above FLOOR_TICKS + lookback). */
const HISTORY = 16;
/** Peak follower release: after a loud passage, quieter hits count again within seconds. */
const PEAK_RELEASE_DB_PER_SECOND = 3;
const SILENCE_DB = -100;
/** Rises below this are not the start of an onset (for estimating the onset time). */
const RISE_START_DB = 1;
/** Band levels below this (dB relative to full scale) are never hits. */
const ABSOLUTE_FLOOR_DB = -80;

export interface DrumSettings {
  /** Minimum rise of the band level above its recent minimum, in dB. */
  minRise: number;
  /** The level must reach at least the band's recent peak minus this, in dB. */
  levelRange: number;
  /** Minimum time between two hits, in seconds. */
  refractory: number;
}

export interface SnareSettings extends DrumSettings {
  /** Minimum rise of the drum-body band (150–300 Hz) around the onset, in dB. */
  minBodyRise: number;
  /** Maximum level of the hi-hat band above the snare band, in dB (rejects hi-hat spill). */
  maxHighExcess: number;
}

export interface HatSettings extends DrumSettings {
  /** Maximum drop of the level within 5 ms after the peak, in dB (rejects short clicks). */
  maxDecay: number;
}

export interface DrumDetectorOptions {
  kick?: Partial<DrumSettings>;
  snare?: Partial<SnareSettings>;
  hat?: Partial<HatSettings>;
}

export const DRUM_DEFAULTS: {
  kick: DrumSettings;
  snare: SnareSettings;
  hat: HatSettings;
} = {
  kick: { minRise: 5, levelRange: 3.5, refractory: 0.09 },
  snare: { minRise: 5, levelRange: 10, refractory: 0.05, minBodyRise: 5, maxHighExcess: 10 },
  hat: { minRise: 9, levelRange: 10, refractory: 0.04, maxDecay: 6 },
};

/** Energy envelope of one frequency band, in dB per tick, with its recent rise and peak. */
class BandEnvelope {
  private readonly filter: BandFilter;
  private readonly squares: Float64Array;
  private squareSum = 0;
  private tickSum = 0;
  private readonly levels = new Float64Array(HISTORY).fill(SILENCE_DB);
  private readonly rises = new Float64Array(HISTORY);
  /** Peak follower value before each tick. */
  private readonly peaks = new Float64Array(HISTORY).fill(SILENCE_DB);
  private readonly releasePerTick: number;
  /** Ticks processed so far. */
  count = 0;
  /** Peak follower of the level, as it was before the current tick. */
  previousPeak = SILENCE_DB;
  private peak = SILENCE_DB;

  constructor(
    sampleRate: number,
    highpass: number | undefined,
    lowpass: number | undefined,
    smoothTicks: number,
  ) {
    this.filter = new BandFilter(sampleRate, highpass, lowpass);
    this.squares = new Float64Array(smoothTicks);
    this.releasePerTick = (PEAK_RELEASE_DB_PER_SECOND * DRUM_TICK) / sampleRate;
  }

  add(sample: number): void {
    const y = this.filter.process(sample);
    this.tickSum += y * y;
  }

  /** Closes the current tick: updates level, rise and peak. */
  endTick(): void {
    const slot = this.count % this.squares.length;
    this.squareSum += this.tickSum / DRUM_TICK - this.squares[slot]!;
    this.squares[slot] = this.tickSum / DRUM_TICK;
    this.tickSum = 0;
    const meanSquare = Math.max(0, this.squareSum) / this.squares.length;
    const level = 10 * Math.log10(meanSquare + 1e-10);
    let floor = Infinity;
    for (let j = 1; j <= FLOOR_TICKS; j++) {
      const previous = this.levels[(this.count - j + HISTORY) % HISTORY]!;
      if (previous < floor) floor = previous;
    }
    const index = this.count % HISTORY;
    this.levels[index] = level;
    this.rises[index] = Math.max(0, level - floor);
    this.peaks[index] = this.peak;
    this.previousPeak = this.peak;
    this.peak = Math.max(level, this.peak - this.releasePerTick, SILENCE_DB);
    this.count++;
  }

  /** Level `ago` ticks back (0 = the tick just closed). */
  level(ago: number): number {
    return this.levels[(this.count - 1 - ago + HISTORY * 4) % HISTORY]!;
  }

  /** Peak follower value just before the tick `ago` ticks back. */
  peakBefore(ago: number): number {
    return this.peaks[(this.count - 1 - ago + HISTORY * 4) % HISTORY]!;
  }

  rise(ago: number): number {
    return this.rises[(this.count - 1 - ago + HISTORY * 4) % HISTORY]!;
  }

  /** Largest rise within the last `ticks` ticks. */
  maxRise(ticks: number): number {
    let max = 0;
    for (let j = 0; j < ticks; j++) max = Math.max(max, this.rise(j));
    return max;
  }

  reset(): void {
    this.filter.reset();
    this.squares.fill(0);
    this.squareSum = 0;
    this.tickSum = 0;
    this.levels.fill(SILENCE_DB);
    this.rises.fill(0);
    this.peaks.fill(SILENCE_DB);
    this.count = 0;
    this.peak = SILENCE_DB;
    this.previousPeak = SILENCE_DB;
  }
}

/**
 * Onset picking for one drum: local maxima of the band rise, decided `delay` ticks after the
 * peak (so that checks can look at what follows the peak).
 */
class OnsetPicker {
  readonly settings: DrumSettings;
  readonly delay: number;
  private readonly refractoryTicks: number;
  private sinceHit = 1e9;
  private riseStart = 0;
  /** Ticks since the onset of the hit confirmed in this tick, or -1. */
  hitAge = -1;

  constructor(settings: DrumSettings, sampleRate: number, delay: number) {
    this.settings = settings;
    this.delay = delay;
    this.refractoryTicks = Math.round((settings.refractory * sampleRate) / DRUM_TICK);
  }

  /** Whether the tick `delay` ticks ago is a candidate: a large enough, loud enough peak. */
  candidate(band: BandEnvelope, levelRange: number): boolean {
    this.hitAge = -1;
    this.sinceHit++;
    const d = this.delay;
    if (band.rise(d) < RISE_START_DB) this.riseStart = band.count - d;
    const rise = band.rise(d);
    if (rise < this.settings.minRise || rise < band.rise(d + 1) || rise <= band.rise(d - 1)) {
      return false;
    }
    if (this.sinceHit < this.refractoryTicks) return false;
    if (band.level(d) < ABSOLUTE_FLOOR_DB) return false;
    const floor = band.peakBefore(d) - levelRange;
    return band.level(d) >= floor || band.level(d - 1) >= floor;
  }

  /** Accepts the current candidate as a hit. */
  confirm(band: BandEnvelope): void {
    this.sinceHit = 0;
    // Report the onset where the rise began (at most FLOOR_TICKS before the peak).
    this.hitAge = Math.min(FLOOR_TICKS + this.delay, band.count - this.riseStart);
  }

  reset(): void {
    this.sinceHit = 1e9;
    this.riseStart = 0;
    this.hitAge = -1;
  }
}

export class DrumDetector {
  readonly sampleRate: number;
  private readonly low: BandEnvelope;
  private readonly body: BandEnvelope;
  private readonly mid: BandEnvelope;
  private readonly high: BandEnvelope;
  private readonly kick: OnsetPicker;
  private readonly snare: OnsetPicker;
  private readonly hat: OnsetPicker;
  private readonly snareSettings: SnareSettings;
  private readonly hatSettings: HatSettings;
  /** After {@link endTick}: ticks since the onset of a hit detected in this tick, or -1. */
  readonly hitAge = new Int32Array(3).fill(-1);

  constructor(sampleRate: number, options: DrumDetectorOptions = {}) {
    this.sampleRate = sampleRate;
    this.low = new BandEnvelope(sampleRate, 40, 100, 8);
    this.body = new BandEnvelope(sampleRate, 150, 300, 4);
    this.mid = new BandEnvelope(sampleRate, 1000, 4000, 2);
    this.high = new BandEnvelope(sampleRate, 8000, undefined, 1);
    this.kick = new OnsetPicker({ ...DRUM_DEFAULTS.kick, ...options.kick }, sampleRate, 1);
    this.snareSettings = { ...DRUM_DEFAULTS.snare, ...options.snare };
    this.snare = new OnsetPicker(this.snareSettings, sampleRate, 1);
    // The hi-hat decides two ticks after the peak, to see whether the sound lasts.
    this.hatSettings = { ...DRUM_DEFAULTS.hat, ...options.hat };
    this.hat = new OnsetPicker(this.hatSettings, sampleRate, 2);
  }

  /** Feeds one mono sample. */
  add(sample: number): void {
    this.low.add(sample);
    this.body.add(sample);
    this.mid.add(sample);
    this.high.add(sample);
  }

  /** Closes a tick (call every {@link DRUM_TICK} samples) and runs the onset pickers. */
  endTick(): void {
    this.low.endTick();
    this.body.endTick();
    this.mid.endTick();
    this.high.endTick();
    if (this.kick.candidate(this.low, this.kick.settings.levelRange)) this.kick.confirm(this.low);

    const snare = this.snareSettings;
    if (
      this.snare.candidate(this.mid, snare.levelRange) &&
      this.body.maxRise(6) >= snare.minBodyRise &&
      this.high.level(1) - this.mid.level(1) <= snare.maxHighExcess
    ) {
      this.snare.confirm(this.mid);
    }

    const hat = this.hatSettings;
    if (
      this.hat.candidate(this.high, hat.levelRange) &&
      this.high.level(2) - this.high.level(0) <= hat.maxDecay
    ) {
      this.hat.confirm(this.high);
    }

    this.hitAge[0] = this.kick.hitAge;
    this.hitAge[1] = this.snare.hitAge;
    this.hitAge[2] = this.hat.hitAge;
  }

  /**
   * Rise of the kick band plus the drum-body band in the last tick, in dB: sounds that usually
   * mark the beat rather than the offbeat (the beat tracker's accent).
   */
  get accent(): number {
    return this.low.rise(0) + this.body.rise(0);
  }

  reset(): void {
    for (const band of [this.low, this.body, this.mid, this.high]) band.reset();
    for (const picker of [this.kick, this.snare, this.hat]) picker.reset();
    this.hitAge.fill(-1);
  }
}
