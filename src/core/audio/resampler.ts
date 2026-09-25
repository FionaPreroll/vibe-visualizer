/**
 * Streaming sample-rate converter: Kaiser-windowed sinc, polyphase table with linear
 * interpolation between phases. Converts decoded files to the engine rate (48 kHz).
 *
 * Positions are tracked as exact integer fractions (e.g. 44100/48000 = 147/160), so the output
 * is bit-identical no matter how the input is chunked, and does not drift over hours. Allocates
 * per call: it belongs in a worker, not in the AudioWorklet.
 */

export interface ResamplerOptions {
  /** Kernel half width in output-rate samples (default 32 → 64 taps when upsampling). */
  halfWidth?: number;
  /** Sub-sample resolution of the coefficient table (default 512). */
  phases?: number;
  /** Cutoff as a fraction of the lower Nyquist frequency (default 0.92). */
  cutoff?: number;
  /** Kaiser window beta (default 8.6, about 90 dB stopband). */
  beta?: number;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Resampler {
  readonly channels: number;
  readonly inputRate: number;
  readonly outputRate: number;
  /** Kernel half width in input frames. */
  readonly halfWidth: number;
  private readonly num: number;
  private readonly den: number;
  private readonly taps: number;
  private readonly phases: number;
  private readonly table: Float64Array;
  private buffers: Float64Array[];
  private buffered = 0;
  /** Absolute input frame held in buffers[c][0]; negative while leading zeros are buffered. */
  private bufferStart = 0;
  /** Absolute index of the next output frame. */
  private nextOutput = 0;

  constructor(
    channels: number,
    inputRate: number,
    outputRate: number,
    options: ResamplerOptions = {},
  ) {
    this.channels = channels;
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    const divisor = gcd(inputRate, outputRate);
    this.num = inputRate / divisor;
    this.den = outputRate / divisor;
    const scale = Math.max(1, inputRate / outputRate);
    this.halfWidth = Math.ceil((options.halfWidth ?? 32) * scale);
    this.taps = this.halfWidth * 2;
    this.phases = options.phases ?? 512;
    // Cutoff in cycles per input frame, below the lower of the two Nyquist frequencies.
    const cutoff = (0.5 * (options.cutoff ?? 0.92)) / scale;
    const beta = options.beta ?? 8.6;
    const i0Beta = besselI0(beta);

    // table[phase * taps + j] = h(j - (halfWidth - 1) - phase / phases)
    this.table = new Float64Array((this.phases + 1) * this.taps);
    for (let phase = 0; phase <= this.phases; phase++) {
      const offset = phase / this.phases;
      let sum = 0;
      for (let j = 0; j < this.taps; j++) {
        const x = j - (this.halfWidth - 1) - offset;
        const r = x / this.halfWidth;
        const window = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0Beta;
        const arg = 2 * cutoff * x;
        const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
        const value = 2 * cutoff * sinc * window;
        this.table[phase * this.taps + j] = value;
        sum += value;
      }
      // Unity gain at DC for every phase.
      for (let j = 0; j < this.taps; j++) this.table[phase * this.taps + j]! /= sum;
    }
    this.buffers = Array.from({ length: channels }, () => new Float64Array(8192));
    this.reset(0);
  }

  /**
   * Restarts the stream so that the next output frame is `outputFrame` (in output-rate frames
   * from the start of the file). Returns the input frame to feed from; silence before the start
   * of the file is inserted automatically.
   */
  reset(outputFrame: number): number {
    this.nextOutput = outputFrame;
    const first = this.inputIndex(outputFrame) - (this.halfWidth - 1);
    const zeros = Math.max(0, -first);
    this.ensureCapacity(zeros);
    for (const buffer of this.buffers) buffer.fill(0, 0, zeros);
    this.buffered = zeros;
    this.bufferStart = first;
    return first + zeros;
  }

  /** Appends `frames` silent input frames. */
  pushZeros(frames: number): Float32Array[] {
    const silence = Array.from({ length: this.channels }, () => new Float32Array(frames));
    return this.push(silence, frames);
  }

  /** Appends input and returns every output frame that can be computed so far. */
  push(input: readonly Float32Array[], frames: number): Float32Array[] {
    this.ensureCapacity(this.buffered + frames);
    for (let c = 0; c < this.channels; c++) {
      const source = input[c] ?? input[0]!;
      const buffer = this.buffers[c]!;
      for (let i = 0; i < frames; i++) buffer[this.buffered + i] = source[i]!;
    }
    this.buffered += frames;
    return this.drain();
  }

  /** Feeds trailing silence so that the output covers all input fed so far. */
  flush(): Float32Array[] {
    return this.pushZeros(this.halfWidth);
  }

  /** Integer part of the input position of output frame `n` (exact for n < 2^53 / num). */
  private inputIndex(n: number): number {
    const scaled = n * this.num;
    return (scaled - (scaled % this.den)) / this.den;
  }

  private ensureCapacity(frames: number): void {
    if (frames <= this.buffers[0]!.length) return;
    const size = 2 ** Math.ceil(Math.log2(frames));
    this.buffers = this.buffers.map((old) => {
      const grown = new Float64Array(size);
      grown.set(old.subarray(0, this.buffered));
      return grown;
    });
  }

  private drain(): Float32Array[] {
    const { taps, phases, table, halfWidth } = this;
    // Output frame n needs input frames index(n) - (halfWidth - 1) … index(n) + halfWidth.
    let frames = 0;
    while (
      this.inputIndex(this.nextOutput + frames) - this.bufferStart + halfWidth <
      this.buffered
    ) {
      frames++;
    }
    const output = Array.from({ length: this.channels }, () => new Float32Array(frames));

    for (let n = 0; n < frames; n++) {
      const scaled = (this.nextOutput + n) * this.num;
      const remainder = scaled % this.den;
      const start = (scaled - remainder) / this.den - this.bufferStart - (halfWidth - 1);
      const phase = (remainder / this.den) * phases;
      const p0 = Math.floor(phase);
      const a = phase - p0;
      const row0 = p0 * taps;
      const row1 = row0 + taps;
      for (let c = 0; c < this.channels; c++) {
        const buffer = this.buffers[c]!;
        let sum = 0;
        for (let j = 0; j < taps; j++) {
          const coefficient = table[row0 + j]! + a * (table[row1 + j]! - table[row0 + j]!);
          sum += coefficient * buffer[start + j]!;
        }
        output[c]![n] = sum;
      }
    }
    this.nextOutput += frames;

    // Keep only the input that future output frames still need.
    const keepFrom = Math.min(
      this.buffered,
      this.inputIndex(this.nextOutput) - (halfWidth - 1) - this.bufferStart,
    );
    if (keepFrom > 0) {
      for (const buffer of this.buffers) buffer.copyWithin(0, keepFrom, this.buffered);
      this.buffered -= keepFrom;
      this.bufferStart += keepFrom;
    }
    return output;
  }
}
