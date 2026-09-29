import { besselI0 } from '../resampler';
import type { SignalsmithStretch } from '../stretch/signalsmith-stretch';
import type { TempoMode } from './sound-settings';

/**
 * Plays the source at a variable speed (TMP-01, TMP-02): "vinyl" resamples (the pitch follows the
 * speed), "key lock" time-stretches with Signalsmith Stretch (the pitch stays). It pulls source
 * frames as it needs them, so it works on the engine's ring buffer and on the export's decoder
 * alike. Allocation-free after construction: safe in the AudioWorklet.
 *
 * Positions count source frames from the start of the stream (a seek starts a new stream). Both
 * modes start exactly at frame 0 of a stream, so output frame n plays source frame n × rate.
 */

/** Where the tempo stage reads the source. */
export interface TempoSource {
  /** Copies up to `frames` source frames to `planes[c][offset…]` and returns how many. */
  pull(planes: readonly Float32Array[], offset: number, frames: number): number;
  /** True when no more frames will come: missing frames are then silence. */
  readonly ended: boolean;
}

/** Input frames on each side of the interpolation point, at speeds up to 1. */
const HALF_WIDTH = 16;
/** Table points per input frame. */
const TABLE_STEPS = 256;
const KAISER_BETA = 8;
/** Input kept in the queue: history, the stretcher's latency and look-ahead (frames). */
const CAPACITY = 32768;
/** Frames kept behind the heard position (mode switches and the stretcher's pre-roll need them). */
const HISTORY = 12288;
/** Largest pre-roll for priming the stretcher (frames). */
const PRE_ROLL_CAPACITY = 8192;
/** Fade before and after a mode switch, and at the start of a stream (frames). */
const FADE = 256;

/** One side of a Kaiser-windowed sinc: table[i] = h(i / TABLE_STEPS). */
function buildKernel(): Float32Array {
  const table = new Float32Array(HALF_WIDTH * TABLE_STEPS + 2);
  const norm = besselI0(KAISER_BETA);
  for (let i = 0; i < table.length; i++) {
    const x = i / TABLE_STEPS;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = x / HALF_WIDTH;
    const window = r >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / norm;
    table[i] = sinc * window;
  }
  return table;
}

const KERNEL = buildKernel();

export class TempoStage {
  /** Speed to play at (changes are ramped) and the mode (switches fade out and in). */
  rate = 1;
  mode: TempoMode = 'vinyl';
  /** Temporary speed change on top of the rate (TMP-03), e.g. 1.04 while nudging. */
  nudge = 1;
  /** True if the last block ran short of source frames after the stream had started. */
  underrun = false;

  private readonly queue: Float32Array[];
  private readonly preRoll: Float32Array[];
  /** Source frame held in queue[c][0], and how many frames follow it. */
  private queueStart = 0;
  private queueLength = 0;
  /** Vinyl: source position of the next output frame. Key lock before priming: where to start. */
  private position = 0;
  /** Key lock: the stretcher has been primed; the next source frame it takes; input carried over. */
  private primed = false;
  private readIndex = 0;
  private carry = 0;
  private currentRate = 1;
  private currentMode: TempoMode = 'vinyl';
  private gain = 0;
  private started = false;

  constructor(private readonly stretch: SignalsmithStretch | null) {
    this.queue = [new Float32Array(CAPACITY), new Float32Array(CAPACITY)];
    this.preRoll = [new Float32Array(PRE_ROLL_CAPACITY), new Float32Array(PRE_ROLL_CAPACITY)];
    stretch?.setMaxBlockFrames(PRE_ROLL_CAPACITY);
  }

  /** Source frame heard at the start of the next block. */
  get sourcePosition(): number {
    if (this.currentMode === 'vinyl' || !this.primed) return this.position;
    return Math.max(0, this.readIndex - this.latency(this.currentRate));
  }

  /** The speed of the last block, nudge included. */
  get playbackRate(): number {
    return this.currentRate;
  }

  /** Starts a new stream (a seek): nothing buffered, position 0, a short fade-in. */
  reset(): void {
    this.queueStart = 0;
    this.queueLength = 0;
    this.position = 0;
    this.primed = false;
    this.readIndex = 0;
    this.carry = 0;
    this.currentRate = this.rate * this.nudge;
    this.currentMode = this.wantedMode();
    this.gain = 0;
    this.started = false;
    this.underrun = false;
  }

  /** Renders `frames` frames into `output` (two planes), pulling source frames as needed. */
  process(source: TempoSource, output: readonly Float32Array[], frames: number): void {
    const mode = this.wantedMode();
    // A switch waits until the old mode has faded out.
    if (mode !== this.currentMode && this.gain <= 0) this.switchMode(mode);
    const complete =
      this.currentMode === 'keylock'
        ? this.renderKeyLock(source, output, frames)
        : this.renderVinyl(source, output, frames);
    this.underrun = !complete && this.started;
    if (complete) this.started = true;
    const target = mode === this.currentMode ? 1 : 0;
    if (this.gain !== target || target === 0) this.applyFade(output, frames, target);
  }

  private wantedMode(): TempoMode {
    return this.mode === 'keylock' && this.stretch ? 'keylock' : 'vinyl';
  }

  /** Continues at the same source position in the other mode. */
  private switchMode(mode: TempoMode): void {
    this.position = this.sourcePosition;
    this.currentMode = mode;
    this.primed = false;
  }

  private applyFade(output: readonly Float32Array[], frames: number, target: number): void {
    const left = output[0]!;
    const right = output[1]!;
    const step = 1 / FADE;
    let gain = this.gain;
    for (let i = 0; i < frames; i++) {
      gain = target > gain ? Math.min(target, gain + step) : Math.max(target, gain - step);
      left[i]! *= gain;
      right[i]! *= gain;
    }
    this.gain = gain;
  }

