/**
 * Safety limiter (FX-04): keeps the output below the ceiling, e.g. when delay feedback or a
 * resonant filter push the level up. It looks ahead, so it turns the gain down smoothly before
 * a peak instead of clipping it, and releases slowly afterwards. Its look-ahead delays the
 * output by {@link LIMITER_LOOKAHEAD} frames. Allocation-free after construction.
 */

/** Look-ahead in frames (2 ms at 48 kHz). */
export const LIMITER_LOOKAHEAD = 96;
/** Highest output level (−0.26 dBFS). */
export const LIMITER_CEILING = Math.fround(0.97);
const RELEASE_SECONDS = 0.1;

export class Limiter {
  private readonly delay: Float32Array[];
  /** Gain each sample needs, for the sliding minimum over the look-ahead window. */
  private readonly needed: Float64Array;
  /** Monotonic queue of frame indices (the sliding minimum); doubles stay exact for years. */
  private readonly queue: Float64Array;
  private queueHead = 0;
  private queueTail = 0;
  /** Running sum of the window minima over the last {@link LIMITER_LOOKAHEAD} frames. */
  private readonly minima: Float64Array;
  private minimaSum: number;
  private index = 0;
  private gain = 1;
  private readonly release: number;

  constructor(sampleRate: number) {
    const size = LIMITER_LOOKAHEAD + 1;
    this.delay = [new Float32Array(LIMITER_LOOKAHEAD), new Float32Array(LIMITER_LOOKAHEAD)];
    this.needed = new Float64Array(size).fill(1);
    this.queue = new Float64Array(size + 1);
    this.minima = new Float64Array(LIMITER_LOOKAHEAD).fill(1);
    this.minimaSum = LIMITER_LOOKAHEAD;
    this.release = 1 - Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
  }

  /** The gain applied to the last frame (1 = untouched). */
  get currentGain(): number {
    return this.gain;
  }

  /** Limits two planes in place (delayed by the look-ahead). */
  process(planes: readonly Float32Array[], frames: number): void {
    const left = planes[0]!;
    const right = planes[1]!;
    const size = LIMITER_LOOKAHEAD + 1;
    const delayLeft = this.delay[0]!;
    const delayRight = this.delay[1]!;
    const needed = this.needed;
    const queue = this.queue;
    const queueSize = queue.length;
    for (let i = 0; i < frames; i++) {
      const index = this.index;
      const x0 = left[i]!;
      const x1 = right[i]!;
      // The frame from LIMITER_LOOKAHEAD frames ago is output now.
      const delaySlot = index % LIMITER_LOOKAHEAD;
      const out0 = delayLeft[delaySlot]!;
      const out1 = delayRight[delaySlot]!;
      delayLeft[delaySlot] = x0;
      delayRight[delaySlot] = x1;
      const level = Math.max(Math.abs(x0), Math.abs(x1));
      const need = level > LIMITER_CEILING ? LIMITER_CEILING / level : 1;
      needed[index % size] = need;
      // Sliding minimum over the window: the frame output now up to the newest one.
      while (this.queueTail !== this.queueHead) {
        const last = queue[(this.queueTail - 1 + queueSize) % queueSize]!;
        if (needed[last % size]! > need)
          this.queueTail = (this.queueTail - 1 + queueSize) % queueSize;
        else break;
      }
      queue[this.queueTail] = index;
      this.queueTail = (this.queueTail + 1) % queueSize;
      while (queue[this.queueHead]! <= index - size)
        this.queueHead = (this.queueHead + 1) % queueSize;
      const windowMinimum = needed[queue[this.queueHead]! % size]!;
      // Averaging the minima ramps the gain down over the look-ahead, so it reaches every
      // peak's gain by the time the peak is output; the release is slower.
      const minimaSlot = index % LIMITER_LOOKAHEAD;
      this.minimaSum += windowMinimum - this.minima[minimaSlot]!;
      this.minima[minimaSlot] = windowMinimum;
      const attack = this.minimaSum / LIMITER_LOOKAHEAD;
      this.gain = attack < this.gain ? attack : this.gain + (attack - this.gain) * this.release;
      const gain = this.gain;
      let y0 = out0 * gain;
      let y1 = out1 * gain;
      // Rounding must never let a sample through above the ceiling.
      if (y0 > LIMITER_CEILING) y0 = LIMITER_CEILING;
      else if (y0 < -LIMITER_CEILING) y0 = -LIMITER_CEILING;
      if (y1 > LIMITER_CEILING) y1 = LIMITER_CEILING;
      else if (y1 < -LIMITER_CEILING) y1 = -LIMITER_CEILING;
      left[i] = y0;
      right[i] = y1;
      this.index = index + 1;
    }
  }
}
