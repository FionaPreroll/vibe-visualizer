import type {
  AbsoluteBinding,
  ButtonBinding,
  ControlEvent,
  ControllerProfile,
  DataBytes,
  RelativeBinding,
} from './types';

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

/** The bytes a data byte or range stands for, each with its index (1-based within a range). */
export function dataBytes(data: DataBytes): { byte: number; index: number | undefined }[] {
  if (typeof data === 'number') return [{ byte: data, index: undefined }];
  const [first, last] = data;
  const bytes: { byte: number; index: number | undefined }[] = [];
  for (let byte = first; byte <= last; byte++) bytes.push({ byte, index: byte - first + 1 });
  return bytes;
}

type Change =
  | { binding: AbsoluteBinding; part: 'msb' | 'lsb' }
  | { binding: RelativeBinding; part: 'relative' };

/** Turns the MIDI messages of one controller into control events, following its profile. */
export class Decoder {
  private readonly notes = new Map<number, { binding: ButtonBinding; index?: number }>();
  private readonly changes = new Map<number, Change>();
  /** The coarse part of each 14-bit control, until its fine part arrives. */
  private readonly coarse = new Map<AbsoluteBinding, number>();
  /** Whether SHIFT is held, per deck. */
  private readonly shifted = new Map<number, boolean>();

  constructor(readonly profile: ControllerProfile) {
    for (const binding of profile.controls) {
      if (binding.kind === 'button') {
        const status = NOTE_ON | (binding.status & 0x0f);
        for (const { byte, index } of dataBytes(binding.data)) {
          this.notes.set(key(status, byte), index === undefined ? { binding } : { binding, index });
        }
      } else if (binding.kind === 'absolute') {
        this.changes.set(key(binding.status, binding.msb), { binding, part: 'msb' });
        if (binding.lsb !== undefined) {
          this.changes.set(key(binding.status, binding.lsb), { binding, part: 'lsb' });
        }
      } else {
        this.changes.set(key(binding.status, binding.data), { binding, part: 'relative' });
      }
    }
  }

  /** Whether SHIFT is held on `deck`, or on any deck for the mixer's own controls. */
  shift(deck: number | null): boolean {
    if (deck !== null) return this.shifted.get(deck) ?? false;
    return [...this.shifted.values()].includes(true);
  }

  /** The event of one message, or null: not in the profile, or the coarse part of a value. */
  decode(message: ArrayLike<number>, time: number): ControlEvent | null {
    const status = message[0] ?? 0;
    const data1 = message[1] ?? 0;
    const data2 = message[2] ?? 0;
    const type = status & 0xf0;
    const device = this.profile.id;
    if (type === NOTE_ON || type === NOTE_OFF) {
      const hit = this.notes.get(key(NOTE_ON | (status & 0x0f), data1));
      if (!hit) return null;
      const { binding, index } = hit;
      const deck = binding.deck ?? null;
      const pressed = type === NOTE_ON && data2 > 0;
      if (binding.control === 'shift' && deck !== null) this.shifted.set(deck, pressed);
      return {
        kind: 'button',
        control: binding.control,
        device,
        deck,
        pressed,
        shift: binding.shift ?? this.shift(deck),
        time,
        ...(index !== undefined ? { index } : {}),
        ...(binding.padMode ? { padMode: binding.padMode } : {}),
      };
    }
    if (type !== CONTROL_CHANGE) return null;
    const hit = this.changes.get(key(status, data1));
    if (!hit) return null;
    const deck = hit.binding.deck ?? null;
    const shift = this.shift(deck);
    if (hit.part === 'relative') {
      const { binding } = hit;
      const delta = relative(data2, binding.encoding) / (binding.perTurn ?? 1);
      return { kind: 'relative', control: binding.control, device, deck, shift, time, delta };
    }
    const { binding } = hit;
    if (hit.part === 'msb' && binding.lsb !== undefined) {
      this.coarse.set(binding, data2);
      return null;
    }
    const raw = hit.part === 'lsb' ? ((this.coarse.get(binding) ?? 0) << 7) | data2 : data2;
    const max = binding.max ?? (binding.lsb !== undefined ? 0x3fff : 0x7f);
    const value = Math.min(1, raw / max);
    return {
      kind: 'absolute',
      control: binding.control,
      device,
      deck,
      shift,
      time,
      value: binding.invert ? 1 - value : value,
    };
  }
}

function key(status: number, data: number): number {
  return (status << 8) | data;
}

function relative(value: number, encoding: RelativeBinding['encoding']): number {
  switch (encoding) {
    case 'offset64':
      return value - 64;
    case 'twosComplement':
      return value < 64 ? value : value - 128;
    case 'signBit':
      return value & 0x40 ? -(value & 0x3f) : value & 0x3f;
  }
}
