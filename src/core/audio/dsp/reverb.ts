import { dryGain, hasSignal, SILENCE, wetGain } from './dsp-util';

/**
 * Algorithmic reverb (FX-01): pre-delay, input diffusion and an 8-line feedback delay network
 * with a Householder matrix, slowly modulated lines against metallic ringing, and damping of
 * the highs in the tail. Stereo comes from different sign patterns on the output. Parameter
 * changes glide, and switching it off lets the tail ring out (FX-03). Allocation-free after
 * construction.
 */

export interface ReverbParameters {
  on: boolean;
  /** Room size, 0…1. */
  size: number;
  /** Decay time (RT60) in seconds. */
  decay: number;
  /** Pre-delay in seconds. */
  preDelay: number;
  /** Damping of the highs in the tail, 0…1. */
  damping: number;
  /** 0 dry … 1 wet. */
  mix: number;
}

const LINES = 8;
/** Line lengths at 48 kHz for size 0.5 (frames); scaled by 0.4…2 with the size. */
const BASE_LENGTHS = [1215, 1293, 1390, 1476, 1548, 1623, 1695, 1760];
const INPUT_SIGNS = [1, -1, 1, 1, -1, 1, -1, -1];
const LEFT_SIGNS = [1, -1, 1, -1, 1, -1, 1, -1];
const RIGHT_SIGNS = [1, 1, -1, -1, 1, 1, -1, -1];
/** Input diffusers at 48 kHz (Dattorro's lengths and gains). */
const DIFFUSER_LENGTHS = [229, 173, 611, 447];
const DIFFUSER_GAINS = [0.75, 0.75, 0.625, 0.625];
/** Longest pre-delay (seconds). */
const MAX_PRE_DELAY = 0.2;
/** Modulation depth (frames) and rates (Hz). */
const MOD_DEPTH = 3;
const MOD_RATES = [0.31, 0.43, 0.37, 0.53, 0.47, 0.61, 0.41, 0.57];
const SMOOTHING = 0.05;
/** Size changes glide slower, like a tape machine changing speed. */
const SIZE_SMOOTHING = 0.25;
const OUTPUT_GAIN = 0.8;

function sizeScale(size: number): number {
  return 0.4 + 1.6 * size;
}

export class FdnReverb {
  readonly parameters: ReverbParameters = {
    on: false,
    size: 0.6,
    decay: 2.5,
    preDelay: 0.02,
    damping: 0.5,
    mix: 0.25,
  };

  private readonly scaleRate: number;
  private readonly lines: Float64Array[];
  private readonly lengths = new Float64Array(LINES);
  private readonly gains = new Float64Array(LINES);
  private readonly damped = new Float64Array(LINES);
  private readonly outputs = new Float64Array(LINES);
  private readonly lfoCos = new Float64Array(LINES);
  private readonly lfoSin = new Float64Array(LINES);
  private readonly lfoStepCos = new Float64Array(LINES);
  private readonly lfoStepSin = new Float64Array(LINES);
  private readonly lineSize: number;
  private readonly preDelayLine: Float64Array;
  private readonly diffusers: Float64Array[];
  private readonly diffuserLengths: number[];
  private readonly diffuserPositions = new Int32Array(4);
  private readonly smoothing: number;
  private readonly sizeSmoothing: number;
  private write = 0;
  private preDelayWrite = 0;
  private scale = 1;
  private decay = 2.5;
  private damping = 0.5;
  private preDelayFrames = 0;
  private input = 0;
  private dry = 1;
  private wet = 0;
  private quietFrames = 0;
  private idle = true;

