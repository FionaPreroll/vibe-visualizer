import { F } from '../analysis/features';
import { Prng } from '../util/prng';

/**
 * Automatic preset switching (PR-02): every so many seconds of music, every so many bars, or on
 * the drops, to the next preset in order or a random one, with a morph of a given length. The
 * same decisions live and in an export: they follow the analysis frames, not the clock.
 */

export type AutoTrigger = 'seconds' | 'bars' | 'drops';
export const AUTO_TRIGGERS: readonly AutoTrigger[] = ['seconds', 'bars', 'drops'];

export interface AutoPresets {
  on: boolean;
  trigger: AutoTrigger;
  /** Seconds of music between switches. */
  seconds: number;
  /** Bars (of four beats) between switches. */
  bars: number;
  /** Length of the morph, in seconds (0: a cut). */
  transition: number;
  /** The next preset: the one after it, or any other. */
  order: 'sequence' | 'random';
  /** Which presets take part: all of the mode, or the favourites. */
  pool: 'all' | 'favourites';
}

export const DEFAULT_AUTO_PRESETS: AutoPresets = {
  on: false,
  trigger: 'bars',
  seconds: 30,
  bars: 16,
  transition: 2,
  order: 'sequence',
  pool: 'all',
};

export const AUTO_RANGES = {
  seconds: [5, 300],
  bars: [1, 64],
  transition: [0, 10],
} as const satisfies Partial<Record<keyof AutoPresets, readonly [number, number]>>;

/** Valid settings from whatever is stored. */
export function sanitizeAutoPresets(value: unknown): AutoPresets {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const number = (key: keyof typeof AUTO_RANGES, integer = false) => {
    const stored = input[key];
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return DEFAULT_AUTO_PRESETS[key];
    const [min, max] = AUTO_RANGES[key];
    const clamped = Math.min(max, Math.max(min, stored));
    return integer ? Math.round(clamped) : clamped;
  };
  return {
    on: typeof input['on'] === 'boolean' ? input['on'] : DEFAULT_AUTO_PRESETS.on,
    trigger: AUTO_TRIGGERS.includes(input['trigger'] as AutoTrigger)
      ? (input['trigger'] as AutoTrigger)
      : DEFAULT_AUTO_PRESETS.trigger,
    seconds: number('seconds'),
    bars: number('bars', true),
    transition: number('transition'),
    order:
      input['order'] === 'random' || input['order'] === 'sequence'
        ? input['order']
        : DEFAULT_AUTO_PRESETS.order,
    pool:
      input['pool'] === 'favourites' || input['pool'] === 'all'
        ? input['pool']
        : DEFAULT_AUTO_PRESETS.pool,
  };
}

/**
 * The settings of the presets that take part: all of the mode, or its favourites (all while
 * there are fewer than two).
 */
export function switchingPool<S>(
  builtIn: readonly { name: string; settings: S }[],
  yours: readonly { name: string; settings: S }[],
  favourites: readonly string[],
  pool: AutoPresets['pool'],
): S[] {
  const all = [...builtIn, ...yours];
  const chosen = pool === 'favourites' ? all.filter((p) => favourites.includes(p.name)) : all;
  return (chosen.length > 1 ? chosen : all).map((p) => p.settings);
}

/** Beats per bar (the switching counts in 4/4). */
const BEATS_PER_BAR = 4;
/** Below this level (RMS) there is no music: the seconds do not count. */
const SILENCE_RMS = 0.003;
/** Time constants of the drop detector: the low end now, and over the last stretch. */
const DROP_FAST = 0.35;
const DROP_SLOW = 8;
/** A drop: the low end comes back this strong after it was at most DROP_QUIET for a while. */
const DROP_LOUD = 0.55;
const DROP_QUIET = 0.3;
/**
 * After a drop, the next one counts only this much later (seconds of music); as long after the
 * start too, so the slow level has heard the music before (a loud start is no drop).
 */
