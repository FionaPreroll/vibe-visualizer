import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KALEIDO,
  KALEIDO_SCENES,
  sanitizeKaleido,
  sceneDefaults,
} from './kaleido-settings';
import {
  BUILT_IN_PRESETS,
  DEFAULT_LOGO_SPECTRUM,
  MAX_LAYERS,
  PALETTES,
  RANGES,
  sanitizeSettings,
} from './visual-settings';

/** The preset "bluepink" as the app exported it, which became the default. */
const BLUE_PINK_EXPORT = {
  backgroundSource: 'kaleidoscope',
  layerLook: {
    scene: 'vortex',
    common: {
      segments: 1,
      mirror: true,
      spin: 0.3,
      zoom: 1,
      centerX: 0,
      centerY: 0,
      flow: -0.4,
      twist: 0.25,
      trails: 0.6,
      palette: 'neon',
      gradient: ['#26000a', '#6e0a16', '#0c3a1c', '#2fcf62', '#dcffd4'],
      hueCycle: 0,
      barShift: 0.15,
      reactivity: 1,
      intensity: 1,
      bloom: 0.5,
    },
    scenes: {
      vortex: { arms: 3, swirl: 0.7, strands: 0.6, fiber: 0.5, core: 0.6, coreColor: '#b388ff' },
      crystal: { points: 8, starSize: 0.16, shards: 0.6, sparks: 0.5 },
      ribbons: {
        ribbons: 4,
        lobes: 5,
        weave: 0.65,
        thickness: 0.35,
        depth: 0.7,
        blossoms: 0.6,
        flowers: 0.5,
      },
    },
  },
  backgroundFit: 'cover',
  backgroundBlur: 0.15,
  backgroundDim: 0.3,
  backgroundPulse: 0.3,
  backgroundX: 0,
  backgroundY: 0,
  backgroundTint: '#8f3dff',
  backgroundTintAmount: 0,
  shake: 0,
  drift: 0,
  ringStyle: 'lines',
  ringDirection: 'outward',
  bars: 96,
  thickness: 0.5,
  palette: 'neon',
  customColors: [
    '#e8fbff',
    '#b3f0ff',
    '#7ddfff',
    '#45c2ff',
    '#2a8cff',
    '#3056e8',
    '#3a33c2',
    '#2e1f8f',
  ],
  topColor: '#ffffff',
  layers: 8,
  layerDelay: 0.16,
  layerSpread: 0.04,
  hueCycle: 0,
  ringRadius: 0.1472,
  amplitude: 0.4575,
  minFrequency: 30,
  maxFrequency: 12000,
  mirror: true,
  rotation: 0,
  spin: 0,
  glow: 0.6,
  glowRadius: 0.2,
  centerX: 0,
  centerY: 0,
  sensitivity: 1.1,
  attack: 0.02,
  release: 0.16,
  smoothing: 0.35,
  threshold: 0.35,
  tilt: -0.2,
  logoSize: 0.92,
  logoZoom: 1,
  logoPanX: 0,
  logoPanY: 0,
  rimWidth: 0.04,
  rimColor: '#ffffff',
  logoShadow: 0.5,
  bassPulse: 0.5,
  logoSpin: 33.333333333333336,
  particles: 90,
  particleSize: 1,
  particleSpeed: 1,
  bloom: 0.25,
};

const CLASSIC_RAINBOW = BUILT_IN_PRESETS.find(
  (preset) => preset.name === 'Classic Rainbow',
)!.settings;

