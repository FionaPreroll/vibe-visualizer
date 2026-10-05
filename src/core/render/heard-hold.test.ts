import { describe, expect, it } from 'vitest';
import { HeardHold } from './heard-hold';

describe('the file heard, held over frames without analysis', () => {
  it('keeps the file over a few frames as the music starts, not over a stop', () => {
    const hold = new HeardHold(0.5);
    const frame = 1 / 60;
    expect(hold.next(false, 0, frame)).toBe(0);
    // The first frames of a track: found, missed, found …: the file stays.
    const seen = [true, false, false, true, false, true, true].map((sampled) =>
      hold.next(sampled, 3, frame),
    );
    expect(seen).toEqual([3, 3, 3, 3, 3, 3, 3]);
    // Another file is taken at once.
    expect(hold.next(true, 4, frame)).toBe(4);
    // Half a second without analysis: nothing is heard any more.
    let token = 4;
    for (let i = 0; i < 31; i++) token = hold.next(false, 0, frame);
    expect(token).toBe(0);
  });

  it('hears no file from live input', () => {
    const hold = new HeardHold();
    expect(hold.next(true, 3, 0.1)).toBe(3);
    expect(hold.next(true, 0, 0.1)).toBe(0);
    expect(hold.next(false, 0, 0.1)).toBe(0);
  });
});
