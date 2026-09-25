/**
 * Parameters of the Logo Spectrum mode (LS-*), with palettes and built-in presets (PR-01).
 * Flat and JSON-serialisable: stored in the app state, recorded as timestamped actions and
 * sent to the render worker as they are.
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

export interface LogoSpectrumSettings {
  // Background (LS-01…03)
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

  // Spectrum ring (LS-05…10)
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

export const DEFAULT_LOGO_SPECTRUM: LogoSpectrumSettings = {
  backgroundFit: 'cover',
  backgroundBlur: 0.15,
  backgroundDim: 0.35,
  backgroundPulse: 0.3,
  backgroundX: 0,
  backgroundY: 0,
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
  return { name, settings: { ...DEFAULT_LOGO_SPECTRUM, ...changes }, builtIn: true };
}

export const BUILT_IN_PRESETS: readonly VisualPreset[] = [
  preset('Classic Rainbow', {}),
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
];

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
  particles: [0, 600],
  particleSize: [0.3, 3],
  particleSpeed: [0, 4],
  bloom: [0, 1],
};

const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Takes whatever is stored (possibly from an older version) and returns valid settings:
 * unknown keys dropped, wrong types replaced by defaults, numbers clamped to their ranges.
 */
export function sanitizeSettings(value: unknown): LogoSpectrumSettings {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const result = {
    ...DEFAULT_LOGO_SPECTRUM,
    customColors: [...DEFAULT_LOGO_SPECTRUM.customColors],
  };
  const target = result as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_LOGO_SPECTRUM) as (keyof LogoSpectrumSettings)[]) {
    const stored = input[key];
    const fallback = DEFAULT_LOGO_SPECTRUM[key];
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
      if ((key === 'topColor' || key === 'rimColor') && !COLOR.test(stored)) continue;
      target[key] = stored;
    } else if (Array.isArray(stored)) {
      const colors = stored.filter((color) => typeof color === 'string' && COLOR.test(color));
      if (colors.length === MAX_LAYERS) result.customColors = colors as string[];
    }
  }
  result.layers = Math.round(result.layers);
  result.particles = Math.round(result.particles);
  if (result.maxFrequency < result.minFrequency * 2) result.maxFrequency = result.minFrequency * 2;
  return result;
}

/** The layer colours, from the layer next to the top layer to the back. */
export function layerColors(settings: LogoSpectrumSettings): readonly string[] {
  return settings.palette === 'custom' ? settings.customColors : PALETTES[settings.palette];
}

/** '#rrggbb' → [r, g, b] in 0…1. */
export function parseColor(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
