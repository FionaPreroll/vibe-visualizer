import type {
  AbsoluteBinding,
  AbsoluteControl,
  ButtonBinding,
  ButtonControl,
  ControlBinding,
  ControllerProfile,
  LightBinding,
  PadMode,
  RelativeBinding,
  RelativeControl,
} from './types';

/**
 * MIDI learn: a binding from the messages a control sent while the user moved it, for
 * controllers without a profile. The bindings of several controls make a profile of their own.
 */

const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

interface TargetBase {
  deck?: number;
}

/** The control to learn, by what it does, as the profile will name it. */
export type LearnTarget =
  | (TargetBase & {
      kind: 'button';
      control: ButtonControl;
      /** Pads: 1–8. */
      index?: number;
      padMode?: PadMode;
      shift?: boolean;
    })
  /** Moved from its lowest to its highest position, so its direction is known. */
  | (TargetBase & { kind: 'absolute'; control: AbsoluteControl })
  /** Turned clockwise (to the right) first, so the encoding of its steps is known. */
  | (TargetBase & { kind: 'relative'; control: RelativeControl });

/** The binding the messages of one control suggest, or null when none fits. */
export function learnBinding(
  target: LearnTarget,
  messages: readonly (readonly number[])[],
): ControlBinding | null {
  const valid = messages.filter(
    (message) =>
      message.length >= 3 && message.slice(1, 3).every((byte) => byte >= 0 && byte < 128),
  );
  if (target.kind === 'button') return learnButton(target, valid);
  if (target.kind === 'absolute') return learnAbsolute(target, valid);
  return learnRelative(target, valid);
}

function learnButton(
  target: Extract<LearnTarget, { kind: 'button' }>,
  messages: readonly (readonly number[])[],
): ButtonBinding | null {
  const common = {
    kind: 'button' as const,
    control: target.control,
    ...(target.deck !== undefined ? { deck: target.deck } : {}),
    ...(target.index !== undefined ? { index: target.index } : {}),
    ...(target.padMode ? { padMode: target.padMode } : {}),
    ...(target.shift ? { shift: true } : {}),
  };
  // A note pressed; else a control change that goes above 0 (a button that sends 127 and 0).
  const note = messages.find(
    ([status = 0, , velocity = 0]) => type(status) === NOTE_ON && velocity > 0,
  );
  if (note) return { ...common, status: note[0]!, data: note[1]! };
  const change = messages.find(
    ([status = 0, , value = 0]) => type(status) === CONTROL_CHANGE && value > 0,
  );
  if (!change) return null;
  return { ...common, message: 'control', status: change[0]!, data: change[1]! };
}

/** The control changes, by status and controller number, the most frequent first. */
function changesByNumber(messages: readonly (readonly number[])[]): (readonly number[])[][] {
  const groups = new Map<number, (readonly number[])[]>();
  for (const message of messages) {
    if (type(message[0]!) !== CONTROL_CHANGE) continue;
    const at = (message[0]! << 8) | message[1]!;
    const group = groups.get(at) ?? [];
    group.push(message);
    groups.set(at, group);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function learnAbsolute(
  target: Extract<LearnTarget, { kind: 'absolute' }>,
  messages: readonly (readonly number[])[],
): AbsoluteBinding | null {
  const groups = changesByNumber(messages);
  // The coarse part of a 14-bit value is the lower number of a pair 32 apart (0–31 and 32–63).
  let coarse = groups[0];
  if (!coarse) return null;
  const number = (group: readonly (readonly number[])[]) => group[0]![1]!;
  const status = coarse[0]![0]!;
  const partner = (n: number) =>
    groups.find((group) => group[0]![0] === status && number(group) === n);
  if (number(coarse) >= 32 && number(coarse) < 64) coarse = partner(number(coarse) - 32) ?? coarse;
  const fine = number(coarse) < 32 ? partner(number(coarse) + 32) : undefined;
  // Moved from its lowest to its highest: a control whose values fall runs the other way.
  const values = coarse.map((message) => message[2]!);
  const invert = values.length > 1 && values.at(-1)! < values[0]!;
  return {
    kind: 'absolute',
    control: target.control,
    ...(target.deck !== undefined ? { deck: target.deck } : {}),
    status,
    msb: number(coarse),
    ...(fine && fine.length * 2 >= coarse.length ? { lsb: number(fine) } : {}),
    ...(invert ? { invert: true } : {}),
  };
}

function learnRelative(
  target: Extract<LearnTarget, { kind: 'relative' }>,
  messages: readonly (readonly number[])[],
): RelativeBinding | null {
  const group = changesByNumber(messages)[0];
  if (!group) return null;
  const values = group.map((message) => message[2]!).filter((value) => value !== 64 && value !== 0);
  const first = values[0];
  if (first === undefined) return null;
  // Turned clockwise first: 65 and up is 64 + n; small values are n, and the other way either
  // 128 − n (127, 126 …) or n with a sign bit (65, 66 …).
  let encoding: RelativeBinding['encoding'] = 'twosComplement';
  if (first > 64) encoding = 'offset64';
  else if (!values.some((value) => value >= 96) && values.some((value) => value > 64)) {
    encoding = 'signBit';
  }
  return {
    kind: 'relative',
    control: target.control,
    ...(target.deck !== undefined ? { deck: target.deck } : {}),
    status: group[0]![0]!,
    data: group[0]![1]!,
    encoding,
  };
}

/**
 * The lights of learned buttons: most controllers light a button when they get its own note
 * back (127 on, 0 off). Buttons that send control changes get theirs back as control changes.
 */
export function guessLights(controls: readonly ControlBinding[]): LightBinding[] {
  const lights: LightBinding[] = [];
  for (const binding of controls) {
    if (binding.kind !== 'button' || binding.control === 'shift') continue;
    if (binding.control === 'jogTouch' || binding.control === 'browsePress') continue;
    const status =
      binding.message === 'control' ? binding.status : NOTE_ON | (binding.status & 0x0f);
    lights.push({
      control: binding.control,
      ...(binding.deck !== undefined ? { deck: binding.deck } : {}),
      ...(binding.index !== undefined ? { index: binding.index } : {}),
      ...(binding.padMode ? { padMode: binding.padMode } : {}),
      ...(binding.shift ? { shift: true } : {}),
      status,
      data: binding.data,
    });
  }
  return lights;
}

/** A profile of learned bindings for the device whose input port is `port`. */
export function learnedProfile(
  port: string,
  name: string,
  controls: readonly ControlBinding[],
  lights: boolean,
): ControllerProfile {
  const decks = Math.max(1, ...controls.map((binding) => binding.deck ?? 1));
  return {
    id: `learned-${slug(port)}`,
    name,
    ports: { input: port },
    decks,
    controls: [...controls],
    ...(lights ? { lights: guessLights(controls) } : {}),
  };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'controller'
  );
}

function type(status: number): number {
  return status & 0xf0;
}