  constructor(private readonly sampleRate: number) {
    this.scaleRate = sampleRate / 48000;
    const longest = Math.max(...BASE_LENGTHS) * this.scaleRate * sizeScale(1) + 2 * MOD_DEPTH + 2;
    this.lineSize = 2 ** Math.ceil(Math.log2(longest));
    this.lines = Array.from({ length: LINES }, () => new Float64Array(this.lineSize));
    this.preDelayLine = new Float64Array(2 ** Math.ceil(Math.log2(MAX_PRE_DELAY * sampleRate + 2)));
    this.diffuserLengths = DIFFUSER_LENGTHS.map((length) =>
      Math.max(1, Math.round(length * this.scaleRate)),
    );
    this.diffusers = this.diffuserLengths.map((length) => new Float64Array(length));
    this.smoothing = 1 - Math.exp(-1 / (SMOOTHING * sampleRate));
    this.sizeSmoothing = 1 - Math.exp(-1 / (SIZE_SMOOTHING * sampleRate));
    for (let i = 0; i < LINES; i++) {
      const step = (2 * Math.PI * MOD_RATES[i]!) / sampleRate;
      this.lfoStepCos[i] = Math.cos(step);
      this.lfoStepSin[i] = Math.sin(step);
    }
    this.snap();
    this.clear();
  }

  /** Jumps to the current parameters without gliding (the start of an export). */
  snap(): void {
    const p = this.parameters;
    this.scale = sizeScale(p.size);
    this.decay = p.decay;
    this.damping = p.damping;
    this.preDelayFrames = this.preDelayTarget();
    this.input = p.on ? 1 : 0;
    this.dry = p.on ? dryGain(p.mix) : 1;
    this.wet = wetGain(p.mix);
  }

  /** True while the reverb is on or its tail is still ringing. */
  get active(): boolean {
    return !this.idle;
  }

  /** Adds the reverb to two planes in place. */
  process(planes: readonly Float32Array[], frames: number): void {
    const p = this.parameters;
    const left = planes[0]!;
    const right = planes[1]!;
    if (this.idle) {
      if (!p.on || !hasSignal(left, right, frames)) return;
      this.clear();
      this.snap();
      this.idle = false;
      this.quietFrames = 0;
    }
    const s = this.smoothing;
    const sizeTarget = sizeScale(p.size);
    const inputTarget = p.on ? 1 : 0;
    const dryTarget = p.on ? dryGain(p.mix) : 1;
    const wetTarget = wetGain(p.mix);
    const preDelayTarget = this.preDelayTarget();
    // Decay, damping and line lengths change slowly: once per block is smooth enough.
    this.scale += (sizeTarget - this.scale) * (1 - (1 - this.sizeSmoothing) ** frames);
    this.decay += (p.decay - this.decay) * (1 - (1 - s) ** frames);
    this.damping += (p.damping - this.damping) * (1 - (1 - s) ** frames);
    const rt60Frames = Math.max(0.05, this.decay) * this.sampleRate;
    let gainSum = 0;
    for (let i = 0; i < LINES; i++) {
      const length = BASE_LENGTHS[i]! * this.scaleRate * this.scale;
      this.lengths[i] = length;
      const gain = 10 ** ((-3 * length) / rt60Frames);
      this.gains[i] = gain;
      gainSum += gain * gain;
    }
    // The tail's energy grows with g² / (1 − g²): scale the input so that short and long
    // decays sound about equally loud.
    const meanSquare = gainSum / LINES;
    const normalise = Math.min(4, Math.sqrt(Math.max(0.02, 1 - meanSquare) / meanSquare));
    const smoothing = 1 - 0.85 * this.damping; // one-pole low-pass in every line
    const lineMask = this.lineSize - 1;
    const preMask = this.preDelayLine.length - 1;
    const lines = this.lines;
    const outputs = this.outputs;
    let peak = 0;
    let inputPeak = 0;
    for (let n = 0; n < frames; n++) {
      this.input += (inputTarget - this.input) * s;
      this.dry += (dryTarget - this.dry) * s;
      this.wet += (wetTarget - this.wet) * s;
      this.preDelayFrames += (preDelayTarget - this.preDelayFrames) * s;
      const dryLeft = left[n]!;
      const dryRight = right[n]!;
      const mono = 0.5 * (dryLeft + dryRight);
      const level = Math.abs(mono);
      if (level > inputPeak) inputPeak = level;

      // Pre-delay (fractional read, so changes glide).
      this.preDelayLine[this.preDelayWrite] = mono * this.input;
      const delayed = readFractional(
        this.preDelayLine,
        this.preDelayWrite - this.preDelayFrames,
        preMask,
      );
      this.preDelayWrite = (this.preDelayWrite + 1) & preMask;

      // Input diffusion: four all-passes smear the attack into a dense start.
      let diffused = delayed;
      for (let d = 0; d < 4; d++) {
        const buffer = this.diffusers[d]!;
        const position = this.diffuserPositions[d]!;
        const gain = DIFFUSER_GAINS[d]!;
        const stored = buffer[position]!;
        const out = stored - gain * diffused;
        buffer[position] = diffused + gain * out;
        this.diffuserPositions[d] = position + 1 === buffer.length ? 0 : position + 1;
        diffused = out;
      }
      diffused *= normalise;

      // Read the lines (modulated), damp and scale them, then mix through the Householder
      // matrix (I − 2/N · 11ᵀ): lossless, so the decay comes from the gains alone.
      let sum = 0;
      for (let i = 0; i < LINES; i++) {
        const c = this.lfoCos[i]!;
        const sn = this.lfoSin[i]!;
        this.lfoCos[i] = c * this.lfoStepCos[i]! - sn * this.lfoStepSin[i]!;
        this.lfoSin[i] = sn * this.lfoStepCos[i]! + c * this.lfoStepSin[i]!;
        const out = readFractional(
          lines[i]!,
          this.write - this.lengths[i]! - MOD_DEPTH * (1 + sn),
          lineMask,
        );
        const damped = this.damped[i]! + (out - this.damped[i]!) * smoothing;
        this.damped[i] = damped;
        const value = damped * this.gains[i]!;
        outputs[i] = value;
        sum += value;
      }
      const mix = (2 / LINES) * sum;
      let wetLeft = 0;
      let wetRight = 0;
      for (let i = 0; i < LINES; i++) {
        const value = outputs[i]!;
        lines[i]![this.write] = value - mix + diffused * INPUT_SIGNS[i]!;
        wetLeft += value * LEFT_SIGNS[i]!;
        wetRight += value * RIGHT_SIGNS[i]!;
      }
      this.write = (this.write + 1) & lineMask;
      wetLeft *= OUTPUT_GAIN;
      wetRight *= OUTPUT_GAIN;
      left[n] = this.dry * dryLeft + this.wet * wetLeft;
      right[n] = this.dry * dryRight + this.wet * wetRight;
      const tail = Math.max(Math.abs(wetLeft), Math.abs(wetRight));
      if (tail > peak) peak = tail;
    }
    this.renormaliseLfos();
    // Silent in and out (switched off, or paused): go idle once the tail has gone.
    if ((p.on ? inputPeak < SILENCE : this.input < 1e-4) && peak < SILENCE) {
      this.quietFrames += frames;
      if (this.quietFrames > this.preDelayFrames + this.lineSize) this.idle = true;
    } else {
      this.quietFrames = 0;
    }
  }

