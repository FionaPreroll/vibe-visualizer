import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_KALEIDO_PRESETS,
  COMMON_PARAMS,
  DEFAULT_KALEIDO,
  GRADIENT_STOPS,
  gradientColors,
  KALEIDO_PALETTES,
  KALEIDO_SCENES,
  sanitizeKaleido,
  sceneDefaults,
} from './kaleido-settings';

describe('kaleidoscope settings', () => {
  it('falls back to the defaults for missing or broken input', () => {
    expect(sanitizeKaleido(undefined)).toEqual(DEFAULT_KALEIDO);
    expect(sanitizeKaleido({ scene: 'unknown', common: 'x', scenes: 5 })).toEqual(
      sanitizeKaleido({}),
    );
  });

  it('checks every value against its spec', () => {
    const settings = sanitizeKaleido({
      scene: 'crystal',
      common: { segments: 7.6, zoom: 99, mirror: 'yes', palette: 'plaid', gradient: ['#fff'] },
      scenes: { crystal: { points: 2 }, vortex: { coreColor: '#ABCDEF' } },
    });
    expect(settings.scene).toBe('crystal');
    expect(settings.common['segments']).toBe(8);
    expect(settings.common['zoom']).toBe(3);
    expect(settings.common['mirror']).toBe(true);
    expect(settings.common['palette']).toBe('vortex');
    expect(settings.common['gradient']).toHaveLength(GRADIENT_STOPS);
    expect(settings.scenes.crystal['points']).toBe(4);
    expect(settings.scenes.vortex['coreColor']).toBe('#abcdef');
  });

  it('gives each scene a complete look, and uses custom gradients', () => {
    for (const scene of KALEIDO_SCENES) {
      const settings = sceneDefaults(scene.id);
      expect(Object.keys(settings.common)).toHaveLength(COMMON_PARAMS.length);
      for (const key of Object.keys(scene.look))
        expect(settings.common[key]).toEqual(scene.look[key]);
      expect(sanitizeKaleido(settings)).toEqual(settings);
    }
    const custom = sanitizeKaleido({
      common: {
        palette: 'custom',
        gradient: ['#000000', '#111111', '#222222', '#333333', '#444444'],
      },
    });
    expect(gradientColors(custom)).toEqual(['#000000', '#111111', '#222222', '#333333', '#444444']);
    expect(gradientColors(DEFAULT_KALEIDO)).toEqual(KALEIDO_PALETTES.vortex);
  });

  it('has valid built-in presets with unique names', () => {
    const names = new Set(BUILT_IN_KALEIDO_PRESETS.map((preset) => preset.name));
    expect(names.size).toBe(BUILT_IN_KALEIDO_PRESETS.length);
    for (const preset of BUILT_IN_KALEIDO_PRESETS) {
      expect(sanitizeKaleido(preset.settings)).toEqual(preset.settings);
    }
    for (const colors of Object.values(KALEIDO_PALETTES))
      expect(colors).toHaveLength(GRADIENT_STOPS);
  });
});
