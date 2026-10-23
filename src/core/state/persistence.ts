import * as v from 'valibot';
import { TEMPO_HINT_RANGE } from '../analysis/beat-grid';
import { clampShift, isGridEdited } from '../analysis/grid-edit';
import { sanitizeSound, type SoundSettings } from '../audio/dsp/sound-settings';
import {
  sanitizeKaleido,
  type KaleidoPreset,
  type KaleidoSettings,
} from '../render/kaleido-settings';
import {
  sanitizeSettings,
  type LogoSpectrumSettings,
  type VisualPreset,
} from '../render/visual-settings';
import { sanitizeExportOptions, type ExportOptions } from '../export/video-format';
import { sanitizeTrackColors } from '../render/cover-palette';
import { defaults, flag, orNone, readWith, record, sanitize } from '../util/schema';
import {
  CUE_COUNT,
  sanitizeTrackLook,
  SETTINGS_SCHEMA,
  TRACK_EDIT_SCHEMA,
  type Settings,
  type TrackData,
} from './app-state';

/** What all keys of the app in localStorage start with. */
export const STORAGE_PREFIX = 'vibe-visualizer:';
const SETTINGS_KEY = 'vibe-visualizer:settings:v1';
const VISUALS_KEY = 'vibe-visualizer:visuals:v1';
export const PRESETS_KEY = 'vibe-visualizer:presets:v1';
const KALEIDO_KEY = 'vibe-visualizer:kaleido:v1';
export const KALEIDO_PRESETS_KEY = 'vibe-visualizer:kaleido-presets:v1';
const EXPORT_KEY = 'vibe-visualizer:export:v1';
const SOUND_KEY = 'vibe-visualizer:sound:v1';
/** Per file (by fingerprint): its cues, markers, corrected tempo and beat grid. */
export const TRACK_PREFIX = 'vibe-visualizer:track:v1:';

/** Off while a backup is restored (UI-06): the app then stores nothing until it reloads. */
let saving = true;

/** Stops (or resumes) storing: the running app must not write its state over a backup. */
export function setSaving(on: boolean): void {
  saving = on;
  // Values still waiting would be written over what replaces them.
  if (!on) {
    for (const { timer } of throttled.values()) clearTimeout(timer);
    throttled.clear();
  }
}

/** A time in seconds, or none; whether it lies in the file is checked against its duration. */
const TIME = orNone(v.pipe(v.number(), v.finite()));

/**
 * What is kept per file (TR-05), as {@link saveTrackData} stores it; its times are checked
 * against the file's duration where it is read.
 */
const STORED_TRACK_SCHEMA = record({
  cues: v.fallback(v.array(TIME), (): (number | null)[] => []),
  marks: record({ in: TIME, out: TIME }),
  /** A tempo the user gave (TMP-06). */
  tempo: orNone(
    v.pipe(v.number(), v.minValue(TEMPO_HINT_RANGE.min), v.maxValue(TEMPO_HINT_RANGE.max)),
  ),
  fixed: flag(false),
  /** A correction of the beat grid (TR-11). */
  grid: record({
    shift: v.fallback(v.pipe(v.number(), v.finite(), v.transform(clampShift)), 0),
    downbeat: TIME,
  }),
  edit: TRACK_EDIT_SCHEMA,
  colors: readWith(sanitizeTrackColors),
  look: readWith(sanitizeTrackLook),
});

/**
 * The cues, markers, tempo (fixed or not), grid correction, names and colours stored for a file
 * (TR-05), validated against its duration.
 */
export function loadTrackData(fingerprint: string, duration: number): TrackData | null {
  const stored = read(TRACK_PREFIX + fingerprint);
  if (!stored || typeof stored !== 'object') return null;
  const data = sanitize(STORED_TRACK_SCHEMA, stored);
  const inFile = (time: number | null) =>
    time !== null && time >= 0 && time <= duration ? time : null;
  const marks = { in: inFile(data.marks.in), out: inFile(data.marks.out) };
  if (marks.in !== null && marks.out !== null && marks.out <= marks.in) marks.out = null;
  const { shift, downbeat } = data.grid;
  return {
    cues: Array.from({ length: CUE_COUNT }, (_, index) => inFile(data.cues[index] ?? null)),
    marks,
    tempo: data.tempo,
    fixedTempo: data.fixed,
    gridEdit: {
      shift,
      // The first beat of a grid can lie just before the start of the file.
      downbeat: downbeat !== null && downbeat >= -1 && downbeat <= duration + 1 ? downbeat : null,
    },
    edit: data.edit,
    colors: data.colors,
    look: data.look,
  };
}

/**
 * Stores the cues, markers, tempo, grid correction, names and colours of a file; nothing to
 * store removes it.
 */
export function saveTrackData(fingerprint: string, data: TrackData): void {
  if (!saving) return;
  const empty =
    data.cues.every((cue) => cue === null) &&
    data.marks.in === null &&
    data.marks.out === null &&
    data.tempo === null &&
    !data.fixedTempo &&
    !isGridEdited(data.gridEdit) &&
    data.edit === null &&
    data.colors === null &&
    data.look === null;
  if (empty) {
    try {
      localStorage.removeItem(TRACK_PREFIX + fingerprint);
    } catch {
      // Storage blocked.
    }
    return;
  }
  write(TRACK_PREFIX + fingerprint, {
    cues: data.cues,
    marks: data.marks,
    tempo: data.tempo,
    ...(data.fixedTempo ? { fixed: true } : {}),
    ...(isGridEdited(data.gridEdit) ? { grid: data.gridEdit } : {}),
    ...(data.edit ? { edit: data.edit } : {}),
    ...(data.colors ? { colors: data.colors } : {}),
    ...(data.look ? { look: data.look } : {}),
  });
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

let onWriteFailed: ((error: unknown) => void) | null = null;
let writeFailed = false;

/**
 * Tells `handler` when a value could not be stored (NF-10): the storage is full, or the browser
 * does not allow it. Once a session.
 */
export function whenStorageFails(handler: ((error: unknown) => void) | null): void {
  onWriteFailed = handler;
}

/**
 * Shortest time between two writes of the same value that changes in bursts (a slider dragged,
 * a fader of a DJ controller moved): each write is a synchronous JSON.stringify and setItem on
 * the main thread.
 */
export const WRITE_INTERVAL_MS = 250;

/** Per key written with {@link writeSoon}: the timer of its interval, and the value waiting. */
const throttled = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; value: unknown; waiting: boolean }
>();

