import {
  BUILT_IN_KALEIDO_PRESETS,
  kaleidoLook,
  sanitizeKaleido,
  type KaleidoSettings,
} from './kaleido-settings';

/**
 * Parameters of the Logo Spectrum mode (LS-*), with palettes and built-in presets (PR-01).
 * Flat and JSON-serialisable (but for the Kaleidoscope behind, which is a Kaleidoscope look):
 * stored in the app state, recorded as timestamped actions and sent to the render worker as
 * they are.
 */

export const PALETTES = {
  rainbow: ['#ff3b5c', '#ff8a3d', '#ffd23d', '#4dff88', '#3de0ff', '#4d7aff', '#a45cff', '#ff5ce1'],
  neon: ['#ff2fd6', '#8f3dff', '#2f7dff', '#1ff0ff', '#ff2fd6', '#8f3dff', '#2f7dff', '#1ff0ff'],
  fire: ['#ffe066', '#ffb03b', '#ff7a1f', '#ff4a1a', '#e3261d', '#b3122e', '#7a0c32', '#4a0a2e'],
  ice: ['#e8fbff', '#b3f0ff', '#7ddfff', '#45c2ff', '#2a8cff', '#3056e8', '#3a33c2', '#2e1f8f'],
  mono: ['#f2f2f2', '#d4d4d4', '#b3b3b3', '#949494', '#767676', '#5a5a5a', '#404040', '#2b2b2b'],
  pastel: ['#ffb3c7', '#ffd1a8', '#fff0a8', '#c2f5c0', '#a8e8f5', '#b8c4ff', '#dcb8ff', '#ffb8ec'],
  sunset: ['#ffd36e', '#ff9e5e', '#ff6f69', '#e0527d', '#b94593', '#8543a6', '#5642a8', '#2f3f99'],
  toxic: ['#d4ff3d', '#8cff3d', '#3dff6e', '#3dffc2', '#3dd4ff', '#8c3dff', '#d43dff', '#ff3d9e'],
} as const;

export type PaletteName = keyof typeof PALETTES | 'custom';
export const PALETTE_NAMES = [...Object.keys(PALETTES), 'custom'] as PaletteName[];

export const MAX_LAYERS = 8;

/** How the spectrum is drawn around the ring (LS-11). */
export type RingStyle = 'blob' | 'bars' | 'lines' | 'dots';
export const RING_STYLES: readonly RingStyle[] = ['blob', 'bars', 'lines', 'dots'];
/** Which way the spectrum grows from the ring. */
export type RingDirection = 'outward' | 'inward' | 'both';
export const RING_DIRECTIONS: readonly RingDirection[] = ['outward', 'inward', 'both'];
/** What the background shows (VE-08): the image (or the default), or the Kaleidoscope, live. */
export type BackgroundSource = 'image' | 'kaleidoscope';
export const BACKGROUND_SOURCES: readonly BackgroundSource[] = ['image', 'kaleidoscope'];

export interface LogoSpectrumSettings {
  // Background (LS-01…03, VE-08)
  backgroundSource: BackgroundSource;
  /**
   * The Kaleidoscope behind the ring when the background shows it (VE-08): a look of its own
   * that belongs to this one, so presets and the switching carry it; null: the Kaleidoscope
   * as it is set up in its own mode.
   */
  layerLook: KaleidoSettings | null;
  backgroundFit: 'cover' | 'contain';
  /** 0…1 */
  backgroundBlur: number;
  /** 0…1: how much darker the background gets. */
  backgroundDim: number;
  /** 0…1: zoom pulse on the bass. */
  backgroundPulse: number;
  /** −1…1: which part of a cropped ("cover") image is shown. */
  backgroundX: number;
  backgroundY: number;
  /** Colour the background is tinted towards, and how much (0…1). */
  backgroundTint: string;
  backgroundTintAmount: number;

  // Motion (LS-03; the bass zoom is backgroundPulse)
  /** 0…1: the picture shakes on kicks. */
  shake: number;
  /** 0…1: the background drifts and zooms slowly (Ken Burns). */
  drift: number;