describe('visual settings', () => {
  it('starts with Blue-Pink Vortex, as it was exported from the app', () => {
    expect(BUILT_IN_PRESETS[0]!.name).toBe('Blue-Pink Vortex');
    // Settings added since then have their defaults: no image under the Kaleidoscope, stars,
    // no haze, and the Neon Ribbons of today (the look shows the Vortex, its Ribbons were never
    // seen).
    const look = BLUE_PINK_EXPORT.layerLook;
    expect(DEFAULT_LOGO_SPECTRUM).toEqual({
      ...BLUE_PINK_EXPORT,
      layerImage: 0,
      particleStyle: 'stars',
      layerLook: {
        ...look,
        common: { ...look.common, haze: 0 },
        scenes: { ...look.scenes, ribbons: sceneDefaults('ribbons').scenes.ribbons },
      },
    });
    // The export itself, as a look from a file: the same.
    expect(sanitizeSettings(BLUE_PINK_EXPORT)).toEqual(DEFAULT_LOGO_SPECTRUM);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_LOGO_SPECTRUM);
    expect(sanitizeSettings('nonsense')).toEqual(DEFAULT_LOGO_SPECTRUM);
  });

  it('fills what a stored look lacks or breaks from Classic Rainbow, the default before', () => {
    expect(
      sanitizeSettings({
        palette: 'plaid',
        topColor: 'white',
        backgroundFit: 'stretch',
        mirror: 'yes',
        glow: Number.NaN,
        unknown: 1,
      }),
    ).toEqual(CLASSIC_RAINBOW);
    // A look from before the Kaleidoscope behind and the turning logo stays without them.
    expect(sanitizeSettings({ palette: 'fire', layers: 4 })).toMatchObject({
      palette: 'fire',
      layers: 4,
      backgroundSource: 'image',
      layerLook: null,
      logoSpin: 0,
    });
  });

  it('clamps numbers to their ranges and rounds counts', () => {
    const settings = sanitizeSettings({ glow: 5, layers: 3.6, particles: -10, ringRadius: 0 });
    expect(settings.glow).toBe(RANGES.glow[1]);
    expect(settings.layers).toBe(4);
    expect(settings.particles).toBe(0);
    expect(settings.ringRadius).toBe(RANGES.ringRadius[0]);
  });

  it('keeps a valid custom palette and a sensible frequency range', () => {
    const colors = Array.from({ length: MAX_LAYERS }, () => '#123456');
    const settings = sanitizeSettings({
      palette: 'custom',
      customColors: colors,
      minFrequency: 1000,
      maxFrequency: 1200,
    });
    expect(settings.palette).toBe('custom');
    expect(settings.customColors).toEqual(colors);
    expect(settings.maxFrequency).toBe(2000);
  });

  it('keeps valid ring styles, directions and tints, and falls back for others', () => {
    const settings = sanitizeSettings({
      ringStyle: 'dots',
      ringDirection: 'both',
      backgroundTint: '#00ff88',
      bars: 99.6,
      thickness: 3,
    });
    expect(settings).toMatchObject({
      ringStyle: 'dots',
      ringDirection: 'both',
      backgroundTint: '#00ff88',
      bars: 100,
      thickness: RANGES.thickness[1],
    });
    expect(
      sanitizeSettings({ ringStyle: 'zigzag', ringDirection: 'up', backgroundTint: 'pink' }),
    ).toMatchObject({
      ringStyle: CLASSIC_RAINBOW.ringStyle,
      ringDirection: CLASSIC_RAINBOW.ringDirection,
      backgroundTint: CLASSIC_RAINBOW.backgroundTint,
    });
  });

  it('keeps rain or stars as the particles, and stars for anything else (LS-17)', () => {
    expect(sanitizeSettings({ particleStyle: 'rain' }).particleStyle).toBe('rain');
    expect(sanitizeSettings({ particleStyle: 'snow' }).particleStyle).toBe('stars');
    // Looks from before the rain keep their stars.
    expect(sanitizeSettings({ particles: 50 }).particleStyle).toBe('stars');
    const rain = BUILT_IN_PRESETS.find((preset) => preset.name === 'Night Rain')!;
    expect(rain.settings).toMatchObject({ particleStyle: 'rain', backgroundSource: 'image' });
  });

  it('has valid built-in presets and palettes', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(sanitizeSettings(preset.settings)).toEqual(preset.settings);
    }
    for (const colors of Object.values(PALETTES)) expect(colors).toHaveLength(MAX_LAYERS);
  });

  it('keeps the Kaleidoscope behind as a valid look of its own (VE-08)', () => {
    const look = sanitizeKaleido({ scene: 'crystal', common: { segments: 99 } });
    const settings = sanitizeSettings({ backgroundSource: 'kaleidoscope', layerLook: look });
    expect(settings.layerLook).toEqual(look);
    // A broken look is mended; none, or something else, is the Kaleidoscope's own.
    expect(sanitizeSettings({ layerLook: { scene: 'plaid' } }).layerLook).toEqual(DEFAULT_KALEIDO);
    expect(sanitizeSettings({ layerLook: 'crystal' }).layerLook).toBeNull();
    expect(sanitizeSettings({}).layerLook).toBeNull();
  });

  it('has built-in looks with a Kaleidoscope of their own behind the ring', () => {
    const layered = BUILT_IN_PRESETS.filter((preset) => preset.settings.layerLook);
    expect(layered.length).toBeGreaterThanOrEqual(5);
    for (const { settings } of layered) expect(settings.backgroundSource).toBe('kaleidoscope');
    // Every scene is behind one of them.
    const scenes = new Set(layered.map(({ settings }) => settings.layerLook!.scene));
    expect(scenes.size).toBe(KALEIDO_SCENES.length);
  });
});
