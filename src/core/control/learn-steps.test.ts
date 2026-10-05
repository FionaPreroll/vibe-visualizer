import type { ButtonBinding } from '@fibestation/dj-controllers';
import { describe, expect, it } from 'vitest';
import { LEARN_STEPS, learnedBindings } from './learn-steps';

const pad = (index: number, status: number, data: number): ButtonBinding => ({
  kind: 'button',
  control: 'pad',
  deck: 1,
  index,
  padMode: 'hotcue',
  status,
  data,
});

describe('the steps of MIDI learn (CTL-04)', () => {
  it('ask for each control once, those the app uses first', () => {
    const ids = LEARN_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const firstUnused = LEARN_STEPS.findIndex((step) => !step.used);
    expect(LEARN_STEPS.slice(firstUnused).every((step) => !step.used)).toBe(true);
    expect(ids.slice(0, 3)).toEqual(['play', 'cue', 'pad1']);
  });

  it('give every pad its SHIFT message, where SHIFT + pad 1 sends another', () => {
    const learned = {
      pad1: pad(1, 0x97, 0x00),
      pad2: pad(2, 0x97, 0x01),
      shiftPad1: { ...pad(1, 0x98, 0x00), shift: true },
      play: null,
    };
    expect(learnedBindings(learned)).toEqual([
      pad(1, 0x97, 0x00),
      pad(2, 0x97, 0x01),
      { ...pad(1, 0x98, 0x00), shift: true },
      { ...pad(2, 0x98, 0x01), shift: true },
    ]);
    // The same message with SHIFT: the decoder tells SHIFT by the SHIFT button.
    expect(
      learnedBindings({
        pad1: pad(1, 0x97, 0x00),
        shiftPad1: { ...pad(1, 0x97, 0x00), shift: true },
      }),
    ).toEqual([pad(1, 0x97, 0x00)]);
  });
});
