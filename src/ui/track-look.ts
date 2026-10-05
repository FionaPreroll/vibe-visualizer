import { get } from 'svelte/store';
import { BUILT_IN_KALEIDO_PRESETS, type KaleidoSettings } from '../core/render/kaleido-settings';
import { BUILT_IN_PRESETS, type LogoSpectrumSettings } from '../core/render/visual-settings';
import type { TrackLook } from '../core/state/app-state';
import { kaleidoPresets, logoSpectrumPresets } from './preset-store';

/**
 * The looks a track can have (PR-06): the presets of both visual modes, built in and your own,
 * by name.
 */

/** The names of the presets of `mode`, built in first. */
export function lookNames(mode: TrackLook['mode']): string[] {
  const presets =
    mode === 'logoSpectrum'
      ? [...BUILT_IN_PRESETS, ...get(logoSpectrumPresets)]
      : [...BUILT_IN_KALEIDO_PRESETS, ...get(kaleidoPresets)];
  return [...new Set(presets.map((preset) => preset.name))];
}

/** The settings of a track's look; null when it has none, or its preset is gone. */
export function lookSettings(
  look: TrackLook | null,
): LogoSpectrumSettings | KaleidoSettings | null {
  if (!look) return null;
  if (look.mode === 'logoSpectrum') {
    const presets = [...BUILT_IN_PRESETS, ...get(logoSpectrumPresets)];
    return presets.find((preset) => preset.name === look.preset)?.settings ?? null;
  }
  const presets = [...BUILT_IN_KALEIDO_PRESETS, ...get(kaleidoPresets)];
  return presets.find((preset) => preset.name === look.preset)?.settings ?? null;
}