  /** Returns false if the source ran short. */
  private renderVinyl(source: TempoSource, output: readonly Float32Array[], frames: number) {
    const from = this.currentRate;
    const to = this.rate * this.nudge;
    const widest = Math.max(1, from, to);
    const reach = Math.ceil(HALF_WIDTH * widest) + 1;
    this.fill(source, Math.floor(this.position + frames * Math.max(from, to)) + reach);
    const left = this.queue[0]!;
    const right = this.queue[1]!;
    const available = this.queueStart + this.queueLength;
    const outLeft = output[0]!;
    const outRight = output[1]!;
    let i = 0;
    if (from === 1 && to === 1 && Number.isInteger(this.position)) {
      // Original speed on a whole frame: a plain copy.
      const at = this.position - this.queueStart;
      i = Math.max(0, Math.min(frames, available - this.position));
      for (let k = 0; k < i; k++) {
        outLeft[k] = at + k >= 0 ? left[at + k]! : 0;
        outRight[k] = at + k >= 0 ? right[at + k]! : 0;
      }
      this.position += i;
    } else {
      for (; i < frames; i++) {
        const rate = from + ((to - from) * i) / frames;
        // Faster than 1: widen the kernel, which lowers its cutoff (anti-aliasing).
        const scale = rate > 1 ? rate : 1;
        const center = this.position;
        const base = Math.floor(center);
        const span = Math.ceil(HALF_WIDTH * scale);
        if (base + span >= available) break; // not enough input yet
        let weights = 0;
        let sumLeft = 0;
        let sumRight = 0;
        for (let k = base - span + 1; k <= base + span; k++) {
          const x = Math.abs(k - center) / scale;
          if (x >= HALF_WIDTH) continue;
          const scaled = x * TABLE_STEPS;
          const index = scaled | 0;
          const weight = KERNEL[index]! + (KERNEL[index + 1]! - KERNEL[index]!) * (scaled - index);
          weights += weight;
          const at = k - this.queueStart;
          if (at >= 0) {
            sumLeft += weight * left[at]!;
            sumRight += weight * right[at]!;
          }
        }
        outLeft[i] = weights > 0 ? sumLeft / weights : 0;
        outRight[i] = weights > 0 ? sumRight / weights : 0;
        this.position += rate;
      }
    }
    outLeft.fill(0, i, frames);
    outRight.fill(0, i, frames);
    this.currentRate = i === frames ? to : from + ((to - from) * i) / frames;
    return i === frames;
  }

  /** Returns false if the source ran short (the output is then silent). */
  private renderKeyLock(source: TempoSource, output: readonly Float32Array[], frames: number) {
    const stretch = this.stretch!;
    const rate = this.rate * this.nudge;
    this.currentRate = rate;
    const wanted = Math.floor(this.carry + frames * rate);
    const start = this.primed ? this.readIndex : Math.round(this.position + this.latency(rate));
    this.fill(source, start + wanted - 1);
    if (start + wanted > this.queueStart + this.queueLength) {
      // Wait for the source instead of stretching silence into the music.
      output[0]!.fill(0, 0, frames);
      output[1]!.fill(0, 0, frames);
      return false;
    }
    if (!this.primed) this.prime(start, rate);
    this.carry += frames * rate - wanted;
    stretch.process(this.queue, this.readIndex - this.queueStart, wanted, output, frames);
    this.readIndex += wanted;
    return true;
  }

  /**
   * Feeds the stretcher the audio before `start`, so that its output begins right at
   * `start` − latency, which is the position to continue from.
   */
  private prime(start: number, rate: number): void {
    const stretch = this.stretch!;
    const length = Math.min(PRE_ROLL_CAPACITY, stretch.blockSamples + stretch.intervalSamples);
    for (let c = 0; c < 2; c++) {
      const plane = this.preRoll[c]!;
      const queue = this.queue[c]!;
      for (let i = 0; i < length; i++) {
        const at = start - length + i - this.queueStart;
        plane[i] = at >= 0 ? queue[at]! : 0; // before the stream starts: silence
      }
    }
    stretch.reset();
    stretch.seek(this.preRoll, 0, length, rate);
    this.readIndex = start;
    this.carry = 0;
    this.primed = true;
  }

  /** Frames between the newest input of the stretcher and what it outputs now (source frames). */
  private latency(rate: number): number {
    const stretch = this.stretch;
    return stretch ? stretch.inputLatency + stretch.outputLatency * rate : 0;
  }

  /**
   * Makes the queue reach source frame `last` (inclusive): drops old history, pulls from the
   * source, and pads with silence once the source has ended.
   */
  private fill(source: TempoSource, last: number): void {
    const end = this.queueStart + this.queueLength;
    const needed = last + 1 - end;
    if (needed <= 0) return;
    const keepFrom = Math.floor(this.sourcePosition) - HISTORY;
    const drop = Math.min(this.queueLength, Math.max(0, keepFrom - this.queueStart));
    if (drop > 0 && this.queueLength + needed > CAPACITY) {
      for (const plane of this.queue) plane.copyWithin(0, drop, this.queueLength);
      this.queueStart += drop;
      this.queueLength -= drop;
    }
    const count = Math.min(needed, CAPACITY - this.queueLength);
    const got = source.pull(this.queue, this.queueLength, count);
    this.queueLength += got;
    if (got < count && source.ended) {
      const silence = count - got;
      for (const plane of this.queue) plane.fill(0, this.queueLength, this.queueLength + silence);
      this.queueLength += silence;
    }
  }
}
