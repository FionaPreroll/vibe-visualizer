/** What the render worker needs from a scene (Logo Spectrum, Kaleidoscope, …). */

export interface SceneInput {
  /** Seconds since the scene started (drives slow animations). */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Analysis values at the moment being shown (layout F). */
  features: Float32Array;
}

export interface Scene {
  /** True when half-float render targets work (banding-free HD rendering). */
  readonly floatTargets: boolean;
  resize(width: number, height: number): void;
  render(input: SceneInput): void;
  /** Everything that carries over from one frame to the next (settings and images excluded). */
  saveState(): SceneSnapshot;
  /** Continues from a saved state; call after the settings, images and size are set. */
  restoreState(snapshot: SceneSnapshot): void;
  dispose(): void;
}

export type SnapshotBuffer = Float32Array | Uint16Array | Uint8Array;

/**
 * A scene's state at one moment, so that a long export can resume exactly where it stopped
 * (EX-15): plain values plus arrays, including render targets read back from the GPU.
 */
export interface SceneSnapshot {
  values: Record<string, number | boolean>;
  buffers: SnapshotBuffer[];
}

const SNAPSHOT_MAGIC = 0x31535656; // "VVS1"
type BufferType = 'f32' | 'u16' | 'u8';

function bufferType(buffer: SnapshotBuffer): BufferType {
  return buffer instanceof Float32Array ? 'f32' : buffer instanceof Uint16Array ? 'u16' : 'u8';
}

const align4 = (bytes: number) => (bytes + 3) & ~3;

/** Serialises a snapshot: a small JSON header, then the buffers (4-byte aligned). */
export function encodeSnapshot(snapshot: SceneSnapshot): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(
    JSON.stringify({
      values: snapshot.values,
      buffers: snapshot.buffers.map((buffer) => ({
        type: bufferType(buffer),
        length: buffer.length,
      })),
    }),
  );
  let size = 8 + align4(header.length);
  for (const buffer of snapshot.buffers) size += align4(buffer.byteLength);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, SNAPSHOT_MAGIC, true);
  view.setUint32(4, header.length, true);
  bytes.set(header, 8);
  let offset = 8 + align4(header.length);
  for (const buffer of snapshot.buffers) {
    bytes.set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), offset);
    offset += align4(buffer.byteLength);
  }
  return bytes;
}

export function decodeSnapshot(data: ArrayBuffer): SceneSnapshot {
  const view = new DataView(data);
  if (data.byteLength < 8 || view.getUint32(0, true) !== SNAPSHOT_MAGIC) {
    throw new Error('Not a scene snapshot');
  }
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 8, headerLength))) as {
    values: SceneSnapshot['values'];
    buffers: { type: BufferType; length: number }[];
  };
  let offset = 8 + align4(headerLength);
  const buffers = header.buffers.map(({ type, length }) => {
    const Type = type === 'f32' ? Float32Array : type === 'u16' ? Uint16Array : Uint8Array;
    // Copies, so the result does not keep the whole file alive.
    const buffer = new Type(data.slice(offset, offset + length * Type.BYTES_PER_ELEMENT));
    offset += align4(buffer.byteLength);
    return buffer;
  });
  return { values: header.values, buffers };
}

/**
 * Splits real time into fixed simulation steps (the feedback of the Kaleidoscope runs at 60
 * steps per second, whatever the frame rate), and says how far the display is between the
 * last two steps.
 */
export class FixedStepper {
  readonly step: number;
  private readonly maxSteps: number;
  private pending = 0;

  constructor(stepsPerSecond: number, maxStepsPerFrame = 4) {
    this.step = 1 / stepsPerSecond;
    this.maxSteps = maxStepsPerFrame;
  }

  /** Advances by `dt` seconds; returns the number of steps to simulate now. */
  advance(dt: number): number {
    this.pending += Math.max(0, dt);
    let steps = Math.floor(this.pending / this.step + 1e-9);
    this.pending = Math.max(0, this.pending - steps * this.step);
    if (steps > this.maxSteps) {
      // Too far behind (a stall or a hidden tab): skip ahead instead of catching up.
      steps = this.maxSteps;
      this.pending = 0;
    }
    return steps;
  }

  /** 0…1: the display time's position between the previous and the latest step. */
  get blend(): number {
    return Math.min(1, Math.max(0, this.pending / this.step));
  }

  reset(): void {
    this.pending = 0;
  }

  /** Time not yet simulated, in seconds (part of a scene snapshot). */
  get pendingTime(): number {
    return this.pending;
  }

  set pendingTime(value: number) {
    this.pending = value;
  }
}
