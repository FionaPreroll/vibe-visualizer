import type {
  AbsoluteControl,
  ButtonControl,
  ControlBinding,
  ControllerProfile,
  DataBytes,
  LightBinding,
  PadMode,
  RelativeControl,
} from './types';

/**
 * Profiles as files: a profile someone made by MIDI learn, exported and imported again, or sent
 * to be built in. What comes from a file is checked: only plain bindings of known controls, with
 * MIDI bytes in range, are kept.
 */

const BUTTONS: Record<ButtonControl, true> = {
  play: true,
  cue: true,
  sync: true,
  shift: true,
  load: true,
  headphoneCue: true,
  pad: true,
  jogTouch: true,
  browsePress: true,
};
const ABSOLUTES: Record<AbsoluteControl, true> = {
  eqHigh: true,
  eqMid: true,
  eqLow: true,
  trim: true,
  filter: true,
  volume: true,
  tempo: true,
  crossfader: true,
  masterLevel: true,
  headphoneLevel: true,
  headphoneMix: true,
};
const RELATIVES: Record<RelativeControl, true> = { jog: true, browse: true };
const PAD_MODES: Record<PadMode, true> = {
  hotcue: true,
  fx: true,
  sampler: true,
  loop: true,
  beatjump: true,
};
const ENCODINGS = ['offset64', 'twosComplement', 'signBit'] as const;

/** At most this many bindings, lights and messages: no real controller has more. */
const MOST = 1024;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isByte = (value: unknown, max = 127): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
/** A status byte of a channel message (note off up to pitch bend). */
const isStatus = (value: unknown): value is number =>
  isByte(value, 0xef) && (value as number) >= 0x80;
const has = <T extends string>(set: Record<T, true>, value: unknown): value is T =>
  typeof value === 'string' && Object.hasOwn(set, value);
const text = (value: unknown, length: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, length) : null;

function dataBytes(value: unknown): DataBytes | null {
  if (isByte(value)) return value;
  if (Array.isArray(value) && value.length === 2 && value.every((byte) => isByte(byte))) {
    const [first, last] = value as [number, number];
    return first <= last ? [first, last] : null;
  }
  return null;
}

/** The optional fields every binding may have, checked. */
function common(fields: Fields): {
  deck?: number;
  index?: number;
  padMode?: PadMode;
  shift?: true;
} {
  return {
    ...(Number.isInteger(fields['deck']) && (fields['deck'] as number) >= 1
      ? { deck: Math.min(8, fields['deck'] as number) }
      : {}),
    ...(Number.isInteger(fields['index']) &&
    (fields['index'] as number) >= 1 &&
    (fields['index'] as number) <= 16
      ? { index: fields['index'] as number }
      : {}),
    ...(has(PAD_MODES, fields['padMode']) ? { padMode: fields['padMode'] } : {}),
    ...(fields['shift'] === true ? { shift: true as const } : {}),
  };
}

function binding(value: unknown): ControlBinding | null {
  if (!isObject(value) || !isStatus(value['status'])) return null;
  const status = value['status'];
  const deck = common(value).deck;
  const withDeck = deck !== undefined ? { deck } : {};
  if (value['kind'] === 'button' && has(BUTTONS, value['control'])) {
    const data = dataBytes(value['data']);
    if (data === null) return null;
    return {
      kind: 'button',
      control: value['control'],
      ...common(value),
      ...(value['message'] === 'control' ? { message: 'control' as const } : {}),
      status,
      data,
    };
  }
  if (value['kind'] === 'absolute' && has(ABSOLUTES, value['control'])) {
    if (!isByte(value['msb'])) return null;
    return {
      kind: 'absolute',
      control: value['control'],
      ...withDeck,
      status,
      msb: value['msb'],
      ...(isByte(value['lsb']) ? { lsb: value['lsb'] } : {}),
      ...(isByte(value['max'], 0x3fff) && (value['max'] as number) > 0
        ? { max: value['max'] as number }
        : {}),
      ...(value['invert'] === true ? { invert: true } : {}),
    };
  }
  if (value['kind'] === 'relative' && has(RELATIVES, value['control'])) {
    const encoding = ENCODINGS.find((name) => name === value['encoding']);
    if (!isByte(value['data']) || !encoding) return null;
    const perTurn = value['perTurn'];
    return {
      kind: 'relative',
      control: value['control'],
      ...withDeck,
      status,
      data: value['data'],
      encoding,
      ...(typeof perTurn === 'number' && perTurn > 0 && perTurn < 100_000 ? { perTurn } : {}),
    };
  }
  return null;
}

function light(value: unknown): LightBinding | null {
  if (!isObject(value) || !has(BUTTONS, value['control']) || !isStatus(value['status'])) {
    return null;
  }
  const data = dataBytes(value['data']);
  if (data === null) return null;
  const velocity = (name: 'on' | 'off' | 'dim') =>
    isByte(value[name]) ? { [name]: value[name] as number } : {};
  return {
    control: value['control'],
    ...common(value),
    status: value['status'],
    data,
    ...velocity('on'),
    ...velocity('off'),
    ...velocity('dim'),
  };
}

function messages(value: unknown): number[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (message): message is number[] =>
        Array.isArray(message) &&
        message.length >= 1 &&
        message.length <= 16 &&
        isStatus(message[0]) &&
        message.slice(1).every((byte) => isByte(byte)),
    )
    .slice(0, MOST);
}

/** A profile from a file, checked; null when it is none, or has no control the app can use. */
export function sanitizeProfile(value: unknown): ControllerProfile | null {
  if (!isObject(value) || !isObject(value['ports'])) return null;
  const id = text(value['id'], 80);
  const name = text(value['name'], 120);
  const input = text(value['ports']['input'], 120);
  const output = text(value['ports']['output'], 120);
  if (!id || !name || !input || !Array.isArray(value['controls'])) return null;
  const controls = value['controls']
    .slice(0, MOST)
    .map(binding)
    .filter((entry) => entry !== null);
  if (controls.length === 0) return null;
  const lights = Array.isArray(value['lights'])
    ? value['lights']
        .slice(0, MOST)
        .map(light)
        .filter((entry) => entry !== null)
    : [];
  const onConnect = messages(value['onConnect']);
  const onDisconnect = messages(value['onDisconnect']);
  const decks = Number.isInteger(value['decks'])
    ? Math.min(8, Math.max(1, value['decks'] as number))
    : 1;
  return {
    id,
    name,
    ports: { input, ...(output ? { output } : {}) },
    decks,
    controls,
    ...(lights.length > 0 ? { lights } : {}),
    ...(onConnect?.length ? { onConnect } : {}),
    ...(onDisconnect?.length ? { onDisconnect } : {}),
  };
}