  // Spectrum ring (LS-05…11)
  /** Filled shape, bars, lines or dots. */
  ringStyle: RingStyle;
  /** Out from the ring, in towards the logo, or both ways. */
  ringDirection: RingDirection;
  /** Number of bars around the ring (bars and dots). */
  bars: number;
  /** 0…1: width of the bars, dots and lines. */
  thickness: number;
  palette: PaletteName;
  /**
   * Colours of the layers behind the top layer, from the one next to the top layer to the
   * back (used with the palette "custom").
   */
  customColors: string[];
  /** Colour of the top layer. */
  topColor: string;
  /** Number of colour layers behind the top layer (0…MAX_LAYERS). */
  layers: number;
  /** How far the layers lag behind each other, in seconds. */
  layerDelay: number;
  /** Extra size of each layer behind the one in front, relative to the ring radius. */
  layerSpread: number;
  /** Hue rotation speed, in turns per minute (0 = off). */
  hueCycle: number;
  /** Ring radius relative to the shorter side of the picture. */
  ringRadius: number;
  /** Maximum spectrum height relative to the ring radius. */
  amplitude: number;
  /** Lowest and highest frequency shown around the ring, in Hz. */
  minFrequency: number;
  maxFrequency: number;
  /** Mirror left and right (bass at the top); otherwise the spectrum goes once around. */
  mirror: boolean;
  /** Rotation of the ring, in degrees. */
  rotation: number;
  /** Constant spin, in turns per minute. */
  spin: number;
  /** 0…1: soft glow around the ring. */
  glow: number;
  /** Reach of the glow, relative to the ring radius. */
  glowRadius: number;
  /** Position of the ring and logo: offset from the centre, as a fraction of width / height. */
  centerX: number;
  centerY: number;

  // Responsiveness (LS-08)
  /** Gain on the spectrum. */
  sensitivity: number;
  /** Rise and fall times, in seconds. */
  attack: number;
  release: number;
  /** 0…1: smoothing along the ring. */
  smoothing: number;
  /** 0…1: values below this count as silence. */
  threshold: number;
  /** −1…1: more bass (negative) or more treble (positive). */
  tilt: number;

  // Logo (LS-12…14)
  /** Logo diameter relative to the ring diameter. */
  logoSize: number;
  /** Zoom and pan of the image inside the circle. */
  logoZoom: number;
  logoPanX: number;
  logoPanY: number;
  /** Rim width relative to the logo radius, and its colour. */
  rimWidth: number;
  rimColor: string;
  /** 0…1: shadow and glow around the logo. */
  logoShadow: number;
  /** 0…1: how much the logo (and the ring) grows with the bass. */
  bassPulse: number;
  /**
   * Turns per minute of the logo (or the cover art) with the music, like a record (LS-16): it
   * stands while paused and turns faster or slower with the tempo; 0: it does not turn.
   */
  logoSpin: number;

  // Particles (LS-17)
  /** Number of particles (0 = off). */
  particles: number;
  particleSize: number;
  /** Base speed; the music adds to it. */
  particleSpeed: number;

  // Post
  /** 0…1: bloom on bright parts. */
  bloom: number;
}

/** The look the presets start from. */
const CLASSIC: LogoSpectrumSettings = {
  backgroundSource: 'image',
  layerLook: null,
  backgroundFit: 'cover',
  backgroundBlur: 0.15,
  backgroundDim: 0.35,
  backgroundPulse: 0.3,
  backgroundX: 0,
  backgroundY: 0,
  backgroundTint: '#8f3dff',
  backgroundTintAmount: 0,
  shake: 0,
  drift: 0,
  ringStyle: 'blob',
  ringDirection: 'outward',
  bars: 96,
  thickness: 0.5,
  palette: 'rainbow',
  customColors: [...PALETTES.rainbow],
  topColor: '#ffffff',
  layers: 6,
  layerDelay: 0.08,
  layerSpread: 0.02,
  hueCycle: 0,
  ringRadius: 0.2,
  amplitude: 0.55,
  minFrequency: 30,
  maxFrequency: 12000,
  mirror: true,
  rotation: 0,
  spin: 0,
  glow: 0.5,
  glowRadius: 0.2,
  centerX: 0,
  centerY: 0,
  sensitivity: 1,
  attack: 0.03,
  release: 0.18,
  smoothing: 0.35,
  threshold: 0.3,
  tilt: -0.2,
  logoSize: 0.92,
  logoZoom: 1,
  logoPanX: 0,
  logoPanY: 0,
  rimWidth: 0.04,
  rimColor: '#ffffff',
  logoShadow: 0.5,
  bassPulse: 0.5,
  logoSpin: 0,
  particles: 220,
  particleSize: 1,
  particleSpeed: 1,
  bloom: 0.25,
};

