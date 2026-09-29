/**
 * Waveform of a whole track (TR-03, TR-08): per bucket of a few milliseconds, the peak level
 * and the energy of the lows, mids and highs, one byte each. The timeline draws the overview
 * from it, the detail view the part around the playhead; the colours come from the bands
 * (lows red, mids green, highs blue), as on DJ software.
 */

/** Buckets per second of the waveform. */
export const WAVEFORM_RATE = 200;
/** Bytes per bucket: peak, low, mid, high. */
export const WAVEFORM_STRIDE = 4;
/** Crossover frequencies of the three bands (Hz). */
const LOW_MID_HZ = 250;
const MID_HIGH_HZ = 4000;

export interface Waveform {
  /** Buckets per second. */
  rate: number;
  /** Buckets computed so far (the whole track once complete). */
  length: number;
  /** {@link WAVEFORM_STRIDE} bytes per bucket: peak, low, mid, high, each 0…255. */
  data: Uint8Array;
}

/** Level (0…1) to a byte: the square root keeps quiet parts visible. */
function toByte(level: number): number {
  return Math.round(255 * Math.sqrt(Math.min(1, level)));
}

/** A byte back to a level of 0…1 on the display scale (linear in the byte). */
export function fromByte(value: number): number {
  return value / 255;
}

/**
 * Builds a waveform from audio fed in blocks of any size. Bands come from one-pole crossovers
 * (cheap, and good enough to colour a waveform).
 */
export class WaveformBuilder {
  private readonly samplesPerBucket: number;
  private data: Uint8Array;
  private length = 0;
  private count = 0;
  private peak = 0;
  private low = 0;
  private mid = 0;
  private high = 0;
  private lowState = 0;
  private highState = 0;
  private readonly lowCoefficient: number;
  private readonly highCoefficient: number;

  constructor(
    private readonly sampleRate: number,
    expectedSeconds = 60,
  ) {
    this.samplesPerBucket = sampleRate / WAVEFORM_RATE;
    this.data = new Uint8Array(Math.ceil(expectedSeconds * WAVEFORM_RATE + 1) * WAVEFORM_STRIDE);
    this.lowCoefficient = 1 - Math.exp((-2 * Math.PI * LOW_MID_HZ) / sampleRate);
    this.highCoefficient = 1 - Math.exp((-2 * Math.PI * MID_HIGH_HZ) / sampleRate);
  }

  /** Adds `frames` samples of one or two planes. */
  add(left: Float32Array, right: Float32Array, frames: number): void {
    for (let i = 0; i < frames; i++) {
      const l = left[i]!;
      const r = right[i]!;
      const level = Math.max(Math.abs(l), Math.abs(r));
      if (level > this.peak) this.peak = level;
      const mono = 0.5 * (l + r);
      this.lowState += (mono - this.lowState) * this.lowCoefficient;
      this.highState += (mono - this.highState) * this.highCoefficient;
      const low = this.lowState;
      const high = mono - this.highState;
      const mid = this.highState - this.lowState;
      this.low += low * low;
      this.mid += mid * mid;
      this.high += high * high;
      if (++this.count >= this.samplesPerBucket) this.endBucket();
    }
  }

  /** The waveform so far (a view of the buffer: copy it before adding more). */
  get waveform(): Waveform {
    return {
      rate: WAVEFORM_RATE,
      length: this.length,
      data: this.data.subarray(0, this.length * WAVEFORM_STRIDE),
    };
  }

  /** Finishes the last, partial bucket. */
  finish(): Waveform {
    if (this.count > 0) this.endBucket();
    return this.waveform;
  }

  private endBucket(): void {
    const at = this.length * WAVEFORM_STRIDE;
    if (at + WAVEFORM_STRIDE > this.data.length) {
      const grown = new Uint8Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const n = this.count;
    // RMS × √2: a full-scale sine reaches 1.
    this.data[at] = toByte(this.peak);
    this.data[at + 1] = toByte(Math.sqrt((2 * this.low) / n));
    this.data[at + 2] = toByte(Math.sqrt((2 * this.mid) / n));
    this.data[at + 3] = toByte(Math.sqrt((2 * this.high) / n));
    this.length++;
    this.count = 0;
    this.peak = 0;
    this.low = 0;
    this.mid = 0;
    this.high = 0;
  }
}

/** The bucket range [first, last) for the time range [from, to) seconds. */
export function bucketRange(waveform: Waveform, from: number, to: number): [number, number] {
  const first = Math.max(0, Math.floor(from * waveform.rate));
  const last = Math.min(waveform.length, Math.ceil(to * waveform.rate));
  return [first, Math.max(first, last)];
}

/**
 * The largest peak and the band levels (the mean of the buckets) for the time range
 * [from, to) seconds, written into `out` as peak, low, mid, high (0…1). False if there are no
 * buckets there yet.
 */
export function summarise(
  waveform: Waveform,
  from: number,
  to: number,
  out: Float32Array,
): boolean {
  const [first, last] = bucketRange(waveform, from, to);
  if (last <= first) return false;
  const data = waveform.data;
  let peak = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  for (let b = first; b < last; b++) {
    const at = b * WAVEFORM_STRIDE;
    if (data[at]! > peak) peak = data[at]!;
    low += data[at + 1]!;
    mid += data[at + 2]!;
    high += data[at + 3]!;
  }
  const n = last - first;
  out[0] = fromByte(peak);
  out[1] = fromByte(low / n);
  out[2] = fromByte(mid / n);
  out[3] = fromByte(high / n);
  return true;
}
