import { describe, expect, it } from 'vitest';
import { Decoder } from './decoder';
import { PIONEER_DDJ_FLX2 } from './profiles/pioneer-ddj-flx2';
import type { ControllerProfile } from './types';

describe('Decoder', () => {
  const decoder = () => new Decoder(PIONEER_DDJ_FLX2);

  it('decodes buttons, with note off or velocity 0 as the release', () => {
    const flx2 = decoder();
    expect(flx2.decode([0x90, 0x0b, 0x7f], 12)).toEqual({
      kind: 'button',
      control: 'play',
      device: 'pioneer-ddj-flx2',
      deck: 1,
      pressed: true,
      shift: false,
      time: 12,
    });
    expect(flx2.decode([0x90, 0x0b, 0x00], 13)).toMatchObject({ control: 'play', pressed: false });
    expect(flx2.decode([0x81, 0x0c, 0x40], 14)).toMatchObject({
      control: 'cue',
      deck: 2,
      pressed: false,
    });
    expect(flx2.decode([0x90, 0x7e, 0x7f], 15)).toBeNull();
  });

  it('decodes the pads with their number, mode and SHIFT', () => {
    const flx2 = decoder();
    expect(flx2.decode([0x97, 0x02, 0x7f], 0)).toMatchObject({
      control: 'pad',
      deck: 1,
      index: 3,
      padMode: 'hotcue',
      shift: false,
      pressed: true,
    });
    expect(flx2.decode([0x98, 0x07, 0x7f], 0)).toMatchObject({ index: 8, shift: true });
    expect(flx2.decode([0x99, 0x60, 0x7f], 0)).toMatchObject({
      deck: 2,
      index: 1,
      padMode: 'loop',
    });
  });

  it('knows when SHIFT is held, per deck', () => {
    const flx2 = decoder();
    flx2.decode([0x90, 0x3f, 0x7f], 0);
    expect(flx2.decode([0x90, 0x0b, 0x7f], 0)).toMatchObject({ shift: true });
    expect(flx2.decode([0x91, 0x0b, 0x7f], 0)).toMatchObject({ shift: false });
    // The crossfader belongs to no deck: SHIFT on either counts.
    flx2.decode([0xb6, 0x1f, 0x40], 0);
    expect(flx2.decode([0xb6, 0x3f, 0x00], 0)).toMatchObject({ deck: null, shift: true });
    flx2.decode([0x90, 0x3f, 0x00], 0);
    expect(flx2.decode([0x90, 0x0b, 0x7f], 0)).toMatchObject({ shift: false });
  });

  it('joins the coarse and the fine part of 14-bit values', () => {
    const flx2 = decoder();
    expect(flx2.knows([0xb0, 0x0f, 0x40])).toBe(true);
    expect(flx2.decode([0xb0, 0x0f, 0x40], 0)).toBeNull();
    expect(flx2.knows([0xb0, 0x7f, 0x40])).toBe(false);
    const low = flx2.decode([0xb0, 0x2f, 0x00], 0);
    expect(low).toMatchObject({ kind: 'absolute', control: 'eqLow', deck: 1 });
    expect(low?.kind === 'absolute' && low.value).toBeCloseTo(8192 / 16383, 6);
    // The tempo slider stops at 16,382, at the bottom.
    flx2.decode([0xb1, 0x00, 0x7f], 0);
    expect(flx2.decode([0xb1, 0x20, 0x7e], 0)).toMatchObject({
      control: 'tempo',
      deck: 2,
      value: 1,
    });
    flx2.decode([0xb6, 0x18, 0x00], 0);
    expect(flx2.decode([0xb6, 0x38, 0x00], 0)).toMatchObject({
      control: 'filter',
      deck: 2,
      value: 0,
    });
  });

  it('decodes relative controls in each encoding', () => {
    const flx2 = decoder();
    expect(flx2.decode([0xb0, 0x21, 0x41], 0)).toMatchObject({ control: 'jog', delta: 1 });
    expect(flx2.decode([0xb0, 0x21, 0x3d], 0)).toMatchObject({ control: 'jog', delta: -3 });
    // The top of the jog wheel while SHIFT is held.
    flx2.decode([0x90, 0x3f, 0x7f], 0);
    expect(flx2.decode([0xb0, 0x29, 0x42], 0)).toMatchObject({ delta: 2, shift: true });
    expect(flx2.decode([0x90, 0x67, 0x7f], 0)).toMatchObject({
      control: 'jogTouch',
      shift: true,
    });
    const profile: ControllerProfile = {
      id: 'test',
      name: 'Test',
      ports: { input: 'Test' },
      decks: 1,
      controls: [
        { kind: 'relative', control: 'browse', status: 0xb0, data: 1, encoding: 'twosComplement' },
        {
          kind: 'relative',
          control: 'jog',
          deck: 1,
          status: 0xb0,
          data: 2,
          encoding: 'signBit',
          perTurn: 4,
        },
        { kind: 'absolute', control: 'volume', deck: 1, status: 0xb0, msb: 3, invert: true },
      ],
    };
    const test = new Decoder(profile);
    expect(test.decode([0xb0, 1, 0x7f], 0)).toMatchObject({ delta: -1 });
    expect(test.decode([0xb0, 1, 0x02], 0)).toMatchObject({ delta: 2 });
    expect(test.decode([0xb0, 2, 0x42], 0)).toMatchObject({ delta: -0.5 });
    expect(test.decode([0xb0, 3, 0x7f], 0)).toMatchObject({ value: 0 });
  });
});
