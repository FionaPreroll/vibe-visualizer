import FFT from 'fft.js';
import { BeatTracker } from './beat-tracker';
import { DRUM_TICK, DrumDetector, type DrumDetectorOptions } from './drums';
import { BAND_NAMES, BAND_RANGES, F, SPECTRUM_BANDS, WAVEFORM_POINTS } from './features';

/**
 * Turns an audio stream into analysis frames at a fixed hop (default every 512 samples, about
 * 94 frames per second at 48 kHz): spectrum, band energies and loudness from an FFT, drum hits
 * from the {@link DrumDetector} (which works in finer steps) and the beat from the
 * {@link BeatTracker}. The frame rate does not depend on the display, so live view and offline
 * export see the same values. Allocation-free after construction: safe to run in the
 * AudioWorklet. Background and measurements: docs/ANALYSIS.md.
 */

export interface AnalyzerOptions {
  fftSize?: number;
  /** Samples per analysis frame; a multiple of {@link DRUM_TICK}. */
  hop?: number;
  drums?: DrumDetectorOptions;
}

const MIN_HZ = 30;
const MAX_HZ = 16000;
/** Spectrum tilt so that highs are not dwarfed by the bass (like a pink-noise reference). */
const TILT_DB_PER_OCTAVE = 3;
/** Auto-gain: references follow peaks instantly and fall back slowly (dB per second). */
const RELEASE_DB_PER_SECOND = 3;
const FLOOR_DB = -70;

/** Decay times of the kick, snare and hi-hat envelopes, in seconds. */
export const DRUM_DECAY_SECONDS: readonly number[] = [0.12, 0.1, 0.06];
const BEAT_DECAY = 0.1;
/** Hops quieter than this (RMS, about -80 dBFS) count as silence for the beat tracker. */
const SILENCE_RMS = 1e-4;
/** Frequency range of the spectral flux that drives the beat tracker. */
const FLUX_MIN_HZ = 30;
const FLUX_MAX_HZ = 16000;

export class Analyzer {
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly hop: number;
  /** The most recent analysis frame (layout: {@link F}). */
  readonly frame = new Float32Array(F.size);

  private readonly history: Float32Array;
  private writeIndex = 0;
  private sinceHop = 0;
  private hopPeak = 0;
  private hopSquares = 0;

  private readonly fft: FFT;
  private readonly hann: Float64Array;
  private readonly windowed: Float64Array;
  private readonly complex: number[];
  private readonly power: Float64Array;
  private logMagnitude: Float64Array;
  private previousLogMagnitude: Float64Array;
  private readonly powerScale: number;

  private readonly bandLow = new Float64Array(SPECTRUM_BANDS);
  private readonly bandHigh = new Float64Array(SPECTRUM_BANDS);
  private readonly bandTilt = new Float64Array(SPECTRUM_BANDS);
  private readonly energyBins: Int32Array[];
  private readonly spectrumDb = new Float64Array(SPECTRUM_BANDS);
  private spectrumReference = -40;
  private readonly bandReference = new Float64Array(BAND_NAMES.length).fill(-40);
  private energyReference = -40;
  private readonly releasePerHop: number;
  private readonly fluxFirstBin: number;
  private readonly fluxLastBin: number;

  private readonly drums: DrumDetector;
  private readonly beats: BeatTracker;
  private sinceTick = 0;
  /** Samples processed so far. */
  private samples = 0;
  /** Sample index of the latest kick, snare and hi-hat onset, or -1. */
  private readonly lastOnset = new Float64Array(3).fill(-1);
  private readonly hopHits = new Uint8Array(3);
  /** Largest rise of the kick and drum-body bands within the current hop (the beat accent). */
  private hopAccent = 0;
  /** Frames since the last reported beat. */
  private sinceBeat = 1e9;

