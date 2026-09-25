import { describe, expect, it } from 'vitest';
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

  it('has valid built-in presets and palettes', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(sanitizeSettings(preset.settings)).toEqual(preset.settings);
    }
    for (const colors of Object.values(PALETTES)) expect(colors).toHaveLength(MAX_LAYERS);
  });
});
