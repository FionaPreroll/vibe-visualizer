import { describe, expect, it } from 'vitest';
import { DEFAULT_KALEIDO, KALEIDO_SCENES, sanitizeKaleido } from './kaleido-settings';
import {
  BUILT_IN_PRESETS,
  DEFAULT_LOGO_SPECTRUM,
  MAX_LAYERS,
  PALETTES,
  RANGES,
  sanitizeSettings,
} from './visual-settings';

describe('visual settings', () => {
  it('falls back to the defaults for missing or broken input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_LOGO_SPECTRUM);
    expect(sanitizeSettings('nonsense')).toEqual(DEFAULT_LOGO_SPECTRUM);
    expect(
      sanitizeSettings({
        palette: 'plaid',
        topColor: 'white',
        backgroundFit: 'stretch',
        mirror: 'yes',
        glow: Number.NaN,
        unknown: 1,
      }),
    ).toEqual(DEFAULT_LOGO_SPECTRUM);
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
      ringStyle: DEFAULT_LOGO_SPECTRUM.ringStyle,
      ringDirection: DEFAULT_LOGO_SPECTRUM.ringDirection,
      backgroundTint: DEFAULT_LOGO_SPECTRUM.backgroundTint,
    });
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
