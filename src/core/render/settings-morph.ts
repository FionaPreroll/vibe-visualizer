import {
  COMMON_PARAMS,
  gradientColors,
  KALEIDO_SCENES,
  type KaleidoSettings,
  type ParamSpec,
  type ParamValue,
} from './kaleido-settings';
import { layerColors, parseColor, type LogoSpectrumSettings } from './visual-settings';

/**
 * Morphs from one look to another (PR-02): numbers glide, colours blend (palettes as their
 * colours), and what cannot glide (a style, a scene, a switch) changes halfway. The ends are the
 * two looks exactly.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hex(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/** Blends two '#rrggbb' colours. */
export function mixColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  return `#${hex(lerp(ar, br, t))}${hex(lerp(ag, bg, t))}${hex(lerp(ab, bb, t))}`;
}

const mixColors = (a: readonly string[], b: readonly string[], t: number) =>
  a.map((color, i) => mixColor(color, b[i % b.length]!, t));

/** Logo Spectrum settings between `a` (t = 0) and `b` (t = 1). */
export function morphLogoSpectrum(
  a: LogoSpectrumSettings,
  b: LogoSpectrumSettings,
  t: number,
): LogoSpectrumSettings {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const halfway = t < 0.5 ? a : b;
  const result: Record<string, unknown> = { ...halfway };
  for (const key of Object.keys(b) as (keyof LogoSpectrumSettings)[]) {
    const from = a[key];
    const to = b[key];
    if (typeof from === 'number' && typeof to === 'number') {
      result[key] = lerp(from, to, t);
    } else if (typeof from === 'string' && typeof to === 'string' && from.startsWith('#')) {
      result[key] = mixColor(from, to, t);
    }
  }
  // Counts stay whole; the blur changes halfway (a new blur is drawn anew).
  result['layers'] = Math.round(result['layers'] as number);
  result['particles'] = Math.round(result['particles'] as number);
  result['bars'] = Math.round(result['bars'] as number);
  result['backgroundBlur'] = halfway.backgroundBlur;
  // The colour layers blend as colours, whatever palettes they come from.
  result['palette'] = 'custom';
  result['customColors'] = mixColors(layerColors(a), layerColors(b), t);
  return result as unknown as LogoSpectrumSettings;
}

function morphGroup(
  specs: readonly ParamSpec[],
  a: Record<string, ParamValue>,
  b: Record<string, ParamValue>,
  t: number,
): Record<string, ParamValue> {
  const result: Record<string, ParamValue> = {};
  for (const spec of specs) {
    const from = a[spec.key]!;
    const to = b[spec.key]!;
    if (spec.kind === 'number') {
      const value = lerp(from as number, to as number, t);
      result[spec.key] = spec.integer ? Math.round(value) : value;
    } else if (spec.kind === 'color') {
      result[spec.key] = mixColor(from as string, to as string, t);
    } else if (spec.kind === 'gradient') {
      result[spec.key] = mixColors(from as string[], to as string[], t);
    } else {
      result[spec.key] = t < 0.5 ? from : to;
    }
  }
  return result;
}

/** Kaleidoscope settings between `a` (t = 0) and `b` (t = 1); the scene changes halfway. */
export function morphKaleido(a: KaleidoSettings, b: KaleidoSettings, t: number): KaleidoSettings {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const common = morphGroup(COMMON_PARAMS, a.common, b.common, t);
  // The colours blend as a gradient of their own, whatever palettes they come from.
  common['palette'] = 'custom';
  common['gradient'] = mixColors(gradientColors(a), gradientColors(b), t);
  const scenes = Object.fromEntries(
    KALEIDO_SCENES.map((scene) => [
      scene.id,
      morphGroup(scene.params, a.scenes[scene.id], b.scenes[scene.id], t),
    ]),
  ) as KaleidoSettings['scenes'];
  return { scene: t < 0.5 ? a.scene : b.scene, common, scenes };
}

/** Smooth start and end of a morph. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Settings that move to a new target over a given time (a preset switch), or at once. Advanced
 * frame by frame, so live and in an export it takes the same course.
 */
export class SettingsMorph<T> {
  private from: T;
  private to: T;
  private duration = 0;
  private elapsed = 0;
  private shown: T | null = null;

  constructor(
    private readonly blend: (a: T, b: T, t: number) => T,
    initial: T,
  ) {
    this.from = initial;
    this.to = initial;
  }

  /** Where it is going (the last target set). */
  get target(): T {
    return this.to;
  }

  /** The settings to show now. */
  get current(): T {
    return this.value();
  }

  /** True while it moves. */
  get moving(): boolean {
    return this.elapsed < this.duration;
  }

  /** How far the current move is, 0…1 (1 when it stands). */
  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  /** Moves to `target` over `seconds` (0: at once), from where it is now. */
  set(target: T, seconds: number): void {
    this.from = this.moving ? this.value() : this.to;
    this.to = target;
    this.duration = Math.max(0, seconds);
    this.elapsed = 0;
    this.shown = null;
  }

  /** Continues a move from `from` to `to` that is `elapsed` seconds into `seconds` (a resume). */
  resume(from: T, to: T, seconds: number, elapsed: number): void {
    this.from = from;
    this.to = to;
    this.duration = Math.max(0, seconds);
    this.elapsed = Math.min(this.duration, Math.max(0, elapsed));
    this.shown = null;
  }

  /** Where the current move started and where it goes (for a snapshot). */
  get ends(): { from: T; to: T } {
    return { from: this.from, to: this.to };
  }

  /** The seconds into the current move (for a snapshot). */
  get time(): number {
    return this.elapsed;
  }

  get length(): number {
    return this.duration;
  }

  /** Advances by `dt` seconds; returns the settings to show now, or null when they are unchanged. */
  advance(dt: number): T | null {
    if (this.moving) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const value = this.value();
    if (value === this.shown) return null;
    this.shown = value;
    return value;
  }

  private value(): T {
    if (!this.moving) return this.to;
    return this.blend(this.from, this.to, ease(this.elapsed / this.duration));
  }
}