/** Quick presets for the responsiveness controls (LS-08). */
export const RESPONSIVENESS = {
  smooth: { attack: 0.08, release: 0.35, smoothing: 0.6, sensitivity: 0.9, threshold: 0.3 },
  punchy: { attack: 0.02, release: 0.16, smoothing: 0.35, sensitivity: 1.1, threshold: 0.35 },
  twitchy: { attack: 0.005, release: 0.06, smoothing: 0.12, sensitivity: 1.2, threshold: 0.3 },
} as const satisfies Record<string, Partial<LogoSpectrumSettings>>;

export type ResponsivenessName = keyof typeof RESPONSIVENESS;

export interface VisualPreset {
  name: string;
  settings: LogoSpectrumSettings;
  builtIn: boolean;
}

function preset(name: string, changes: Partial<LogoSpectrumSettings>): VisualPreset {
  return { name, settings: { ...CLASSIC, ...changes }, builtIn: true };
}

/** A Kaleidoscope look to show behind the ring (VE-08): a built-in one by its name, or its own. */
function behind(look: string | KaleidoSettings): Partial<LogoSpectrumSettings> {
  const layerLook = typeof look === 'string' ? builtInKaleido(look) : look;
  // The Kaleidoscope moves by itself: few stars and no drift in front of it.
  return { backgroundSource: 'kaleidoscope', layerLook, particles: 90, drift: 0 };
}

function builtInKaleido(name: string): KaleidoSettings {
  const look = BUILT_IN_KALEIDO_PRESETS.find((entry) => entry.name === name);
  if (!look) throw new Error(`There is no Kaleidoscope preset "${name}".`);
  return look.settings;
}

/** The default until v1.0: what a look stored by an older version lacks comes from it. */
const CLASSIC_RAINBOW = preset('Classic Rainbow', { ...RESPONSIVENESS.twitchy });

