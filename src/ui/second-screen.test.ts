import { describe, expect, it } from 'vitest';
import { otherScreen, type ScreenPlace } from './second-screen';

const place = (availLeft: number, availWidth: number, availHeight: number): ScreenPlace => ({
  availLeft,
  availTop: 0,
  availWidth,
  availHeight,
});

describe('the screen for the second screen window (DS-03)', () => {
  it('is another screen than the app is on, the largest', () => {
    const laptop = place(0, 1440, 900);
    const projector = place(1440, 1920, 1080);
    const small = place(-1024, 1024, 768);
    expect(otherScreen([laptop, projector, small], laptop)).toEqual(projector);
    expect(otherScreen([laptop, small], { ...laptop })).toEqual(small);
  });

  it('is none with one screen', () => {
    const laptop = place(0, 1440, 900);
    expect(otherScreen([laptop], { ...laptop })).toBeNull();
  });
});
