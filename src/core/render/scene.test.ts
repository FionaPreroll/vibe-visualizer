import { describe, expect, it } from 'vitest';
import { FixedStepper } from './scene';

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