export const BUILT_IN_PRESETS: readonly VisualPreset[] = [
  // The default: neon lines around a turning record, before a vortex in neon colours.
  preset('Blue-Pink Vortex', {
    palette: 'neon',
    customColors: [...PALETTES.ice],
    ringStyle: 'lines',
    ringRadius: 0.1472,
    amplitude: 0.4575,
    layers: 8,
    layerDelay: 0.16,
    layerSpread: 0.04,
    glow: 0.6,
    logoSpin: 100 / 3,
    backgroundDim: 0.3,
    ...RESPONSIVENESS.punchy,
    ...behind(kaleidoLook('vortex', { palette: 'neon' }, { swirl: 0.7, coreColor: '#b388ff' })),
  }),
  CLASSIC_RAINBOW,
  preset('Neon Night', {
    palette: 'neon',
    layers: 5,
    glow: 0.8,
    bloom: 0.45,
    hueCycle: 1,
    backgroundDim: 0.55,
    ...RESPONSIVENESS.punchy,
  }),
  preset('Inferno', {
    palette: 'fire',
    layers: 7,
    layerDelay: 0.05,
    amplitude: 0.7,
    topColor: '#fff4d6',
    rimColor: '#ffd9a0',
    particleSpeed: 1.6,
  }),
  preset('Glacier', {
    palette: 'ice',
    layers: 6,
    glow: 0.7,
    ...RESPONSIVENESS.smooth,
    particles: 320,
    particleSpeed: 0.6,
  }),
  preset('Minimal Mono', {
    palette: 'mono',
    layers: 2,
    glow: 0.2,
    bloom: 0.2,
    particles: 80,
    backgroundDim: 0.6,
    backgroundBlur: 0.4,
  }),
  preset('Pastel Dream', {
    palette: 'pastel',
    layers: 8,
    layerSpread: 0.04,
    layerDelay: 0.16,
    amplitude: 0.7,
    glow: 0.6,
    bloom: 0.15,
    ...RESPONSIVENESS.smooth,
  }),
  preset('Twitchy Toxic', {
    palette: 'toxic',
    layers: 6,
    amplitude: 0.65,
    ...RESPONSIVENESS.twitchy,
    spin: 2,
  }),
  preset('Sunset Drive', { palette: 'sunset', layers: 7, mirror: true, tilt: 0.1, glow: 0.6 }),
  preset('Neon Bars', {
    palette: 'neon',
    ringStyle: 'bars',
    ringDirection: 'both',
    bars: 72,
    thickness: 0.55,
    layers: 4,
    amplitude: 0.5,
    logoSize: 0.62,
    glow: 0.7,
    bloom: 0.4,
    shake: 0.35,
    ...RESPONSIVENESS.punchy,
  }),
  preset('Dot Matrix', {
    palette: 'toxic',
    ringStyle: 'dots',
    bars: 64,
    thickness: 0.6,
    layers: 3,
    amplitude: 0.8,
    glow: 0.5,
    backgroundDim: 0.5,
    ...RESPONSIVENESS.punchy,
  }),
  preset('Laser Lines', {
    palette: 'sunset',
    ringStyle: 'lines',
    ringDirection: 'both',
    thickness: 0.35,
    logoSize: 0.7,
    layers: 6,
    layerSpread: 0.03,
    glow: 0.8,
    bloom: 0.45,
    hueCycle: 2,
    drift: 0.5,
    backgroundTint: '#ff5ca8',
    backgroundTintAmount: 0.35,
    ...RESPONSIVENESS.smooth,
  }),
  // With the Kaleidoscope behind the ring (VE-08), so that the switching mixes both modes.
  preset('Mandala Core', {
    palette: 'neon',
    layers: 5,
    glow: 0.8,
    bloom: 0.45,
    backgroundDim: 0.35,
    ...RESPONSIVENESS.punchy,
    ...behind('Neon Mandala'),
  }),
  preset('Ember Record', {
    palette: 'fire',
    layers: 7,
    layerDelay: 0.05,
    amplitude: 0.7,
    topColor: '#fff4d6',
    rimColor: '#ffd9a0',
    logoSpin: 100 / 3,
    backgroundDim: 0.3,
    ...behind('Ember Vortex'),
  }),
  preset('Bloom Halo', {
    palette: 'ice',
    layers: 6,
    glow: 0.7,
    backgroundDim: 0.3,
    ...RESPONSIVENESS.smooth,
    ...behind('Neon Bloom'),
  }),
  preset('Ribbon Lines', {
    palette: 'sunset',
    ringStyle: 'lines',
    ringDirection: 'both',
    thickness: 0.35,
    logoSize: 0.7,
    layers: 6,
    layerSpread: 0.03,
    glow: 0.8,
    bloom: 0.45,
    backgroundDim: 0.4,
    ...RESPONSIVENESS.smooth,
    ...behind('Neon Ribbons'),
  }),
  preset('Aurora Disc', {
    palette: 'pastel',
    layers: 8,
    layerSpread: 0.04,
    layerDelay: 0.16,
    amplitude: 0.7,
    glow: 0.6,
    logoSpin: 100 / 3,
    backgroundDim: 0.3,
    ...RESPONSIVENESS.smooth,
    ...behind('Aurora Spiral'),
  }),
  preset('Lava Bars', {
    palette: 'fire',
    ringStyle: 'bars',
    ringDirection: 'both',
    bars: 72,
    thickness: 0.55,
    layers: 4,
    amplitude: 0.5,
    logoSize: 0.62,
    glow: 0.7,
    shake: 0.3,
    backgroundDim: 0.35,
    ...RESPONSIVENESS.punchy,
    ...behind('Lava Braid'),
  }),
];

/** The look of a first visit and of "Reset to defaults": the preset "Blue-Pink Vortex". */
export const DEFAULT_LOGO_SPECTRUM: LogoSpectrumSettings = BUILT_IN_PRESETS[0]!.settings;

type NumericKey = {
  [K in keyof LogoSpectrumSettings]: LogoSpectrumSettings[K] extends number ? K : never;
}[keyof LogoSpectrumSettings];

