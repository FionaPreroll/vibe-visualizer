/**
 * Single-producer / single-consumer ring buffer for planar float32 audio in a SharedArrayBuffer.
 *
 * Producer: the media worker (decodes and writes). Consumer: the AudioWorklet (reads; it must never
 * block or allocate). A seek or cue jump starts a new *generation*: the producer bumps the
 * generation and waits until the consumer has dropped all older frames before writing new ones.
 *
 * Frame counters are uint32 and wrap after 2^32 frames (≈ 24.8 h at 48 kHz); the capacity is a
 * power of two so slot positions stay continuous across the wrap.
 */

// Int32 control fields
const WRITE = 0; // producer: total frames written
const READ = 1; // consumer: total frames read
const GENERATION = 2; // producer: current generation
const ACK_GENERATION = 3; // consumer: generation it has switched to
const UNDERRUNS = 4; // consumer: quanta that ran dry while a generation was playing
const ENDED_GENERATION = 5; // producer: generation whose source reached its end
const FIRST_FRAME_GENERATION = 6; // consumer: generation whose first frame has been output
const CONTROL_INTS = 8;

// Float64 fields
const START_FRAME = 0; // producer: source frame at which the current generation starts
const POSITION = 1; // consumer: source frame that plays at RENDER_TIME
const RENDER_TIME = 2; // consumer: context time at the end of the last render quantum
const FIRST_FRAME_TIME = 3; // consumer: context time at which the generation's first frame played
const FLOAT_FIELDS = 4;

const HEADER_BYTES = CONTROL_INTS * 4 + FLOAT_FIELDS * 8;

export function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

/** Allocates the shared memory for a ring with room for at least `minCapacity` frames. */
export function createAudioRing(channels: number, minCapacity: number): SharedArrayBuffer {
  const capacity = nextPowerOfTwo(minCapacity);
  const sab = new SharedArrayBuffer(HEADER_BYTES + channels * capacity * 4);
  new Int32Array(sab, 0, CONTROL_INTS)[FIRST_FRAME_GENERATION] = -1;
  return sab;
}

class AudioRingView {
  readonly channels: number;
  readonly capacity: number;
  protected readonly mask: number;
  protected readonly control: Int32Array<SharedArrayBuffer>;
  protected readonly floats: Float64Array<SharedArrayBuffer>;
  protected readonly planes: Float32Array<SharedArrayBuffer>[];

  constructor(sab: SharedArrayBuffer, channels: number) {
    this.channels = channels;
    this.capacity = (sab.byteLength - HEADER_BYTES) / 4 / channels;
    if (!Number.isInteger(this.capacity) || nextPowerOfTwo(this.capacity) !== this.capacity) {
      throw new Error('AudioRing: buffer size does not match a power-of-two capacity');
    }
    this.mask = this.capacity - 1;
    this.control = new Int32Array(sab, 0, CONTROL_INTS);
    this.floats = new Float64Array(sab, CONTROL_INTS * 4, FLOAT_FIELDS);
    this.planes = [];
    for (let c = 0; c < channels; c++) {
      this.planes.push(new Float32Array(sab, HEADER_BYTES + c * this.capacity * 4, this.capacity));
    }
  }

  /** Frames written but not yet read. */
  get bufferedFrames(): number {
    return (Atomics.load(this.control, WRITE) - Atomics.load(this.control, READ)) >>> 0;
  }
}

export class AudioRingProducer extends AudioRingView {
  /** Frames that fit into the ring right now. */
  get freeFrames(): number {
    return this.capacity - this.bufferedFrames;
  }

  /**
   * Copies up to `frames` frames from `source` (starting at `offset`) into the ring and returns
   * how many fitted. A mono source is duplicated to all channels.
   */
  write(source: readonly Float32Array[], offset: number, frames: number): number {
    const write = Atomics.load(this.control, WRITE) >>> 0;
    const read = Atomics.load(this.control, READ) >>> 0;
    const count = Math.min(frames, this.capacity - ((write - read) >>> 0));
    if (count <= 0) return 0;
    const start = write & this.mask;
    const first = Math.min(count, this.capacity - start);
    for (let c = 0; c < this.channels; c++) {
      const src = source[c] ?? source[0]!;
      const plane = this.planes[c]!;
      plane.set(src.subarray(offset, offset + first), start);
      if (count > first) plane.set(src.subarray(offset + first, offset + count), 0);
    }
    Atomics.store(this.control, WRITE, (write + count) | 0);
    return count;
  }

