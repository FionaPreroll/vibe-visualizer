/** Flags shared between the main thread and the engine AudioWorklet. */

const PAUSED = 0;
const INTS = 4;

export function createEngineControl(): SharedArrayBuffer {
  return new SharedArrayBuffer(INTS * 4);
}

export class EngineControl {
  private readonly ints: Int32Array<SharedArrayBuffer>;

  constructor(sab: SharedArrayBuffer) {
    this.ints = new Int32Array(sab, 0, INTS);
  }

  get paused(): boolean {
    return Atomics.load(this.ints, PAUSED) === 1;
  }

  set paused(value: boolean) {
    Atomics.store(this.ints, PAUSED, value ? 1 : 0);
  }
}
