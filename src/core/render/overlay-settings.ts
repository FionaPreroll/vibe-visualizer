/**
 * The track info over the visuals (LS-18, LS-19): the title and artist of the track playing, and
 * on request a bar of its progress and its time. It fades in at the start of each track's part
 * and out before its end, and if it is not kept, after a while. It is drawn over both modes, in
 * the preview and in exports, and is not part of the presets.
 */

export type OverlayFont = 'sans' | 'condensed' | 'serif' | 'mono' | 'script' | 'tech';
export const OVERLAY_FONTS: readonly OverlayFont[] = [
  'sans',
  'condensed',
  'serif',
  'mono',
  'script',
  'tech',
];

/** Where the text sits in the frame, row by row from the top left. */
export type OverlayPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';
export const OVERLAY_POSITIONS: readonly OverlayPosition[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export interface OverlaySettings {
  /** Shows the title and artist of the track playing (LS-18). */
  on: boolean;
  font: OverlayFont;
  /** Size of the letters, relative to the default. */
  size: number;
  position: OverlayPosition;
  color: string;
  /** Seconds the text takes to fade in at the start of a track, and to fade out. */
  fade: number;
  /** Seconds it stays before it fades out; 0: as long as the track plays. */
  hold: number;
  /** A bar of the track's progress under the text (LS-19). */
  progress: boolean;
  /** The time played and the length of the track (LS-19). */
  time: boolean;
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  on: false,
  font: 'sans',
  size: 1,
  position: 'bottom-left',
  color: '#ffffff',
  fade: 1.5,
  hold: 0,
  progress: false,
  time: false,
};

export const OVERLAY_RANGES = {
  size: [0.5, 2],
  fade: [0, 5],
  hold: [0, 60],
} as const satisfies Record<string, readonly [number, number]>;

const COLOR = /^#[0-9a-f]{6}$/i;

/** Stored overlay settings over the defaults: unknown or mistyped values are dropped. */
export function sanitizeOverlay(value: unknown): OverlaySettings {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const result = { ...DEFAULT_OVERLAY };
  const flag = (key: 'on' | 'progress' | 'time') => {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  };
  flag('on');
  flag('progress');
  flag('time');
  const font = input['font'];
  if (typeof font === 'string' && (OVERLAY_FONTS as string[]).includes(font)) {
    result.font = font as OverlayFont;
  }
  const position = input['position'];
  if (typeof position === 'string' && (OVERLAY_POSITIONS as string[]).includes(position)) {
    result.position = position as OverlayPosition;
  }
  const color = input['color'];
  if (typeof color === 'string' && COLOR.test(color)) result.color = color;
  for (const key of Object.keys(OVERLAY_RANGES) as (keyof typeof OVERLAY_RANGES)[]) {
    const number = input[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) continue;
    const [min, max] = OVERLAY_RANGES[key];
    result[key] = Math.min(max, Math.max(min, number));
  }
  return result;
}

/** A track as the overlay shows it. */
export interface OverlayTrack {
  title: string;
  artist: string | null;
  /** Where the track's part starts and ends in its file (seconds). */
  start: number;
  end: number;
}

function smoothstep(from: number, to: number, x: number): number {
  if (to <= from) return x >= from ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of the overlay shows (0…1) at `position` (seconds in the file) of `track`, played at
 * `rate`: it fades in from the start of the track's part, out again `hold` seconds later if that
 * is set, and out before the end of the part. Times count as heard, at the tempo.
 */
export function overlayAlpha(
  settings: OverlaySettings,
  track: OverlayTrack,
  position: number,
  rate = 1,
): number {
  const elapsed = (position - track.start) / rate;
  const remaining = (track.end - position) / rate;
  if (elapsed < 0 || remaining <= 0) return 0;
  const fade = settings.fade;
  let alpha = smoothstep(0, fade, elapsed) * smoothstep(0, fade, remaining);
  if (settings.hold > 0)
    alpha *= 1 - smoothstep(fade + settings.hold, 2 * fade + settings.hold, elapsed);
  return alpha;
}

/** The share of the track's part played at `position` (0…1). */
export function overlayProgress(track: OverlayTrack, position: number): number {
  const length = track.end - track.start;
  return length > 0 ? Math.min(1, Math.max(0, (position - track.start) / length)) : 0;
}

/** Minutes and seconds, with hours when needed: 0:07, 3:07, 1:02:03. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** The time of the overlay: played and the length of the part, at the tempo ("1:23 / 4:56"). */
export function overlayTime(track: OverlayTrack, position: number, rate = 1): string {
  const played = Math.min(track.end, Math.max(track.start, position)) - track.start;
  return `${clockText(played / rate)} / ${clockText((track.end - track.start) / rate)}`;
}
