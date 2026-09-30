import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLINK_MS, Lights } from './lights';
import { PIONEER_DDJ_FLX2 } from './profiles/pioneer-ddj-flx2';

describe('Lights', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a light only when it changes', () => {
    const sent: number[][] = [];
    const lights = new Lights(PIONEER_DDJ_FLX2, (message) => sent.push(message));
    lights.set({ control: 'play', deck: 1 }, 'on');
    lights.set({ control: 'play', deck: 1 }, 'on');
    lights.set({ control: 'pad', deck: 1, index: 3, padMode: 'hotcue', shift: true }, 'on');
    lights.set({ control: 'play', deck: 1 }, 'off');
    lights.set({ control: 'sync', deck: 1 }, 'on');
    expect(sent).toEqual([
      [0x90, 0x0b, 0x7f],
      [0x98, 0x02, 0x7f],
      [0x90, 0x0b, 0x00],
    ]);
    expect(lights.has({ control: 'pad', deck: 2, index: 8, padMode: 'hotcue' })).toBe(true);
    expect(lights.has({ control: 'sync', deck: 1 })).toBe(false);
  });

  it('blinks all blinking lights together, and stops the timer when none blinks', () => {
    vi.useFakeTimers();
    const sent: number[][] = [];
    const lights = new Lights(PIONEER_DDJ_FLX2, (message) => sent.push(message));
    lights.set({ control: 'play', deck: 1 }, 'blink');
    lights.set({ control: 'cue', deck: 1 }, 'blink');
    expect(sent).toEqual([
      [0x90, 0x0b, 0x7f],
      [0x90, 0x0c, 0x7f],
    ]);
    vi.advanceTimersByTime(BLINK_MS);
    expect(sent.slice(2)).toEqual([
      [0x90, 0x0b, 0x00],
      [0x90, 0x0c, 0x00],
    ]);
    lights.set({ control: 'play', deck: 1 }, 'on');
    lights.set({ control: 'cue', deck: 1 }, 'off');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns every light off when cleared', () => {
    const sent: number[][] = [];
    const lights = new Lights(PIONEER_DDJ_FLX2, (message) => sent.push(message));
    lights.clear();
    // Play and cue, and 8 pads with and without SHIFT, on both decks.
    expect(sent).toHaveLength(2 * (2 + 16));
    expect(sent.every((message) => message[2] === 0)).toBe(true);
  });
});
