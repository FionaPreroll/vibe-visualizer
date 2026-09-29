import type { TempoSource } from './tempo';

/** Helpers for the DSP tests. */

export const RATE = 48000;

export function sine(
  frequency: number,
  frames: number,
  amplitude = 0.5,
  rate = RATE,
): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate),
  );
}

export function stereo(plane: Float32Array): Float32Array[] {
  return [plane, plane.slice()];
}

/** A source that plays planes, optionally only `limit` frames for now. */
export class ArraySource implements TempoSource {
  position = 0;
  limit: number;

  constructor(
    private readonly planes: readonly Float32Array[],
    limit = Infinity,
  ) {
    this.limit = limit;
  }

  get length(): number {
    return this.planes[0]!.length;
  }

  get ended(): boolean {
    return this.position >= this.length;
  }

  pull(planes: readonly Float32Array[], offset: number, frames: number): number {
    const count = Math.max(
      0,
      Math.min(frames, this.length - this.position, this.limit - this.position),
    );
    for (let c = 0; c < planes.length; c++) {
      planes[c]!.set(this.planes[c]!.subarray(this.position, this.position + count), offset);
    }
    this.position += count;
    return count;
  }
}

/** Runs `render` block by block and collects `frames` frames of its two-plane output. */
export function collect(
  frames: number,
  render: (block: Float32Array[], size: number) => void,
  blockSize = 128,
): Float32Array[] {
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const block = [new Float32Array(blockSize), new Float32Array(blockSize)];
  for (let done = 0; done < frames; done += blockSize) {
    const size = Math.min(blockSize, frames - done);
    render(block, size);
    out[0]!.set(block[0]!.subarray(0, size), done);
    out[1]!.set(block[1]!.subarray(0, size), done);
  }
  return out;
}

/** Level of `frequency` in `signal` (amplitude of a matching sine), by correlation. */
export function toneLevel(signal: Float32Array, frequency: number, rate = RATE): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < signal.length; i++) {
    const phase = (2 * Math.PI * frequency * i) / rate;
    re += signal[i]! * Math.cos(phase);
    im += signal[i]! * Math.sin(phase);
  }
  return (2 * Math.hypot(re, im)) / signal.length;
}

export function rms(signal: Float32Array, from = 0, to = signal.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += signal[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function peak(signal: Float32Array, from = 0, to = signal.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(signal[i]!));
  return max;
}

/** Largest jump between neighbouring samples (clicks show up as big jumps). */
export function maxStep(signal: Float32Array, from = 1, to = signal.length): number {
  let max = 0;
  for (let i = Math.max(1, from); i < to; i++)
    max = Math.max(max, Math.abs(signal[i]! - signal[i - 1]!));
  return max;
}

export function decibels(ratio: number): number {
  return 20 * Math.log10(ratio);
}
