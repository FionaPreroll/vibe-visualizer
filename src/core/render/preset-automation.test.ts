import { describe, expect, it } from 'vitest';
import { F } from '../analysis/features';
import {
  BUILT_IN_KALEIDO_PRESETS,
  sanitizeKaleido,
  type KaleidoSettings,
} from './kaleido-settings';
import { PresetAutomation, sameValue } from './preset-automation';
import { DEFAULT_AUTO_PRESETS, type AutoPresets } from './preset-director';
import { morphKaleido, morphLogoSpectrum } from './settings-morph';
import { BUILT_IN_PRESETS, sanitizeSettings } from './visual-settings';

const FRAME = 1 / 60;
const looks = BUILT_IN_PRESETS.map((preset) => preset.settings);
const kaleidoLooks = BUILT_IN_KALEIDO_PRESETS.map((preset) => preset.settings);
const EVERY_5_S: AutoPresets = {
  ...DEFAULT_AUTO_PRESETS,
  on: true,
  trigger: 'seconds',
  seconds: 5,
  transition: 2,
};

function music(): Float32Array {
  const features = new Float32Array(F.size);
  features[F.rms] = 0.2;
  return features;
}

describe('sameValue', () => {
  it('compares plain values deeply, whatever the order of the keys', () => {
    expect(sameValue({ a: 1, b: [1, '#fff'] }, { b: [1, '#fff'], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });

  it('knows the built-in presets again in the settings the app makes of them', () => {
    // The app keeps settings sanitized: the switching must recognise its own preset in them.
    for (const preset of BUILT_IN_PRESETS) {
      expect(sameValue(sanitizeSettings(preset.settings), preset.settings), preset.name).toBe(true);
    }
    for (const preset of BUILT_IN_KALEIDO_PRESETS) {
      expect(sameValue(sanitizeKaleido(preset.settings), preset.settings), preset.name).toBe(true);
    }
  });
});

describe('preset switching in a renderer (PR-02)', () => {
  it('switches after the seconds of music and morphs to the next preset', () => {
    const auto = new PresetAutomation(morphLogoSpectrum, looks[0]!, 1);
    auto.setAuto(EVERY_5_S, looks);
    const features = music();
    let frames = 0;
    let switched = null;
    while (!switched && frames < 600) {
      switched = auto.frame(FRAME, features).switched;
      frames++;
    }
    expect(frames / 60).toBeCloseTo(5, 1);
    expect(switched).toBe(looks[1]);
    expect(auto.target).toBe(looks[1]);
    // Halfway, the look is neither preset; after the morph it is the new one exactly.
    for (let i = 0; i < 60; i++) auto.frame(FRAME, features);
    expect(sameValue(auto.current, looks[0])).toBe(false);
    expect(sameValue(auto.current, looks[1])).toBe(false);
    for (let i = 0; i < 61; i++) auto.frame(FRAME, features);
    expect(auto.current).toBe(looks[1]);
  });

  it('keeps morphing when the app shows the preset, and takes other settings at once', () => {
    const auto = new PresetAutomation(morphLogoSpectrum, looks[0]!, 1);
    auto.setAuto(EVERY_5_S, looks);
    const features = music();
    while (!auto.frame(FRAME, features).switched);
    auto.frame(FRAME, features);
    // The app shows the preset it was told about (sanitized): the morph goes on.
    auto.setSettings(sanitizeSettings(looks[1]));
    expect(sameValue(auto.current, looks[1])).toBe(false);
    // You change something: it is shown at once.
    const yours = { ...looks[1]!, bloom: 0.1 };
    auto.setSettings(yours);
    expect(auto.current).toBe(yours);
    expect(auto.frame(FRAME, features).settings).toBe(yours);
  });

  it('keeps a look you choose for the whole stretch', () => {
    const auto = new PresetAutomation(morphLogoSpectrum, looks[0]!, 1);
    auto.setAuto(EVERY_5_S, looks);
    const features = music();
    for (let i = 0; i < 4 * 60; i++) expect(auto.frame(FRAME, features).switched).toBeNull();
    // A preset picked after 4 s stays for 5 s of music, not 1.
    auto.setSettings(looks[3]!);
    let frames = 0;
    while (!auto.frame(FRAME, features).switched && frames < 600) frames++;
    expect(frames / 60).toBeCloseTo(5, 1);
    expect(auto.target).toBe(looks[4]);
  });

  it('shows nothing new while nothing changes', () => {
    const auto = new PresetAutomation(morphLogoSpectrum, looks[0]!, 1);
    auto.setAuto({ ...EVERY_5_S, on: false }, looks);
    const features = music();
    expect(auto.frame(FRAME, features).settings).toBe(looks[0]);
    for (let i = 0; i < 600; i++)
      expect(auto.frame(FRAME, features)).toEqual({
        settings: null,
        switched: null,
      });
  });

  it('continues exactly from a saved state, in the middle of a morph', () => {
    const config: AutoPresets = { ...EVERY_5_S, order: 'random' };
    const create = () => {
      const auto = new PresetAutomation<KaleidoSettings>(morphKaleido, kaleidoLooks[0]!, 2);
      auto.setAuto(config, kaleidoLooks);
      return auto;
    };
    const run = (split: number | null) => {
      const features = music();
      let auto = create();
      const shown: string[] = [];
      for (let i = 0; i < 1500; i++) {
        if (i === split) {
          // Through the snapshot file: numbers and a string.
          const saved = JSON.parse(JSON.stringify(auto.saveState())) as ReturnType<
            typeof auto.saveState
          >;
          auto = create();
          auto.restoreState(saved.values, saved.morph);
        }
        auto.frame(FRAME, features);
        shown.push(JSON.stringify(auto.current));
      }
      return shown;
    };
    const whole = run(null);
    // It switched and morphed along the way.
    expect(new Set(whole).size).toBeGreaterThan(100);
    expect(run(330)).toEqual(whole);
    expect(run(900)).toEqual(whole);
  });
});