  constructor(sampleRate: number, options: AnalyzerOptions = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = options.fftSize ?? 2048;
    this.hop = options.hop ?? 512;
    const size = this.fftSize;
    const bins = size / 2 + 1;
    const binHz = sampleRate / size;

    this.history = new Float32Array(size);
    this.fft = new FFT(size);
    this.complex = this.fft.createComplexArray();
    this.hann = Float64Array.from(
      { length: size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size),
    );
    this.windowed = new Float64Array(size);
    this.power = new Float64Array(bins);
    this.logMagnitude = new Float64Array(bins);
    this.previousLogMagnitude = new Float64Array(bins);
    // A full-scale sine then peaks at about 0 dB.
    this.powerScale = 1 / ((size / 4) * (size / 4));

    // Log-spaced spectrum bands, stored as fractional bin positions.
    const ratio = MAX_HZ / MIN_HZ;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const low = MIN_HZ * ratio ** (b / SPECTRUM_BANDS);
      const high = MIN_HZ * ratio ** ((b + 1) / SPECTRUM_BANDS);
      this.bandLow[b] = low / binHz;
      this.bandHigh[b] = high / binHz;
      this.bandTilt[b] = TILT_DB_PER_OCTAVE * Math.log2(Math.sqrt(low * high) / 1000);
    }

    const binsIn = (ranges: (readonly [number, number])[]) => {
      const list: number[] = [];
      for (const [low, high] of ranges) {
        for (let k = Math.ceil(low / binHz); k <= Math.floor(high / binHz) && k < bins; k++) {
          list.push(k);
        }
      }
      return Int32Array.from(list);
    };
    this.energyBins = BAND_NAMES.map((name) => binsIn([BAND_RANGES[name]]));

