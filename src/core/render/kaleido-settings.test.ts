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

  it('keeps the look of Neon Ribbons stored before its rings and lights (Kanban 15)', () => {
    const before = { ribbons: 3, lobes: 6, weave: 0.8, thickness: 0.35, blossoms: 0.2 };
    const shown = sanitizeKaleido({ scene: 'ribbons', scenes: { ribbons: before } });
    // The new parts off, the blossoms as stored and the flowers as they were by default.
    expect(shown.scenes.ribbons).toMatchObject({
      ...before,
      flowers: 0.5,
      halo: 0,
      bokeh: 0,
      sheen: 0,
    });
    // A look of another scene never showed its Ribbons: they take today's defaults.
    const unseen = sanitizeKaleido({ scene: 'vortex', scenes: { ribbons: before } });
    expect(unseen.scenes.ribbons).toEqual(sceneDefaults('ribbons').scenes.ribbons);
    // Looks stored since keep what they say.
    const today = sanitizeKaleido({ scene: 'ribbons', scenes: { ribbons: { halo: 0.2 } } });
    expect(today.scenes.ribbons).toMatchObject({ halo: 0.2, bokeh: 0.65, blossoms: 0, flowers: 0 });
  });

  it('gives Neon Ribbons cool light, and keeps its old look as Flower Power', () => {
    const neon = BUILT_IN_KALEIDO_PRESETS.find((preset) => preset.name === 'Neon Ribbons')!;
    expect(neon.settings.common).toMatchObject({ palette: 'iris', haze: 0.5 });
    expect(neon.settings.scenes.ribbons).toMatchObject({ blossoms: 0, flowers: 0 });
    const retro = BUILT_IN_KALEIDO_PRESETS.find((preset) => preset.name === 'Flower Power')!;
    expect(retro.settings.scene).toBe('ribbons');
    expect(retro.settings.common).toMatchObject({ palette: 'ribbons', haze: 0 });
    expect(retro.settings.scenes.ribbons).toMatchObject({
      halo: 0,
      bokeh: 0,
      sheen: 0,
      blossoms: 0.6,
      flowers: 0.5,
    });
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
