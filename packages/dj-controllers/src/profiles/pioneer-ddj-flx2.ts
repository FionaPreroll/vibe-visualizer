import type { ControlBinding, ControllerProfile, LightBinding, PadMode } from '../types';

/**
 * Pioneer DJ DDJ-FLX2, from AlphaTheta's MIDI message list for it
 * (https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf).
 *
 * Deck 1 sends on MIDI channel 1 and deck 2 on channel 2, the CFX knobs and the crossfader on
 * channel 7, and the pads on channels 8 and 10 (9 and 11 with SHIFT). Knobs and faders send 14
 * bits, the coarse part first. The controller switches the pad modes itself and tells them by
 * the notes: hot cues 00–07, pad FX 10–17, sampler 30–37, beat loop 60–67. A light is set with
 * the note of its control.
 */

const PAD_MODES: readonly (readonly [PadMode, number])[] = [
  ['hotcue', 0x00],
  ['fx', 0x10],
  ['sampler', 0x30],
  ['loop', 0x60],
];

function deck(number: 1 | 2): { controls: ControlBinding[]; lights: LightBinding[] } {
  const note = 0x90 + number - 1;
  const change = 0xb0 + number - 1;
  const pads = number === 1 ? 0x97 : 0x99;
  const controls: ControlBinding[] = [
    { kind: 'button', control: 'play', deck: number, status: note, data: 0x0b },
    { kind: 'button', control: 'cue', deck: number, status: note, data: 0x0c },
    { kind: 'button', control: 'shift', deck: number, status: note, data: 0x3f },
    { kind: 'button', control: 'sync', deck: number, status: note, data: 0x58 },
    { kind: 'button', control: 'headphoneCue', deck: number, status: note, data: 0x54 },
    { kind: 'button', control: 'jogTouch', deck: number, status: note, data: 0x36 },
    { kind: 'button', control: 'jogTouch', deck: number, shift: true, status: note, data: 0x67 },
    { kind: 'absolute', control: 'eqHigh', deck: number, status: change, msb: 0x07, lsb: 0x27 },
    { kind: 'absolute', control: 'eqMid', deck: number, status: change, msb: 0x0b, lsb: 0x2b },
    { kind: 'absolute', control: 'eqLow', deck: number, status: change, msb: 0x0f, lsb: 0x2f },
    { kind: 'absolute', control: 'volume', deck: number, status: change, msb: 0x13, lsb: 0x33 },
    // 0 with the slider at the top (−, slower), 16,382 at the bottom (+, faster).
    {
      kind: 'absolute',
      control: 'tempo',
      deck: number,
      status: change,
      msb: 0x00,
      lsb: 0x20,
      max: 0x3ffe,
    },
    {
      kind: 'absolute',
      control: 'filter',
      deck: number,
      status: 0xb6,
      msb: 0x16 + number,
      lsb: 0x36 + number,
    },
    // The jog wheel's outer ring, its top (with and without vinyl mode, 460 steps a turn), and
    // its top with SHIFT held.
    ...[0x21, 0x22, 0x23, 0x29].map((data): ControlBinding => ({
      kind: 'relative',
      control: 'jog',
      deck: number,
      status: change,
      data,
      encoding: 'offset64',
    })),
  ];
  for (const [padMode, first] of PAD_MODES) {
    const data = [first, first + 7] as const;
    controls.push(
      { kind: 'button', control: 'pad', deck: number, padMode, status: pads, data },
      {
        kind: 'button',
        control: 'pad',
        deck: number,
        padMode,
        shift: true,
        status: pads + 1,
        data,
      },
    );
  }
  const lights: LightBinding[] = [
    { control: 'play', deck: number, status: note, data: 0x0b },
    { control: 'cue', deck: number, status: note, data: 0x0c },
    { control: 'pad', deck: number, padMode: 'hotcue', status: pads, data: [0x00, 0x07] },
    {
      control: 'pad',
      deck: number,
      padMode: 'hotcue',
      shift: true,
      status: pads + 1,
      data: [0x00, 0x07],
    },
  ];
  return { controls, lights };
}

const left = deck(1);
const right = deck(2);

export const PIONEER_DDJ_FLX2: ControllerProfile = {
  id: 'pioneer-ddj-flx2',
  name: 'Pioneer DJ DDJ-FLX2',
  ports: { input: 'DDJ-FLX2' },
  decks: 2,
  controls: [
    ...left.controls,
    ...right.controls,
    { kind: 'absolute', control: 'crossfader', status: 0xb6, msb: 0x1f, lsb: 0x3f },
  ],
  lights: [...left.lights, ...right.lights],
};
