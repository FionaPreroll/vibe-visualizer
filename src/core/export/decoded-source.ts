import type { TempoSource } from '../audio/dsp/tempo';

/**
 * Decoded audio for the export's sound chain: decodes ahead asynchronously ({@link ensure}),
 * so that the tempo stage can pull it synchronously, as it does from the live engine's ring.
 */
export class DecodedSource implements TempoSource {
  private readonly chunks: Float32Array[][] = [];
  /** Frames of chunks[0] already taken. */
  private taken = 0;
  private buffered = 0;
  private done = false;

  constructor(private readonly decoder: AsyncIterator<Float32Array[]>) {}

  get ended(): boolean {
    return this.done && this.buffered === 0;
  }

  /** Decodes until at least `frames` frames are waiting, or the file has ended. */
  async ensure(frames: number): Promise<void> {
    while (!this.done && this.buffered < frames) {
      const next = await this.decoder.next();
      if (next.done) {
        this.done = true;
      } else if (next.value[0]!.length > 0) {
        this.chunks.push(next.value);
        this.buffered += next.value[0]!.length;
      }
    }
  }

  pull(planes: readonly Float32Array[], offset: number, frames: number): number {
    let copied = 0;
    while (copied < frames && this.chunks.length > 0) {
      const chunk = this.chunks[0]!;
      const length = chunk[0]!.length;
      const count = Math.min(frames - copied, length - this.taken);
      for (let c = 0; c < planes.length; c++) {
        // A mono file plays on both sides.
        const source = chunk[c] ?? chunk[0]!;
        planes[c]!.set(source.subarray(this.taken, this.taken + count), offset + copied);
      }
      copied += count;
      this.taken += count;
      this.buffered -= count;
      if (this.taken === length) {
        this.chunks.shift();
        this.taken = 0;
      }
    }
    return copied;
  }

  /** Stops decoding (closes the decoder early). */
  async close(): Promise<void> {
    this.done = true;
    await this.decoder.return?.();
  }
}