/**
 * Stores `value` under `key` at once, and the changes that follow within
 * {@link WRITE_INTERVAL_MS} together at its end: a burst writes the first value and the last.
 */
function writeSoon(key: string, value: unknown): void {
  if (!saving) return;
  const entry = throttled.get(key);
  if (entry) {
    entry.value = value;
    entry.waiting = true;
    return;
  }
  write(key, value);
  const tick = () => {
    const current = throttled.get(key);
    if (!current?.waiting) {
      throttled.delete(key);
      return;
    }
    current.waiting = false;
    write(key, current.value);
    current.timer = setTimeout(tick, WRITE_INTERVAL_MS);
  };
  throttled.set(key, { timer: setTimeout(tick, WRITE_INTERVAL_MS), value, waiting: false });
}

/** Stores the values still waiting at once: before the page goes, or a backup reads them. */
export function flushWrites(): void {
  const entries = [...throttled];
  throttled.clear();
  for (const [key, { timer, value, waiting }] of entries) {
    clearTimeout(timer);
    if (waiting) write(key, value);
  }
}

function write(key: string, value: unknown): void {
  if (!saving) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage full or blocked: the value stays for this session only.
    if (writeFailed) return;
    writeFailed = true;
    onWriteFailed?.(error);
  }
}

/** Stored settings over the defaults (see SETTINGS_SCHEMA); unknown or invalid values are not. */
export function loadSettings(): Settings {
  let stored: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    stored = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  } catch {
    // Unreadable storage: defaults.
    return defaults(SETTINGS_SCHEMA);
  }
  // The lettering in the ring was the app's name, which the user could change, before.
  if (typeof stored['logoText'] !== 'string' && typeof stored['appName'] === 'string') {
    stored['logoText'] = stored['appName'];
  }
  const settings = sanitize(SETTINGS_SCHEMA, stored);
  // Until the user chooses, flashing is reduced where the system asks for less motion (VE-06).
  // Settings stored before the choice was kept had it on only if the user turned it on.
  if (typeof stored['reduceFlashingChosen'] !== 'boolean') {
    settings.reduceFlashingChosen = stored['reduceFlashing'] === true;
  }
  if (!settings.reduceFlashingChosen) settings.reduceFlashing = prefersReducedMotion();
  return settings;
}

/** Whether the system's settings ask for less motion (prefers-reduced-motion). */
function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export function saveSettings(settings: Settings): void {
  writeSoon(SETTINGS_KEY, settings);
}

/** The Logo Spectrum parameters, validated (defaults for anything missing or invalid). */
export function loadVisuals(): LogoSpectrumSettings {
  return sanitizeSettings(read(VISUALS_KEY));
}

export function saveVisuals(visuals: LogoSpectrumSettings): void {
  writeSoon(VISUALS_KEY, visuals);
}

/** Tempo and effects, validated. */
export function loadSound(): SoundSettings {
  return sanitizeSound(read(SOUND_KEY));
}

export function saveSound(sound: SoundSettings): void {
  writeSoon(SOUND_KEY, sound);
}

/** The user's own presets (PR-01). */
export function loadPresets(): VisualPreset[] {
  const stored = read(PRESETS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (entry): entry is { name: string; settings: unknown } =>
        typeof entry === 'object' && entry !== null && typeof entry.name === 'string',
    )
    .map((entry) => ({
      name: entry.name,
      settings: sanitizeSettings(entry.settings),
      builtIn: false,
    }));
}

export function savePresets(presets: VisualPreset[]): void {
  write(
    PRESETS_KEY,
    presets.filter((preset) => !preset.builtIn).map(({ name, settings }) => ({ name, settings })),
  );
}

/** The Kaleidoscope parameters, validated. */
export function loadKaleido(): KaleidoSettings {
  return sanitizeKaleido(read(KALEIDO_KEY));
}

export function saveKaleido(kaleido: KaleidoSettings): void {
  writeSoon(KALEIDO_KEY, kaleido);
}

/** The user's own Kaleidoscope presets. */
export function loadKaleidoPresets(): KaleidoPreset[] {
  const stored = read(KALEIDO_PRESETS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (entry): entry is { name: string; settings: unknown } =>
        typeof entry === 'object' && entry !== null && typeof entry.name === 'string',
    )
    .map((entry) => ({
      name: entry.name,
      settings: sanitizeKaleido(entry.settings),
      builtIn: false,
    }));
}

export function saveKaleidoPresets(presets: KaleidoPreset[]): void {
  write(
    KALEIDO_PRESETS_KEY,
    presets.filter((preset) => !preset.builtIn).map(({ name, settings }) => ({ name, settings })),
  );
}

/** What the export dialog remembers (format, quality, range). */
export function loadExportOptions(): ExportOptions {
  return sanitizeExportOptions(read(EXPORT_KEY));
}

export function saveExportOptions(options: ExportOptions): void {
  write(EXPORT_KEY, options);
}
