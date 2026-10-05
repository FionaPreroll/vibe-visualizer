import { describe, expect, it } from 'vitest';
import { Decoder } from './decoder';
import { guessLights, learnBinding, learnedProfile } from './learn';

describe('MIDI learn', () => {
  it('learns a button from its note, or from a control change', () => {
    const target = { kind: 'button', control: 'play', deck: 1 } as const;
    expect(
      learnBinding(target, [
        [0x91, 0x0b, 0x7f],
        [0x81, 0x0b, 0x40],
      ]),
    ).toEqual({
      kind: 'button',
      control: 'play',
      deck: 1,
      status: 0x91,
      data: 0x0b,
    });
    // A note on at velocity 0 is a release: it alone teaches nothing.
    expect(learnBinding(target, [[0x91, 0x0b, 0x00]])).toBeNull();
    expect(
      learnBinding(target, [
        [0xb0, 0x40, 0x7f],
        [0xb0, 0x40, 0x00],
      ]),
    ).toEqual({
      kind: 'button',
      control: 'play',
      deck: 1,
      message: 'control',
      status: 0xb0,
      data: 0x40,
    });
    const pad = { kind: 'button', control: 'pad', deck: 1, index: 3, padMode: 'hotcue' } as const;
    expect(learnBinding(pad, [[0x99, 0x26, 0x64]])).toMatchObject({ index: 3, padMode: 'hotcue' });
  });

  it('learns a knob or fader, with 14 bits and its direction', () => {
    const target = { kind: 'absolute', control: 'tempo', deck: 1 } as const;
    expect(
      learnBinding(target, [
        [0xb0, 0x10, 0],
        [0xb0, 0x10, 60],
        [0xb0, 0x10, 127],
      ]),
    ).toEqual({
      kind: 'absolute',
      control: 'tempo',
      deck: 1,
      status: 0xb0,
      msb: 0x10,
    });
    // The coarse part first, the fine 32 above; moved from top to bottom, the values fall.
    const fourteen = [100, 80, 40, 0].flatMap((value) => [
      [0xb2, 0x00, value],
      [0xb2, 0x20, 5],
    ]);
    expect(learnBinding(target, fourteen)).toEqual({
      kind: 'absolute',
      control: 'tempo',
      deck: 1,
      status: 0xb2,
      msb: 0x00,
      lsb: 0x20,
      invert: true,
    });
    expect(learnBinding(target, [[0x90, 0x10, 0x7f]])).toBeNull();
  });

  it('learns a jog wheel and how it writes its steps', () => {
    const target = { kind: 'relative', control: 'jog', deck: 1 } as const;
    const turned = (...values: number[]) => values.map((value) => [0xb0, 0x21, value]);
    expect(learnBinding(target, turned(65, 66, 65, 63))).toMatchObject({
      data: 0x21,
      encoding: 'offset64',
    });
    expect(learnBinding(target, turned(1, 2, 1, 127, 126))).toMatchObject({
      encoding: 'twosComplement',
    });
    expect(learnBinding(target, turned(1, 2, 65, 66))).toMatchObject({ encoding: 'signBit' });
    expect(learnBinding(target, turned(1, 1, 1))).toMatchObject({ encoding: 'twosComplement' });
    expect(learnBinding(target, turned(64))).toBeNull();
  });

  it('makes a profile whose decoder understands the controller, with lights to guess', () => {
    const play = learnBinding({ kind: 'button', control: 'play', deck: 1 }, [[0x90, 0x30, 0x7f]])!;
    const pad = learnBinding(
      { kind: 'button', control: 'pad', deck: 1, index: 2, padMode: 'hotcue' },
      [[0xb0, 0x51, 0x7f]],
    )!;
    const filter = learnBinding({ kind: 'absolute', control: 'filter', deck: 1 }, [
      [0xb0, 0x12, 0],
      [0xb0, 0x12, 127],
    ])!;
    const profile = learnedProfile('Generic MIDI 1', 'My controller', [play, pad, filter], true);
    expect(profile).toMatchObject({
      id: 'learned-generic-midi-1',
      name: 'My controller',
      ports: { input: 'Generic MIDI 1' },
      decks: 1,
    });
    expect(guessLights(profile.controls)).toEqual(profile.lights);
    expect(profile.lights).toEqual([
      { control: 'play', deck: 1, status: 0x90, data: 0x30 },
      { control: 'pad', deck: 1, index: 2, padMode: 'hotcue', status: 0xb0, data: 0x51 },
    ]);
    const decoder = new Decoder(profile);
    expect(decoder.decode([0xb0, 0x51, 0x7f], 1)).toMatchObject({
      control: 'pad',
      index: 2,
      pressed: true,
    });
    expect(decoder.decode([0xb0, 0x51, 0x00], 2)).toMatchObject({ control: 'pad', pressed: false });
    expect(decoder.knows([0xb0, 0x51, 0x00])).toBe(true);
    expect(decoder.decode([0xb0, 0x12, 127], 3)).toMatchObject({ control: 'filter', value: 1 });
    expect(learnedProfile('X', 'X', [], false)).not.toHaveProperty('lights');
  });
});