  /**
   * Starts a new generation whose first frame is `startFrame` of the source. Older frames are
   * dropped by the consumer; write new frames only once {@link isAcknowledged} returns true.
   */
  beginGeneration(startFrame: number): number {
    this.floats[START_FRAME] = startFrame;
    return Atomics.add(this.control, GENERATION, 1) + 1;
  }

  isAcknowledged(generation: number): boolean {
    return Atomics.load(this.control, ACK_GENERATION) === generation;
  }

  /** Marks the end of the source for `generation`: running dry is then not an underrun. */
  markEnded(generation: number): void {
    Atomics.store(this.control, ENDED_GENERATION, generation);
  }
}

export class AudioRingConsumer extends AudioRingView {
  private generation = 0;
  private generationStart = 0;
  private generationPlayed = 0;
  private awaitingFirstFrame = true;

  /**
   * Fills `output[c][0..frames)` from the ring (zero-padding when it runs dry) and returns the
   * number of frames taken. Allocation-free, safe for the audio thread.
   */
  read(
    output: readonly Float32Array[],
    frames: number,
    contextTime: number,
    sampleRateHz: number,
  ): number {
    const generation = this.syncGeneration();

    const write = Atomics.load(this.control, WRITE) >>> 0;
    const read = Atomics.load(this.control, READ) >>> 0;
    const count = Math.min(frames, (write - read) >>> 0);
    const start = read & this.mask;
    const first = Math.min(count, this.capacity - start);
    for (let c = 0; c < output.length; c++) {
      const out = output[c]!;
      const plane = this.planes[Math.min(c, this.channels - 1)]!;
      for (let i = 0; i < first; i++) out[i] = plane[start + i]!;
      for (let i = first; i < count; i++) out[i] = plane[i - first]!;
      out.fill(0, count, frames);
    }
    Atomics.store(this.control, READ, (read + count) | 0);

    if (count > 0 && this.awaitingFirstFrame) {
      this.awaitingFirstFrame = false;
      this.floats[FIRST_FRAME_TIME] = contextTime;
      Atomics.store(this.control, FIRST_FRAME_GENERATION, generation);
    } else if (
      count < frames &&
      !this.awaitingFirstFrame &&
      Atomics.load(this.control, ENDED_GENERATION) !== generation
    ) {
      Atomics.add(this.control, UNDERRUNS, 1);
    }

    this.generationPlayed += count;
    this.floats[POSITION] = this.generationStart + this.generationPlayed;
    this.floats[RENDER_TIME] = contextTime + frames / sampleRateHz;
    return count;
  }

  /**
   * Switches to a new generation if the producer started one (dropping older frames) and
   * acknowledges it. {@link read} does this itself; call it directly while paused, so seeks do
   * not wait for playback.
   */
  syncGeneration(): number {
    const generation = Atomics.load(this.control, GENERATION);
    if (generation !== this.generation) {
      Atomics.store(this.control, READ, Atomics.load(this.control, WRITE));
      this.generation = generation;
      this.generationStart = this.floats[START_FRAME]!;
      this.generationPlayed = 0;
      this.awaitingFirstFrame = true;
      this.floats[POSITION] = this.generationStart;
      Atomics.store(this.control, ACK_GENERATION, generation);
    }
    return generation;
  }

  /** Source frame that the next read starts at. */
  get positionFrames(): number {
    return this.generationStart + this.generationPlayed;
  }
}

/** Read-only view for the main thread (statistics and playback position). */
export class AudioRingMonitor extends AudioRingView {
  /** Source frame that plays at {@link renderTime}. */
  get position(): number {
    return this.floats[POSITION]!;
  }
  /** Context time at which {@link position} plays. */
  get renderTime(): number {
    return this.floats[RENDER_TIME]!;
  }
  get underruns(): number {
    return Atomics.load(this.control, UNDERRUNS);
  }
  get generation(): number {
    return Atomics.load(this.control, GENERATION);
  }
  /** Context time at which `generation` started to play, or null if it has not yet. */
  firstFrameTime(generation: number): number | null {
    return Atomics.load(this.control, FIRST_FRAME_GENERATION) === generation
      ? this.floats[FIRST_FRAME_TIME]!
      : null;
  }
  isEnded(): boolean {
    return (
      Atomics.load(this.control, ENDED_GENERATION) === this.generation && this.bufferedFrames === 0
    );
  }
}
