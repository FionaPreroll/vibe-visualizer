/**
 * Settings of the sound: tempo (TMP-01, TMP-02), DJ filter (FX-06), delay (FX-02), reverb
 * (FX-01), and the one-click presets for popular edits (FX-10). Plain data: the same settings
 * drive the live engine and the export.
 */

/** Vinyl: pitch follows the speed. Key lock: the pitch stays (time-stretching). */
export type TempoMode = 'vinyl' | 'keylock';

/** Ranges of the tempo fader, in percent. */
export const TEMPO_RANGES = [8, 16, 50] as const;
export type TempoRange = (typeof TEMPO_RANGES)[number];
/** Fine tempo step (TMP-03): 0.1 %. */
export const TEMPO_STEP = 0.001;

export const DELAY_DIVISIONS = ['1/16', '1/8', '1/4', '1/2', '1/1'] as const;
export type DelayDivision = (typeof DELAY_DIVISIONS)[number];
export const DELAY_FEELS = ['straight', 'dotted', 'triplet'] as const;
export type DelayFeel = (typeof DELAY_FEELS)[number];

export interface SoundSettings {
  /** Playback speed: 0.5…1.5 (−50 % … +50 %). */
  rate: number;
  tempoMode: TempoMode;
  /** Range of the tempo fader in percent. */
  tempoRange: TempoRange;
  /** DJ filter: −1 low-pass … 0 off … +1 high-pass. */
  filter: number;
  /** Resonance of the DJ filter, 0…1. */
  filterResonance: number;
  delayOn: boolean;
  /** Delay time from the tempo (a note value) instead of milliseconds. */
  delaySync: boolean;
  delayDivision: DelayDivision;
  delayFeel: DelayFeel;
  delayMs: number;
  /** 0…0.95 */
  delayFeedback: number;
  /** Filter in the feedback path: −1 darker … 0 neutral … +1 thinner. */
  delayTone: number;
  delayPingPong: boolean;
  /** 0 dry … 1 wet. */
  delayMix: number;
  reverbOn: boolean;
  /** Room size, 0…1. */
  reverbSize: number;
  /** Decay time in seconds. */
  reverbDecay: number;
  /** Pre-delay in milliseconds. */
  reverbPreDelay: number;
  /** High-frequency damping of the tail, 0…1. */
  reverbDamping: number;
  /** 0 dry … 1 wet. */
  reverbMix: number;
}

export const DEFAULT_SOUND: SoundSettings = {
  rate: 1,
  tempoMode: 'vinyl',
  tempoRange: 8,
  filter: 0,
  filterResonance: 0.3,
  delayOn: false,
  delaySync: true,
  delayDivision: '1/8',
  delayFeel: 'dotted',
  delayMs: 350,
  delayFeedback: 0.35,
  delayTone: 0,
  delayPingPong: true,
  delayMix: 0.3,
  reverbOn: false,
  reverbSize: 0.6,
  reverbDecay: 2.5,
  reverbPreDelay: 20,
  reverbDamping: 0.5,
  reverbMix: 0.25,
};

export const SOUND_RANGES = {
  rate: [0.5, 1.5],
  filter: [-1, 1],
  filterResonance: [0, 1],
  delayMs: [10, 2000],
  delayFeedback: [0, 0.95],
  delayTone: [-1, 1],
  delayMix: [0, 1],
  reverbSize: [0, 1],
  reverbDecay: [0.3, 20],
  reverbPreDelay: [0, 200],
  reverbDamping: [0, 1],
  reverbMix: [0, 1],
} as const satisfies Partial<Record<keyof SoundSettings, readonly [number, number]>>;

export interface SoundPreset {
  name: string;
  hint: string;
  settings: SoundSettings;
}

/** One-click edits (FX-10). Everything stays adjustable afterwards. */
export const SOUND_PRESETS: readonly SoundPreset[] = [
  { name: 'Clean', hint: 'Original speed, no effects', settings: DEFAULT_SOUND },
  {
    name: 'Slowed + Reverb',
    hint: '85 % speed, deeper, with reverb',
    settings: {
      ...DEFAULT_SOUND,
      rate: 0.85,
      tempoRange: 16,
      reverbOn: true,
      reverbSize: 0.85,
      // Short and quiet: the first version's long hall (5 s) was too much in the listening
      // test, and so was a mix of 35 %.
      reverbDecay: 0.7,
      reverbPreDelay: 30,
      reverbDamping: 0.45,
      reverbMix: 0.07,
    },
  },
  {
    name: 'Sped up',
    hint: '120 % speed, higher',
    settings: { ...DEFAULT_SOUND, rate: 1.2, tempoRange: 50 },
  },
  {
    name: 'Nightcore',
    hint: '130 % speed, much higher',
    settings: { ...DEFAULT_SOUND, rate: 1.3, tempoRange: 50 },
  },
];

/** The rate range the fader of `range` % covers. */
export function rateLimits(range: TempoRange): [number, number] {
  return [1 - range / 100, 1 + range / 100];
}

/** Length of the synced delay in seconds, from the tempo in beats per minute. */
export function syncedDelaySeconds(bpm: number, division: DelayDivision, feel: DelayFeel): number {
  const [, denominator] = division.split('/');
  const beats = 4 / Number(denominator);
  const factor = feel === 'dotted' ? 1.5 : feel === 'triplet' ? 2 / 3 : 1;
  return (60 / bpm) * beats * factor;
}

/** True when the sound is untouched: original speed, no filter, no delay and no reverb. */
export function isClean(settings: SoundSettings): boolean {
  return (
    settings.rate === 1 &&
    Math.abs(settings.filter) < 1e-6 &&
    !settings.delayOn &&
    !settings.reverbOn
  );
}

/** Valid settings from whatever is stored; defaults for anything missing or invalid. */
export function sanitizeSound(value: unknown): SoundSettings {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const result = { ...DEFAULT_SOUND } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_SOUND)) {
    const stored = input[key];
    if (typeof stored !== typeof fallback) continue;
    const range = (SOUND_RANGES as Record<string, readonly [number, number]>)[key];
    if (typeof stored === 'number') {
      if (!Number.isFinite(stored)) continue;
      result[key] = range ? Math.min(range[1], Math.max(range[0], stored)) : stored;
    } else {
      result[key] = stored;
    }
  }
  const settings = result as unknown as SoundSettings;
  if (!(['vinyl', 'keylock'] as const).includes(settings.tempoMode)) {
    settings.tempoMode = DEFAULT_SOUND.tempoMode;
  }
  if (!TEMPO_RANGES.includes(settings.tempoRange)) settings.tempoRange = DEFAULT_SOUND.tempoRange;
  if (!DELAY_DIVISIONS.includes(settings.delayDivision)) {
    settings.delayDivision = DEFAULT_SOUND.delayDivision;
  }
  if (!DELAY_FEELS.includes(settings.delayFeel)) settings.delayFeel = DEFAULT_SOUND.delayFeel;
  // The fader cannot reach a rate outside its range: widen the range instead of losing the rate.
  const range = TEMPO_RANGES.find((candidate) => {
    const [low, high] = rateLimits(candidate);
    return (
      candidate >= settings.tempoRange &&
      settings.rate >= low - 1e-9 &&
      settings.rate <= high + 1e-9
    );
  });
  settings.tempoRange = range ?? 50;
  return settings;
}