const DROP_REST = 16;

/**
 * Decides when to switch and to which preset. `update` runs once per frame with the analysis
 * frame shown and returns the index of the preset to switch to, or null.
 */
export class PresetDirector {
  private config: AutoPresets = DEFAULT_AUTO_PRESETS;
  private count = 0;
  /** Index of the look shown among the presets (−1: none of them). */
  private current = -1;
  private readonly random: Prng;
  private music = 0;
  private beats = 0;
  private fast = 0;
  private slow = 0;
  private sinceDrop = 0;

  constructor(seed = 1) {
    this.random = new Prng(seed);
  }

  /** Counts anew when switched on or to another trigger. */
  configure(config: AutoPresets): void {
    const changed = config.trigger !== this.config.trigger || config.on !== this.config.on;
    this.config = config;
    if (changed) this.restart();
  }

  /** The presets taking part (`count`) and which of them is shown now (−1: another look). */
  setPool(count: number, current: number): void {
    this.count = count;
    this.current = current < count ? current : -1;
  }

  /** Starts counting anew (after a switch, for a new track, in another mode). */
  restart(): void {
    this.music = 0;
    this.beats = 0;
    this.sinceDrop = 0;
  }

  get shown(): number {
    return this.current;
  }

  update(dt: number, features: Float32Array): number | null {
    const config = this.config;
    if (!config.on || this.count < 2) return null;
    const playing = features[F.rms]! > SILENCE_RMS;
    if (playing) this.music += dt;
    let due: boolean;
    if (config.trigger === 'seconds') {
      due = this.music >= config.seconds;
    } else if (config.trigger === 'bars') {
      if (features[F.beatHit]! > 0) this.beats++;
      due = this.beats >= config.bars * BEATS_PER_BAR;
    } else {
      due = playing && this.drop(dt, features);
    }
    if (!due) return null;
    this.restart();
    this.current = this.next();
    return this.current;
  }

  /** True on a drop: the low end and the kick come back strong after a quieter stretch. */
  private drop(dt: number, features: Float32Array): boolean {
    const low = 0.5 * features[F.bands]! + 0.5 * features[F.bands + 1]!;
    this.fast += (low - this.fast) * (1 - Math.exp(-dt / DROP_FAST));
    // The slow level looks back over the stretch before now.
    const quietBefore = this.slow <= DROP_QUIET;
    this.slow += (low - this.slow) * (1 - Math.exp(-dt / DROP_SLOW));
    this.sinceDrop += dt;
    if (this.sinceDrop < DROP_REST) return false;
    if (quietBefore && this.fast >= DROP_LOUD && features[F.kickHit]! > 0) {
      this.sinceDrop = 0;
      return true;
    }
    return false;
  }

  private next(): number {
    const count = this.count;
    if (this.config.order === 'sequence' || count < 2) return (this.current + 1) % count;
    // Any other preset, never the one shown.
    const others = this.current >= 0 ? count - 1 : count;
    let index = Math.floor(this.random.next() * others);
    if (this.current >= 0 && index >= this.current) index++;
    return index;
  }

  /** Everything that carries over from frame to frame (an export's snapshot). */
  saveState(): Record<string, number> {
    return {
      current: this.current,
      random: this.random.state,
      music: this.music,
      beats: this.beats,
      fast: this.fast,
      slow: this.slow,
      sinceDrop: this.sinceDrop,
    };
  }

  restoreState(values: Record<string, number | boolean>): void {
    const number = (key: string, fallback: number) =>
      typeof values[key] === 'number' ? values[key] : fallback;
    this.current = number('current', -1);
    this.random.state = number('random', this.random.state);
    this.music = number('music', 0);
    this.beats = number('beats', 0);
    this.fast = number('fast', 0);
    this.slow = number('slow', 0);
    this.sinceDrop = number('sinceDrop', 0);
  }
}
