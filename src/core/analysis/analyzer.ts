import FFT from 'fft.js';
import { BAND_NAMES, BAND_RANGES, F, SPECTRUM_BANDS, WAVEFORM_POINTS } from './features';

/**
 * Turns an audio stream into analysis frames at a fixed hop (default every 512 samples, about
 * 94 frames per second at 48 kHz). The frame rate does not depend on the display, so live view
 * and offline export see the same values. Allocation-free after construction: safe to run in
 * the AudioWorklet.
 */

export interface AnalyzerOptions {
  fftSize?: number;
  hop?: number;
}

const MIN_HZ = 30;
const MAX_HZ = 16000;
/** Spectrum tilt so that highs are not dwarfed by the bass (like a pink-noise reference). */
const TILT_DB_PER_OCTAVE = 3;
/** Auto-gain: references follow peaks instantly and fall back slowly (dB per second). */
const RELEASE_DB_PER_SECOND = 3;
const FLOOR_DB = -70;

interface OnsetDetector {
  bins: Int32Array;
  /**
   * A hit also needs the region's power to rise by at least this fraction of its recent peak.
   * This rejects relative jumps at low levels, e.g. hi-hat noise leaking into the kick band.
   */
  minRise: number;
  peakDb: number;
  previousPower: number;
  /** Frames to wait after a hit. */
  refractory: number;
  /** Envelope decay per hop. */
  decay: number;
  sensitivity: number;
  mean: number;
  deviation: number;
  sinceHit: number;
  envelope: number;
}

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
  private readonly onsets: OnsetDetector[];

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

    const hopSeconds = this.hop / sampleRate;
    this.releasePerHop = RELEASE_DB_PER_SECOND * hopSeconds;
    const detector = (
      ranges: (readonly [number, number])[],
      refractorySeconds: number,
      decaySeconds: number,
      sensitivity: number,
      minRise: number,
    ): OnsetDetector => ({
      bins: binsIn(ranges),
      minRise,
      peakDb: FLOOR_DB,
      previousPower: 0,
      refractory: Math.round(refractorySeconds / hopSeconds),
      decay: Math.exp(-hopSeconds / decaySeconds),
      sensitivity,
      mean: 0,
      deviation: 0,
      sinceHit: 1e9,
      envelope: 0,
    });
    // Thresholds tuned on the test signal (kick 20/20, snare 10/10, hi-hat 39/40 in 10 s).
    this.onsets = [
      detector([[40, 120]], 0.12, 0.12, 1.6, 0.03),
      detector([[1000, 5000]], 0.1, 0.1, 1.8, 0.08),
      detector([[7000, 16000]], 0.06, 0.06, 1.8, 0.005),
    ];
  }

  reset(): void {
    this.history.fill(0);
    this.writeIndex = 0;
    this.sinceHop = 0;
    this.hopPeak = 0;
    this.hopSquares = 0;
    this.previousLogMagnitude.fill(0);
    this.frame.fill(0);
    for (const onset of this.onsets) {
      onset.mean = 0;
      onset.deviation = 0;
      onset.sinceHit = 1e9;
      onset.envelope = 0;
      onset.peakDb = FLOOR_DB;
      onset.previousPower = 0;
    }
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
      current[k] = Math.log(power + 1e-12);
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

    // Onsets: spectral flux against an adaptive threshold.
    for (let n = 0; n < this.onsets.length; n++) {
      const onset = this.onsets[n]!;
      let flux = 0;
      let power = 0;
      for (let i = 0; i < onset.bins.length; i++) {
        const k = onset.bins[i]!;
        const rise = current[k]! - previous[k]!;
        if (rise > 0) flux += rise;
        power += this.power[k]!;
      }
      flux /= Math.max(1, onset.bins.length);
      onset.peakDb = this.follow(onset.peakDb, 10 * Math.log10(power + 1e-12));
      const rise = power - onset.previousPower;
      onset.previousPower = power;
      const threshold = onset.mean + onset.sensitivity * onset.deviation + 0.3;
      const hit =
        flux > threshold &&
        rise > onset.minRise * 10 ** (onset.peakDb / 10) &&
        onset.sinceHit >= onset.refractory;
      onset.mean += 0.05 * (flux - onset.mean);
      onset.deviation += 0.05 * (Math.abs(flux - onset.mean) - onset.deviation);
      onset.sinceHit = hit ? 0 : onset.sinceHit + 1;
      onset.envelope = hit ? 1 : onset.envelope * onset.decay;
      frame[F.kick + n] = onset.envelope;
      frame[F.kickHit + n] = hit ? 1 : 0;
    }

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
