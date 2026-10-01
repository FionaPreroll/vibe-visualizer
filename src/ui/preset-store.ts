import { writable, type Writable } from 'svelte/store';
import type { KaleidoPreset } from '../core/render/kaleido-settings';
import type { VisualPreset } from '../core/render/visual-settings';
import {
  loadKaleidoPresets,
  loadPresets,
  saveKaleidoPresets,
  savePresets,
} from '../core/state/persistence';

/**
 * Your presets of each visual mode (PR-01), kept in storage. The preset bars, the automatic
 * switching (PR-02) and the export share them.
 */

function persisted<P>(load: () => P[], save: (presets: P[]) => void): Writable<P[]> {
  const store = writable(load());
  let loaded = false;
  store.subscribe((presets) => {
    if (loaded) save(presets);
    loaded = true;
  });
  return store;
}

export const logoSpectrumPresets = persisted<VisualPreset>(loadPresets, savePresets);
export const kaleidoPresets = persisted<KaleidoPreset>(loadKaleidoPresets, saveKaleidoPresets);
