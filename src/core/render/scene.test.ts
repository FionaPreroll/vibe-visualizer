import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, FixedStepper } from './scene';

describe('FixedStepper', () => {
  it.each([30, 60, 90, 144])('runs 60 steps per second at %i frames per second', (fps) => {
    const stepper = new FixedStepper(60);
    let steps = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      steps += stepper.advance(1 / fps);
      expect(stepper.blend).toBeGreaterThanOrEqual(0);
      expect(stepper.blend).toBeLessThanOrEqual(1);
    }
    expect(steps).toBeGreaterThanOrEqual(599);
    expect(steps).toBeLessThanOrEqual(600);
  });

  it('skips ahead after a long pause instead of catching up', () => {
    const stepper = new FixedStepper(60, 4);
    expect(stepper.advance(2)).toBe(4);
    expect(stepper.blend).toBe(0);
    expect(stepper.advance(1 / 60)).toBe(1);
  });
});

describe('scene snapshots', () => {
  it('round-trip values and aligned buffers', () => {
    const snapshot = {
      values: { frame: 42, pending: 0.0125, kick: true },
      buffers: [
        new Float32Array([1.5, -2, 3.25]),
        new Uint16Array([1, 2, 3]),
        new Uint8Array([7, 8, 9, 10, 11]),
      ],
    };
    const encoded = encodeSnapshot(snapshot);
    const decoded = decodeSnapshot(encoded.buffer);
    expect(decoded.values).toEqual(snapshot.values);
    expect(decoded.buffers).toEqual(snapshot.buffers);
    expect(decoded.buffers.map((buffer) => buffer.constructor)).toEqual([
      Float32Array,
      Uint16Array,
      Uint8Array,
    ]);
    expect(() => decodeSnapshot(new ArrayBuffer(16))).toThrow('Not a scene snapshot');
  });
});
