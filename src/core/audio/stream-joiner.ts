/**
 * Joins the files of a stream as the player plays a queue (PL-05, TR-09): one right after the
 * other, without a gap. At an out marker the last frames are held back and cross (equal power)
 * into the start of what follows; a start in the middle of the music that crosses nothing fades
 * in instead; at the end of the stream, what was held back fades out. File ends join as they
 * are. The live engine and the export both join through here, so a video of several tracks
 * sounds like the queue.
 */

/** Length of the crossfade at a cut in the middle of the music (seconds). */
export const CROSSFADE_SECONDS = 0.01;

/** Stereo frames held back or mixed at a cut. */
class Tail {
  readonly planes: Float32Array[];
  length = 0;

  constructor(frames: number) {
    this.planes = [new Float32Array(frames), new Float32Array(frames)];
  }

  get capacity(): number {
    return this.planes[0]!.length;
  }
}

/** Gain of the incoming side of an equal-power crossfade at frame `i` of `frames`. */
export function fadeGain(i: number, frames: number): number {
  return Math.sin(((i + 0.5) / frames) * (Math.PI / 2));
}

export class StreamJoiner {
  /** What the last file held back at its out marker, and what this one holds back at its own. */
  private incoming: Tail;
  private outgoing: Tail;
  private from = 0;
  private fadeIn = 0;

  /** `crossfade`: frames of the crossfade at a cut. */
  constructor(readonly crossfade: number) {
    this.incoming = new Tail(crossfade);
    this.outgoing = new Tail(crossfade);
  }

  /** True once the frames before the current file's end are held back for the crossfade. */
  get holding(): boolean {
    return this.outgoing.length > 0;
  }

  /**
   * A file of the stream starts at its frame `from`; `first` for the first file of a stream,
   * which the tempo stage fades in.
   */
  begin(from: number, first: boolean): void {
    this.from = from;
    this.outgoing.length = 0;
    // A start in the middle of the music crosses from what the last file held back, or fades in.
    this.fadeIn = !first && this.incoming.length === 0 && from > 0 ? this.crossfade : 0;
  }

  /**
   * Takes decoded frames of the file from its frame `position` on, up to its end `limit` (null:
   * the end of the file): crosses or fades them in where the file starts (in place), and holds
   * back those just before the limit. Returns how many of them go out now, from the first.
   * `planes` are two planes of their own (a mono file gets a copy).
   */
  take(planes: Float32Array[], position: number, limit: number | null): number {
    const count = planes[0]!.length;
    const offset = position - this.from;
    const incoming = this.incoming;
    const cross = incoming.length > 0 ? incoming.length : this.fadeIn;
    for (let i = offset; i < Math.min(cross, offset + count); i++) {
      const gain = fadeGain(i, cross);
      const fade = Math.sqrt(1 - gain * gain);
      for (let c = 0; c < 2; c++) {
        const plane = planes[c]!;
        const held = incoming.length > 0 ? incoming.planes[c]![i]! * fade : 0;
        plane[i - offset] = plane[i - offset]! * gain + held;
      }
    }
    // The frames just before the out marker are held back for the crossfade.
    const outgoing = this.outgoing;
    const holdFrom = limit === null ? Infinity : limit - outgoing.capacity;
    const keep = Math.max(0, Math.min(count, holdFrom - position));
    if (keep < count) {
      for (let c = 0; c < 2; c++) {
        outgoing.planes[c]!.set(planes[c]!.subarray(keep, count), outgoing.length);
      }
      outgoing.length += count - keep;
    }
    return keep;
  }

  /** The next file follows: what this one held back crosses into its start. */
  next(): void {
    [this.incoming, this.outgoing] = [this.outgoing, this.incoming];
  }

  /** The stream ends: what was held back, faded out (empty planes if nothing was). */
  end(): Float32Array[] {
    const outgoing = this.outgoing;
    const planes = outgoing.planes.map((plane) => plane.slice(0, outgoing.length));
    for (let i = 0; i < outgoing.length; i++) {
      const gain = fadeGain(outgoing.length - 1 - i, outgoing.length);
      for (const plane of planes) plane[i] = plane[i]! * gain;
    }
    outgoing.length = 0;
    return planes;
  }
}