    if (this.hop % DRUM_TICK !== 0) throw new Error(`hop must be a multiple of ${DRUM_TICK}`);
    this.releasePerHop = RELEASE_DB_PER_SECOND * (this.hop / sampleRate);
    this.fluxFirstBin = Math.ceil(FLUX_MIN_HZ / binHz);
    this.fluxLastBin = Math.min(bins - 1, Math.floor(FLUX_MAX_HZ / binHz));
    this.drums = new DrumDetector(sampleRate, options.drums);
    // Beats are reported ~21 ms early: the spectral flux peaks about that much after an onset.
    this.beats = new BeatTracker(sampleRate / this.hop, Math.round((0.02 * sampleRate) / this.hop));
  }

  reset(): void {
    this.history.fill(0);
    this.writeIndex = 0;
    this.sinceHop = 0;
    this.hopPeak = 0;
    this.hopSquares = 0;
    this.previousLogMagnitude.fill(0);
    this.frame.fill(0);
    this.drums.reset();
    this.beats.reset();
    this.sinceTick = 0;
    this.samples = 0;
    this.lastOnset.fill(-1);
    this.hopHits.fill(0);
    this.hopAccent = 0;
    this.sinceBeat = 1e9;
  }

  /**
   * Feeds `frames` samples. For every completed hop, `onFrame(offset)` is called with the
   * number of samples of this block consumed so far; {@link frame} then holds the new values.
   */
  process(
    left: Float32Array,
    right: Float32Array,
    frames: number,
    onFrame: (offset: number) => void,
  ): void {
    const history = this.history;
    const mask = this.fftSize - 1;
    for (let i = 0; i < frames; i++) {
      const sample = (left[i]! + right[i]!) * 0.5;
      history[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) & mask;
      const magnitude = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      if (magnitude > this.hopPeak) this.hopPeak = magnitude;
      this.hopSquares += sample * sample;
      this.samples++;
      this.drums.add(sample);
      if (++this.sinceTick === DRUM_TICK) {
        this.sinceTick = 0;
        this.drums.endTick();
        this.hopAccent = Math.max(this.hopAccent, this.drums.accent);
        const ages = this.drums.hitAge;
        for (let d = 0; d < 3; d++) {
          if (ages[d]! < 0) continue;
          this.hopHits[d] = 1;
          this.lastOnset[d] = this.samples - ages[d]! * DRUM_TICK;
        }
      }
      if (++this.sinceHop === this.hop) {
        this.analyze();
        this.sinceHop = 0;
        this.hopPeak = 0;
        this.hopSquares = 0;
        onFrame(i + 1);
      }
    }
  }

  private analyze(): void {
    const size = this.fftSize;
    const mask = size - 1;
    const frame = this.frame;

    // Window the last fftSize samples (oldest first) and transform.
    for (let i = 0; i < size; i++) {
      this.windowed[i] = this.history[(this.writeIndex + i) & mask]! * this.hann[i]!;
    }
    this.fft.realTransform(this.complex, this.windowed);
    const bins = this.power.length;
    // Swap buffers: the last frame becomes "previous", the older buffer is overwritten.
    const previous = this.logMagnitude;
    const current = this.previousLogMagnitude;
    this.previousLogMagnitude = previous;
    this.logMagnitude = current;
    for (let k = 0; k < bins; k++) {
      const re = this.complex[2 * k]!;
      const im = this.complex[2 * k + 1]!;
      const power = (re * re + im * im) * this.powerScale;
      this.power[k] = power;
      current[k] = Math.log(power + 1e-9);
    }

    // Spectrum bands with auto-gain.
    let loudest = -Infinity;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const db = 10 * Math.log10(this.bandPower(this.bandLow[b]!, this.bandHigh[b]!) + 1e-12);
      const tilted = db + this.bandTilt[b]!;
      this.spectrumDb[b] = tilted;
      if (tilted > loudest) loudest = tilted;
    }
    this.spectrumReference = this.follow(this.spectrumReference, loudest);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      frame[F.spectrum + b] = normalize(this.spectrumDb[b]!, this.spectrumReference, 50);
    }

    // Energy bands and overall energy.
    let total = 0;
    for (let n = 0; n < this.energyBins.length; n++) {
      const list = this.energyBins[n]!;
      let sum = 0;
      for (let i = 0; i < list.length; i++) sum += this.power[list[i]!]!;
      total += sum;
      const db = 10 * Math.log10(sum + 1e-12);
      this.bandReference[n] = this.follow(this.bandReference[n]!, db);
      frame[F.bands + n] = normalize(db, this.bandReference[n]!, 30);
    }
    const totalDb = 10 * Math.log10(total + 1e-12);
    this.energyReference = this.follow(this.energyReference, totalDb);
    frame[F.energy] = normalize(totalDb, this.energyReference, 36);
    frame[F.rms] = Math.sqrt(this.hopSquares / this.hop);
    frame[F.peak] = this.hopPeak;

    // Drums: envelopes decay from the estimated onset time.
    for (let d = 0; d < 3; d++) {
      const onset = this.lastOnset[d]!;
      frame[F.kick + d] =
        onset < 0
          ? 0
          : Math.exp(-(this.samples - onset) / (DRUM_DECAY_SECONDS[d]! * this.sampleRate));
      frame[F.kickHit + d] = this.hopHits[d]!;
      this.hopHits[d] = 0;
    }

    // Beat: spectral flux (mean rise in dB over all bins) drives the tracker.
    let flux = 0;
    for (let k = this.fluxFirstBin; k <= this.fluxLastBin; k++) {
      const rise = current[k]! - previous[k]!;
      if (rise > 0) flux += rise;
    }
    flux *= 10 / Math.LN10 / (this.fluxLastBin - this.fluxFirstBin + 1);
    const beat = this.beats.process(flux, this.hopAccent, frame[F.rms]! > SILENCE_RMS);
    this.hopAccent = 0;
    this.sinceBeat = beat ? 0 : this.sinceBeat + 1;
    frame[F.beatHit] = beat ? 1 : 0;
    frame[F.beat] = Math.exp(-(this.sinceBeat * this.hop) / (BEAT_DECAY * this.sampleRate));
    frame[F.beatPhase] = this.beats.phase;
    frame[F.bpm] = this.beats.bpm;
    frame[F.beatConfidence] = this.beats.confidence;

    // Oscilloscope snapshot: the last WAVEFORM_POINTS × 8 samples, every 8th sample.
    const stride = 8;
    const start = this.writeIndex - WAVEFORM_POINTS * stride;
    for (let i = 0; i < WAVEFORM_POINTS; i++) {
      frame[F.waveform + i] = this.history[(start + i * stride) & mask]!;
    }
  }

  /** Mean power between two fractional bin positions (interpolated for narrow bands). */
  private bandPower(low: number, high: number): number {
    const first = Math.ceil(low);
    const last = Math.floor(high);
    if (last >= first) {
      let sum = 0;
      for (let k = first; k <= last; k++) sum += this.power[k]!;
      return sum / (last - first + 1);
    }
    const center = (low + high) / 2;
    const k = Math.floor(center);
    const t = center - k;
    return this.power[k]! * (1 - t) + this.power[k + 1]! * t;
  }

  /** Auto-gain reference: jumps up to louder levels, falls slowly when it gets quieter. */
  private follow(reference: number, level: number): number {
    const next = level > reference ? level : reference - this.releasePerHop;
    return Math.max(FLOOR_DB, next);
  }
}

function normalize(db: number, reference: number, range: number): number {
  const value = (db - (reference - range)) / range;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
