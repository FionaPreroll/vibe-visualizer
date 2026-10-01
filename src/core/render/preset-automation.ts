import { DEFAULT_AUTO_PRESETS, PresetDirector, type AutoPresets } from './preset-director';
import { SettingsMorph } from './settings-morph';

/**
 * The preset switching of one visual mode inside a renderer (PR-02): the director says when
 * and to which preset, the morph glides there frame by frame. The render worker runs one per
 * mode, the export one for its mode, so a video switches as the preview does.
 */

/** Deep equality of plain JSON-like values (settings), whatever the order of their keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Seeds of the random order, per mode: the preview and an export choose alike. */
export const SWITCHING_SEEDS = { logoSpectrum: 1, kaleidoscope: 2 } as const;

export class PresetAutomation<T> {
  private readonly morph: SettingsMorph<T>;
  private readonly director: PresetDirector;
  private config: AutoPresets = DEFAULT_AUTO_PRESETS;
  private pool: readonly T[] = [];

  constructor(blend: (a: T, b: T, t: number) => T, initial: T, seed: number) {
    this.morph = new SettingsMorph(blend, initial);
    this.director = new PresetDirector(seed);
  }

  /** The look being shown or morphed to. */
  get target(): T {
    return this.morph.target;
  }

  /** The look to show now (on the way there during a morph). */
  get current(): T {
    return this.morph.current;
  }

  /**
   * The look the app asks for: taken at once, unless it is the preset the switching chose
   * (the app shows that one while the morph is on its way). A look you chose or changed is
   * kept for the whole stretch: the switching counts anew.
   */
  setSettings(settings: T): void {
    if (sameValue(settings, this.morph.target)) return;
    this.morph.set(settings, 0);
    this.director.setPool(this.pool.length, this.indexOf(settings));
    this.director.restart();
  }

  /** The switching's settings and the presets that take part. */
  setAuto(config: AutoPresets, pool: readonly T[]): void {
    this.config = config;
    this.pool = pool;
    this.director.configure(config);
    this.director.setPool(pool.length, this.indexOf(this.morph.target));
  }

  /** Counts anew: nothing carries over to what comes next (another track, this mode again). */
  restart(): void {
    this.director.restart();
  }

  /**
   * One frame: the settings to show now (null: unchanged since the last frame) and the preset
   * switched to in this frame (null: none).
   */
  frame(dt: number, features: Float32Array): { settings: T | null; switched: T | null } {
    const next = this.director.update(dt, features);
    let switched: T | null = null;
    if (next !== null) {
      switched = this.pool[next] ?? null;
      if (switched) this.morph.set(switched, this.config.transition);
    }
    return { settings: this.morph.advance(dt), switched };
  }

  /** What carries over from frame to frame (an export's snapshot): numbers, and the morph. */
  saveState(): { values: Record<string, number>; morph: string } {
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(this.director.saveState())) {
      values[`auto.${key}`] = value;
    }
    const { from, to } = this.morph.ends;
    return {
      values,
      morph: JSON.stringify({ from, to, length: this.morph.length, time: this.morph.time }),
    };
  }

  restoreState(values: Record<string, number | boolean>, morph: string): void {
    const director: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith('auto.')) director[key.slice(5)] = value;
    }
    this.director.restoreState(director);
    const saved = JSON.parse(morph) as { from: T; to: T; length: number; time: number };
    this.morph.resume(saved.from, saved.to, saved.length, saved.time);
  }

  private indexOf(settings: T): number {
    return this.pool.findIndex((preset) => sameValue(preset, settings));
  }
}