  private preDelayTarget(): number {
    const seconds = Math.min(MAX_PRE_DELAY, Math.max(0, this.parameters.preDelay));
    return seconds * this.sampleRate;
  }

  private clear(): void {
    for (const line of this.lines) line.fill(0);
    for (const diffuser of this.diffusers) diffuser.fill(0);
    this.preDelayLine.fill(0);
    this.damped.fill(0);
    for (let i = 0; i < LINES; i++) {
      // Different start phases, so the lines never move together.
      const phase = (2 * Math.PI * i) / LINES;
      this.lfoCos[i] = Math.cos(phase);
      this.lfoSin[i] = Math.sin(phase);
    }
  }

  /** Keeps the rotating oscillators on the unit circle despite rounding. */
  private renormaliseLfos(): void {
    for (let i = 0; i < LINES; i++) {
      const c = this.lfoCos[i]!;
      const sn = this.lfoSin[i]!;
      const norm = 1 / Math.sqrt(c * c + sn * sn);
      this.lfoCos[i] = c * norm;
      this.lfoSin[i] = sn * norm;
    }
  }
}

/** Linear interpolation in a power-of-two ring. */
function readFractional(buffer: Float64Array, position: number, mask: number): number {
  const index = Math.floor(position);
  const fraction = position - index;
  const a = buffer[index & mask]!;
  const b = buffer[(index + 1) & mask]!;
  return a + (b - a) * fraction;
}
