import { describe, expect, it } from 'vitest';
import { BUILT_IN_KALEIDO_PRESETS, sanitizeKaleido } from './kaleido-settings';
import { mixColor, morphKaleido, morphLogoSpectrum, SettingsMorph } from './settings-morph';
import { BUILT_IN_PRESETS, layerColors, sanitizeSettings } from './visual-settings';

const [classic, neon] = BUILT_IN_PRESETS.map((preset) => preset.settings);
const bars = BUILT_IN_PRESETS.find((preset) => preset.name === 'Neon Bars')!.settings;

describe('morphing looks (PR-02)', () => {
  it('blends colours', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('starts and ends at the two Logo Spectrum looks exactly', () => {
    expect(morphLogoSpectrum(classic!, neon!, 0)).toBe(classic);
    expect(morphLogoSpectrum(classic!, neon!, 1)).toBe(neon);
  });

  it('glides numbers and colours, and changes styles halfway', () => {
    const early = morphLogoSpectrum(classic!, bars, 0.25);
    const late = morphLogoSpectrum(classic!, bars, 0.75);
    expect(early.glow).toBeCloseTo(classic!.glow + (bars.glow - classic!.glow) * 0.25, 6);
    expect(early.ringStyle).toBe(classic!.ringStyle);
    expect(late.ringStyle).toBe(bars.ringStyle);
    expect(Number.isInteger(early.layers)).toBe(true);
    // The colour layers blend, whatever palettes they come from.
    expect(early.palette).toBe('custom');
    expect(early.customColors[0]).toBe(
      mixColor(layerColors(classic!)[0]!, layerColors(bars)[0]!, 0.25),
    );
    // What comes out is valid settings.
    expect(sanitizeSettings(early)).toEqual(early);
  });

  it('morphs the Kaleidoscope, with the scene changing halfway', () => {
    const vortex = BUILT_IN_KALEIDO_PRESETS[0]!.settings;
    const crystal = BUILT_IN_KALEIDO_PRESETS.find((p) => p.settings.scene === 'crystal')!.settings;
    expect(morphKaleido(vortex, crystal, 0)).toBe(vortex);
    expect(morphKaleido(vortex, crystal, 1)).toBe(crystal);
    const early = morphKaleido(vortex, crystal, 0.3);
    expect(early.scene).toBe('vortex');
    expect(morphKaleido(vortex, crystal, 0.6).scene).toBe('crystal');
    expect(early.common['palette']).toBe('custom');
    expect(sanitizeKaleido(early)).toEqual(early);
  });

  it('morphs the Kaleidoscope behind with the Logo Spectrum look, or changes it halfway', () => {
    const [mandala, ember] = ['Mandala Core', 'Ember Record'].map(
      (name) => BUILT_IN_PRESETS.find((preset) => preset.name === name)!.settings,
    );
    const between = morphLogoSpectrum(mandala!, ember!, 0.3);
    expect(between.layerLook).toEqual(morphKaleido(mandala!.layerLook!, ember!.layerLook!, 0.3));
    expect(sanitizeSettings(between)).toEqual(between);
    // Without a look of its own on one side, the one behind changes halfway.
    expect(morphLogoSpectrum(classic!, ember!, 0.4).layerLook).toBeNull();
    expect(morphLogoSpectrum(classic!, ember!, 0.6).layerLook).toBe(ember!.layerLook);
  });

  it('moves to a target over time, frame by frame, and says when nothing changed', () => {
    const morph = new SettingsMorph(morphLogoSpectrum, classic!);
    expect(morph.advance(1 / 60)).toBe(classic);
    expect(morph.advance(1 / 60)).toBeNull();
    morph.set(neon!, 1);
    const halfway = morph.advance(0.5)!;
    expect(halfway.glow).toBeCloseTo((classic!.glow + neon!.glow) / 2, 6);
    expect(morph.moving).toBe(true);
    // A new target during a move starts from where it is.
    morph.set(bars, 0);
    expect(morph.advance(0)).toBe(bars);
    expect(morph.moving).toBe(false);
    expect(morph.advance(1)).toBeNull();
  });
});
