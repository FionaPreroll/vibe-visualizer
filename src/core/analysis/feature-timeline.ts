import { F, HIT_FIELDS } from './features';

/**
 * Shared-memory history of analysis frames with their timestamps. The AudioWorklet writes one
 * frame per hop; the renderer looks frames up by engine time (the audible moment) without
 * consuming them. Allocation-free on both sides.
 */

const COUNT = 0;
const HEADER_INTS = 4;
const TIME_FIELDS = 2; // engine frame, source seconds

export function createFeatureTimeline(capacity = 1024): SharedArrayBuffer {
  return new SharedArrayBuffer(
    HEADER_INTS * 4 + capacity * TIME_FIELDS * 8 + capacity * F.size * 4,
  );
}

class TimelineView {
  readonly capacity: number;
  protected readonly control: Int32Array<SharedArrayBuffer>;
  protected readonly times: Float64Array<SharedArrayBuffer>;
  protected readonly features: Float32Array<SharedArrayBuffer>;

  constructor(sab: SharedArrayBuffer) {
    this.capacity = (sab.byteLength - HEADER_INTS * 4) / (TIME_FIELDS * 8 + F.size * 4);
    this.control = new Int32Array(sab, 0, HEADER_INTS);
    this.times = new Float64Array(sab, HEADER_INTS * 4, this.capacity * TIME_FIELDS);
    this.features = new Float32Array(
      sab,
      HEADER_INTS * 4 + this.capacity * TIME_FIELDS * 8,
      this.capacity * F.size,
    );
  }

  /** Number of frames written so far. */
  get count(): number {
    return Atomics.load(this.control, COUNT);
  }
}

export class FeatureTimelineWriter extends TimelineView {
  write(engineFrame: number, sourceSeconds: number, frame: Float32Array): void {
    const count = Atomics.load(this.control, COUNT);
    const slot = count % this.capacity;
    this.times[slot * TIME_FIELDS] = engineFrame;
    this.times[slot * TIME_FIELDS + 1] = sourceSeconds;
    this.features.set(frame, slot * F.size);
    Atomics.store(this.control, COUNT, count + 1);
  }
}

export class FeatureTimelineReader extends TimelineView {
  /** Engine frame of the newest analysis frame, or -1. */
  latestEngineFrame(): number {
    const count = this.count;
    return count === 0 ? -1 : this.times[((count - 1) % this.capacity) * TIME_FIELDS]!;
  }

  /**
   * Writes the analysis values at `engineFrame` into `out`, interpolating between the two
   * nearest frames (hit flags are taken from the earlier frame; the beat phase wraps around).
   * Returns the source position in seconds, or null if no frame is old enough.
   */
  sample(engineFrame: number, out: Float32Array): number | null {
    const count = this.count;
    const oldest = Math.max(0, count - this.capacity + 8);
    for (let index = count - 1; index >= oldest; index--) {
      const slot = index % this.capacity;
      const time = this.times[slot * TIME_FIELDS]!;
      if (time > engineFrame) continue;
      const base = slot * F.size;
      if (index + 1 < count) {
        const nextSlot = (index + 1) % this.capacity;
        const nextTime = this.times[nextSlot * TIME_FIELDS]!;
        const t = nextTime > time ? (engineFrame - time) / (nextTime - time) : 0;
        const nextBase = nextSlot * F.size;
        for (let i = 0; i < F.size; i++) {
          const a = this.features[base + i]!;
          out[i] = a + (this.features[nextBase + i]! - a) * t;
        }
        for (let h = 0; h < HIT_FIELDS.length; h++) {
          out[HIT_FIELDS[h]!] = this.features[base + HIT_FIELDS[h]!]!;
        }
        const phase = this.features[base + F.beatPhase]!;
        let nextPhase = this.features[nextBase + F.beatPhase]!;
        if (nextPhase < phase) nextPhase += 1;
        out[F.beatPhase] = (phase + (nextPhase - phase) * t) % 1;
      } else {
        for (let i = 0; i < F.size; i++) out[i] = this.features[base + i]!;
      }
      return this.times[slot * TIME_FIELDS + 1]!;
    }
    return null;
  }

  /**
   * ORs the hit flags of all frames in (fromFrame, toFrame] into `out` at the hit offsets, so
   * a renderer running slower than the analysis never misses a hit.
   */
  collectHits(fromFrame: number, toFrame: number, out: Float32Array): void {
    for (let h = 0; h < HIT_FIELDS.length; h++) out[HIT_FIELDS[h]!] = 0;
    const count = this.count;
    const oldest = Math.max(0, count - this.capacity + 8);
    for (let index = count - 1; index >= oldest; index--) {
      const slot = index % this.capacity;
      const time = this.times[slot * TIME_FIELDS]!;
      if (time <= fromFrame) break;
      if (time > toFrame) continue;
      for (let h = 0; h < HIT_FIELDS.length; h++) {
        if (this.features[slot * F.size + HIT_FIELDS[h]!]! > 0) out[HIT_FIELDS[h]!] = 1;
      }
    }
  }
}

/**
 * The renderer's view of a timeline: the features at a sequence of display times (engine
 * frames), with every hit between two displays reported exactly once. The live view and the
 * export use it the same way, so they react identically.
 */
export class FeatureSampler {
  private last = -1;

  constructor(private readonly reader: FeatureTimelineReader) {}

  /** Writes the features at engine frame `at` into `out`; zeros (and false) if there are none. */
  sample(at: number | null, out: Float32Array): boolean {
    if (at === null || this.reader.sample(at, out) === null) {
      out.fill(0);
      return false;
    }
    if (this.last >= 0) {
      // A small step back comes from a clock update and must not report the same hits again
      // (collectHits then clears them).
      this.reader.collectHits(this.last, at, out);
      this.last = Math.max(this.last, at);
    } else {
      this.last = at;
    }
    return true;
  }

  /** Continues as if the previous display was at engine frame `frame` (-1: none). */
  resetTo(frame: number): void {
    this.last = frame;
  }
}
