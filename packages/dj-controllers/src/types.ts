/**
 * The vocabulary of the library: the controls of a DJ controller by what they do, not by the
 * MIDI messages that carry them. An app maps them once, for every controller with a profile.
 */

/** Buttons, pads and touch sensors: pressed or released. */
export type ButtonControl =
  'play' | 'cue' | 'sync' | 'shift' | 'load' | 'headphoneCue' | 'pad' | 'jogTouch' | 'browsePress';

/** Knobs and faders: a position from 0 to 1 (0.5 in the middle of a knob with a centre). */
export type AbsoluteControl =
  | 'eqHigh'
  | 'eqMid'
  | 'eqLow'
  | 'trim'
  | 'filter'
  | 'volume'
  | 'tempo'
  | 'crossfader'
  | 'masterLevel'
  | 'headphoneLevel'
  | 'headphoneMix';

/** Jog wheels and encoders: a movement. */
export type RelativeControl = 'jog' | 'browse';

export type ControlId = ButtonControl | AbsoluteControl | RelativeControl;

/** What the performance pads do. Controllers such as the DDJ-FLX2 switch it themselves. */
export type PadMode = 'hotcue' | 'fx' | 'sampler' | 'loop' | 'beatjump';

interface EventBase {
  /** The profile of the device, e.g. "pioneer-ddj-flx2". */
  device: string;
  /** 1-based; null for the mixer's own controls (crossfader, master, browse). */
  deck: number | null;
  /** Whether SHIFT was held. */
  shift: boolean;
  /** When the message arrived, on the clock of performance.now(). */
  time: number;
}

export interface ButtonEvent extends EventBase {
  kind: 'button';
  control: ButtonControl;
  pressed: boolean;
  /** Pads: 1–8. */
  index?: number;
  /** Pads: the mode the controller is in. */
  padMode?: PadMode;
}

export interface AbsoluteEvent extends EventBase {
  kind: 'absolute';
  control: AbsoluteControl;
  /** 0–1. */
  value: number;
}

export interface RelativeEvent extends EventBase {
  kind: 'relative';
  control: RelativeControl;
  /** Steps since the last event (+ clockwise), or turns where the profile knows the steps. */
  delta: number;
}

export type ControlEvent = ButtonEvent | AbsoluteEvent | RelativeEvent;

/** A data byte, or an inclusive range of them for numbered controls (pads 1–8). */
export type DataBytes = number | readonly [first: number, last: number];

export interface ButtonBinding {
  kind: 'button';
  control: ButtonControl;
  deck?: number;
  /** The status byte of the note, e.g. 0x90 for channel 1; its note off (0x80) counts too. */
  status: number;
  data: DataBytes;
  padMode?: PadMode;
  /** The controller sends these notes while SHIFT is held (on another channel or note). */
  shift?: boolean;
}

export interface AbsoluteBinding {
  kind: 'absolute';
  control: AbsoluteControl;
  deck?: number;
  /** The status byte of the control change, e.g. 0xb0 for channel 1. */
  status: number;
  /** The controller number of the value, or of its coarse part for a 14-bit value. */
  msb: number;
  /** The controller number of the fine part of a 14-bit value, which comes after the coarse. */
  lsb?: number;
  /** The highest value, where a control stops short of 127 (or of 16,383 with 14 bits). */
  max?: number;
  /** For controls whose values run the other way. */
  invert?: boolean;
}

export interface RelativeBinding {
  kind: 'relative';
  control: RelativeControl;
  deck?: number;
  status: number;
  data: number;
  /** How a movement is written: 64 ± n, n or 128 − n, or n with a sign bit (64 + n for −n). */
  encoding: 'offset64' | 'twosComplement' | 'signBit';
  /** Steps in one turn, so that events carry turns; without it they carry steps. */
  perTurn?: number;
}

export type ControlBinding = ButtonBinding | AbsoluteBinding | RelativeBinding;

/** A light, named like the control it belongs to. */
export interface LightTarget {
  control: ButtonControl;
  deck?: number | null;
  /** Pads: 1–8. */
  index?: number;
  padMode?: PadMode;
  /** The lights that show while SHIFT is held (the pads of the DDJ-FLX2 have both). */
  shift?: boolean;
}

export type LightState = 'off' | 'on' | 'dim' | 'blink';

export interface LightBinding {
  control: ButtonControl;
  deck?: number;
  padMode?: PadMode;
  shift?: boolean;
  /** The note that sets the light, e.g. 0x90 (note on, channel 1). */
  status: number;
  data: DataBytes;
  /** The velocities for on, off and dim: 0x7f, 0 and (by default) the same as off. */
  on?: number;
  off?: number;
  dim?: number;
}

/** What the library knows about one controller model: plain data, so profiles can be shared. */
export interface ControllerProfile {
  id: string;
  name: string;
  /** Found in the names of the MIDI ports the browser reports (ignoring case). */
  ports: { input: string; output?: string };
  decks: number;
  controls: readonly ControlBinding[];
  lights?: readonly LightBinding[];
  /** Messages to send when the controller connects, and before it is let go. */
  onConnect?: readonly (readonly number[])[];
  onDisconnect?: readonly (readonly number[])[];
}
