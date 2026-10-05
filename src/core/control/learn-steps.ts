import type { ControlBinding, LearnTarget } from '@fibestation/dj-controllers';
import { CUE_COUNT } from '../state/app-state';

/**
 * The controls MIDI learn asks for (CTL-04), one after the other: those the app uses on deck 1,
 * then more that a full profile of the controller would have. What each sent goes into the
 * controller report, also for the controls the app does not use yet.
 */
export interface LearnStep {
  id: string;
  /** The control, as on most controllers. */
  label: string;
  /** What to do with it while the app listens. */
  hint: string;
  target: LearnTarget;
  /** Whether the app uses it (deck 1); the others are for the report and a full profile. */
  used: boolean;
}

const press = 'Press it.';

export const LEARN_STEPS: readonly LearnStep[] = [
  {
    id: 'play',
    label: 'PLAY/PAUSE',
    hint: press,
    target: { kind: 'button', control: 'play', deck: 1 },
    used: true,
  },
  {
    id: 'cue',
    label: 'CUE',
    hint: press,
    target: { kind: 'button', control: 'cue', deck: 1 },
    used: true,
  },
  ...Array.from({ length: CUE_COUNT }, (_, i): LearnStep => ({
    id: `pad${i + 1}`,
    label: `Pad ${i + 1}`,
    hint: 'Press it, in the hot cue mode if the pads have modes.',
    target: { kind: 'button', control: 'pad', deck: 1, index: i + 1, padMode: 'hotcue' },
    used: true,
  })),
  {
    id: 'shift',
    label: 'SHIFT',
    hint: 'Press it. With SHIFT held, a pad deletes its hot cue.',
    target: { kind: 'button', control: 'shift', deck: 1 },
    used: true,
  },
  {
    id: 'shiftPad1',
    label: 'SHIFT + pad 1',
    hint: 'Hold SHIFT and press pad 1: some controllers send other notes then.',
    target: {
      kind: 'button',
      control: 'pad',
      deck: 1,
      index: 1,
      padMode: 'hotcue',
      shift: true,
    },
    used: true,
  },
  {
    id: 'filter',
    label: 'Filter knob',
    hint: 'Turn it from fully left to fully right.',
    target: { kind: 'absolute', control: 'filter', deck: 1 },
    used: true,
  },
  {
    id: 'tempo',
    label: 'Tempo slider',
    hint: 'Move it from the slowest end (−) to the fastest (+).',
    target: { kind: 'absolute', control: 'tempo', deck: 1 },
    used: true,
  },
  {
    id: 'volume',
    label: 'Channel fader',
    hint: 'Move it from the bottom to the top.',
    target: { kind: 'absolute', control: 'volume', deck: 1 },
    used: true,
  },
  {
    id: 'jog',
    label: 'Jog wheel',
    hint: 'Turn it to the right (clockwise) a little, then to the left.',
    target: { kind: 'relative', control: 'jog', deck: 1 },
    used: true,
  },
  {
    id: 'jogTouch',
    label: 'Touching the jog wheel',
    hint: 'Touch its top, and let go.',
    target: { kind: 'button', control: 'jogTouch', deck: 1 },
    used: false,
  },
  {
    id: 'sync',
    label: 'SYNC',
    hint: press,
    target: { kind: 'button', control: 'sync', deck: 1 },
    used: false,
  },
  {
    id: 'headphoneCue',
    label: 'Headphone cue',
    hint: press,
    target: { kind: 'button', control: 'headphoneCue', deck: 1 },
    used: false,
  },
  ...(
    [
      ['eqHigh', 'EQ high'],
      ['eqMid', 'EQ mid'],
      ['eqLow', 'EQ low'],
      ['trim', 'Trim (gain)'],
    ] as const
  ).map(([control, label]): LearnStep => ({
    id: control,
    label,
    hint: 'Turn it from fully left to fully right.',
    target: { kind: 'absolute', control, deck: 1 },
    used: false,
  })),
  {
    id: 'crossfader',
    label: 'Crossfader',
    hint: 'Move it from fully left to fully right.',
    target: { kind: 'absolute', control: 'crossfader' },
    used: false,
  },
  {
    id: 'masterLevel',
    label: 'Master level',
    hint: 'Turn it from fully left to fully right.',
    target: { kind: 'absolute', control: 'masterLevel' },
    used: false,
  },
  {
    id: 'browse',
    label: 'Browse knob',
    hint: 'Turn it to the right a few steps, then to the left.',
    target: { kind: 'relative', control: 'browse' },
    used: false,
  },
  {
    id: 'browsePress',
    label: 'Pressing the browse knob',
    hint: press,
    target: { kind: 'button', control: 'browsePress' },
    used: false,
  },
  {
    id: 'load',
    label: 'LOAD (deck 1)',
    hint: press,
    target: { kind: 'button', control: 'load', deck: 1 },
    used: false,
  },
  {
    id: 'play2',
    label: 'PLAY/PAUSE of deck 2',
    hint: press,
    target: { kind: 'button', control: 'play', deck: 2 },
    used: false,
  },
];

/**
 * The bindings learned, as a profile has them. Where SHIFT + pad 1 sent another message than
 * pad 1, the other pads are taken to do the same with SHIFT (the same step in channel or note).
 */
export function learnedBindings(
  learned: Readonly<Record<string, ControlBinding | null>>,
): ControlBinding[] {
  const bindings = LEARN_STEPS.flatMap((step) => {
    const binding = learned[step.id];
    return binding && step.id !== 'shiftPad1' ? [binding] : [];
  });
  const pad1 = learned['pad1'];
  const shifted = learned['shiftPad1'];
  if (shifted?.kind !== 'button') return bindings;
  if (
    pad1?.kind !== 'button' ||
    typeof pad1.data !== 'number' ||
    typeof shifted.data !== 'number'
  ) {
    return [...bindings, shifted];
  }
  const status = shifted.status - pad1.status;
  const data = shifted.data - pad1.data;
  if (status === 0 && data === 0) return bindings;
  const pads = bindings.flatMap((binding) =>
    binding.kind === 'button' &&
    binding.control === 'pad' &&
    typeof binding.data === 'number' &&
    binding.message === shifted.message
      ? [{ ...binding, status: binding.status + status, data: binding.data + data, shift: true }]
      : [],
  );
  return [
    ...bindings,
    ...pads.filter((binding) => binding.status <= 0xef && binding.data >= 0 && binding.data < 128),
  ];
}