/** Allowed ranges of the numeric settings (also used by the UI sliders). */
export const RANGES: Record<NumericKey, readonly [number, number]> = {
  backgroundBlur: [0, 1],
  backgroundDim: [0, 1],
  backgroundPulse: [0, 1],
  backgroundX: [-1, 1],
  backgroundY: [-1, 1],
  backgroundTintAmount: [0, 1],
  shake: [0, 1],
  drift: [0, 1],
  bars: [16, 256],
  thickness: [0.05, 1],
  layers: [0, MAX_LAYERS],
  layerDelay: [0, 0.4],
  layerSpread: [0, 0.05],
  hueCycle: [0, 20],
  ringRadius: [0.08, 0.4],
  amplitude: [0, 1.5],
  minFrequency: [20, 2000],
  maxFrequency: [500, 16000],
  rotation: [-180, 180],
  spin: [-20, 20],
  glow: [0, 1],
  glowRadius: [0.05, 0.6],
  centerX: [-0.4, 0.4],
  centerY: [-0.4, 0.4],
  sensitivity: [0.2, 3],
  attack: [0.001, 0.3],
  release: [0.01, 1],
  smoothing: [0, 1],
  threshold: [0, 0.6],
  tilt: [-1, 1],
  logoSize: [0.3, 1],
  logoZoom: [1, 4],
  logoPanX: [-1, 1],
  logoPanY: [-1, 1],
  rimWidth: [0, 0.15],
  logoShadow: [0, 1],
  bassPulse: [0, 1],
  logoSpin: [0, 78],
  particles: [0, 600],
  particleSize: [0.3, 3],
  particleSpeed: [0, 4],
  bloom: [0, 1],
};

const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Takes whatever is stored (possibly from an older version) and returns valid settings:
 * unknown keys dropped, wrong types replaced by defaults, numbers clamped to their ranges.
 * Nothing stored gives the default look. What a look from an older version lacks comes from
 * Classic Rainbow, the default then, so that it stays as it was (no Kaleidoscope behind, a
 * logo that does not turn).
 */
export function sanitizeSettings(value: unknown): LogoSpectrumSettings {
  const input = (typeof value === 'object' && value !== null
    ? value
    : DEFAULT_LOGO_SPECTRUM) as unknown as Record<string, unknown>;
  const base = CLASSIC_RAINBOW.settings;
  const result = { ...base, customColors: [...base.customColors] };
  const target = result as unknown as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof LogoSpectrumSettings)[]) {
    const stored = input[key];
    const fallback = base[key];
    if (typeof fallback === 'number') {
      if (typeof stored !== 'number' || !Number.isFinite(stored)) continue;
      const [min, max] = RANGES[key as NumericKey];
      target[key] = Math.min(max, Math.max(min, stored));
    } else if (typeof fallback === 'boolean') {
      if (typeof stored === 'boolean') target[key] = stored;
    } else if (typeof fallback === 'string') {
      if (typeof stored !== 'string') continue;
      if (key === 'palette' && !(PALETTE_NAMES as string[]).includes(stored)) continue;
      if (key === 'backgroundFit' && stored !== 'cover' && stored !== 'contain') continue;
      if (key === 'backgroundSource' && !(BACKGROUND_SOURCES as string[]).includes(stored)) {
        continue;
      }
      if (key === 'ringStyle' && !(RING_STYLES as string[]).includes(stored)) continue;
      if (key === 'ringDirection' && !(RING_DIRECTIONS as string[]).includes(stored)) continue;
      if (
        (key === 'topColor' || key === 'rimColor' || key === 'backgroundTint') &&
        !COLOR.test(stored)
      ) {
        continue;
      }
      target[key] = stored;
    } else if (key === 'layerLook') {
      result.layerLook =
        typeof stored === 'object' && stored !== null ? sanitizeKaleido(stored) : null;
    } else if (Array.isArray(stored)) {
      const colors = stored.filter((color) => typeof color === 'string' && COLOR.test(color));
      if (colors.length === MAX_LAYERS) result.customColors = colors as string[];
    }
  }
  result.layers = Math.round(result.layers);
  result.particles = Math.round(result.particles);
  result.bars = Math.round(result.bars);
  if (result.maxFrequency < result.minFrequency * 2) result.maxFrequency = result.minFrequency * 2;
  return result;
}

/** The speeds of a record (LS-16), in turns per minute; 0: the logo does not turn. */
export const RECORD_SPEEDS: readonly { rpm: number; label: string }[] = [
  { rpm: 0, label: 'Off' },
  { rpm: 100 / 3, label: '33⅓ rpm' },
  { rpm: 45, label: '45 rpm' },
  { rpm: 78, label: '78 rpm' },
];

/** The layer colours, from the layer next to the top layer to the back. */
export function layerColors(settings: LogoSpectrumSettings): readonly string[] {
  return settings.palette === 'custom' ? settings.customColors : PALETTES[settings.palette];
}

/** '#rrggbb' → [r, g, b] in 0…1. */
export function parseColor(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
