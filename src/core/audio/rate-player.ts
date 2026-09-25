import type { SignalsmithStretch } from './stretch/signalsmith-stretch';

export type TempoMode = 'keylock' | 'vinyl';

/**
 * Plays planar PCM at a variable rate. "keylock" time-stretches (pitch stays), "vinyl" resamples
 * (pitch follows speed). Allocation-free per block, so it runs in the AudioWorklet as well as in
 * an export worker — the same call pattern produces the same output in both.
 */
export class RatePlayer {
  mode: TempoMode = 'keylock';
  rate = 1;
  private position = 0;
  private carry = 0;

  constructor(
    private readonly source: readonly Float32Array[],
    private readonly stretch: SignalsmithStretch,
  ) {}

  get lengthFrames(): number {
    return this.source[0]?.length ?? 0;
  }

  /** Current read position in source frames. */
  get positionFrames(): number {
    return this.position;
  }

  get ended(): boolean {
    return this.position >= this.lengthFrames;
  }

  seek(frame: number): void {
    this.position = Math.max(0, Math.min(frame, this.lengthFrames));
    this.carry = 0;
    this.stretch.reset();
  }

  render(output: readonly Float32Array[], frames: number): void {
    if (this.mode === 'keylock') this.renderKeyLock(output, frames);
    else this.renderVinyl(output, frames);
  }

  private renderKeyLock(output: readonly Float32Array[], frames: number): void {
    this.carry += frames * this.rate;
    const inputFrames = Math.floor(this.carry);
    this.carry -= inputFrames;
    const start = Math.floor(this.position);
    this.stretch.process(this.source, start, inputFrames, output, frames);
    this.position = start + inputFrames;
  }

  /** Catmull-Rom interpolation between source frames. */
  private renderVinyl(output: readonly Float32Array[], frames: number): void {
    const rate = this.rate;
    for (let c = 0; c < output.length; c++) {
      const out = output[c]!;
      const src = this.source[c] ?? this.source[0]!;
      let position = this.position;
      for (let i = 0; i < frames; i++) {
        const index = Math.floor(position);
        const t = position - index;
        const y0 = src[index - 1] ?? 0;
        const y1 = src[index] ?? 0;
        const y2 = src[index + 1] ?? 0;
        const y3 = src[index + 2] ?? 0;
        out[i] =
          y1 +
          0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
        position += rate;
      }
    }
    this.position += frames * rate;
  }
}
