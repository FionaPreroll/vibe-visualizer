import { TEMPO_HINT_RANGE } from '../analysis/beat-grid';
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
import { isAspectRatio, sanitizeExportOptions, type ExportOptions } from '../export/video-format';
import {
  CUE_COUNT,
  DEFAULT_SETTINGS,
  INPUT_GAIN_RANGE,
  APP_NAME_LENGTH,
  PANEL_TABS,
  REPEAT_MODES,
  SYNC_OFFSET_RANGE,
  VISUAL_MODES,
  WAVEFORM_STYLES,
  type Settings,
  type TrackData,
} from './app-state';

const SETTINGS_KEY = 'vibe-visualizer:settings:v1';
const VISUALS_KEY = 'vibe-visualizer:visuals:v1';
const PRESETS_KEY = 'vibe-visualizer:presets:v1';
const KALEIDO_KEY = 'vibe-visualizer:kaleido:v1';
const KALEIDO_PRESETS_KEY = 'vibe-visualizer:kaleido-presets:v1';
const EXPORT_KEY = 'vibe-visualizer:export:v1';
const SOUND_KEY = 'vibe-visualizer:sound:v1';
/** Per file (by fingerprint): its cues, markers and corrected tempo. */
const TRACK_PREFIX = 'vibe-visualizer:track:v1:';

/** A time within the track, or null. */
function time(value: unknown, duration: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= duration
    ? value
    : null;
}

/** A tempo the user can give (TMP-06), or null. */
function tempo(value: unknown): number | null {
  return typeof value === 'number' && value >= TEMPO_HINT_RANGE.min && value <= TEMPO_HINT_RANGE.max
    ? value
    : null;
}

/** The cues, markers and tempo stored for a file (TR-05), validated against its duration. */
export function loadTrackData(fingerprint: string, duration: number): TrackData | null {
  const stored = read(TRACK_PREFIX + fingerprint) as {
    cues?: unknown;
    marks?: { in?: unknown; out?: unknown };
    tempo?: unknown;
  } | null;
  if (!stored || typeof stored !== 'object') return null;
  const cues = Array.isArray(stored.cues) ? stored.cues : [];
  const marks = { in: time(stored.marks?.in, duration), out: time(stored.marks?.out, duration) };
  if (marks.in !== null && marks.out !== null && marks.out <= marks.in) marks.out = null;
  return {
    cues: Array.from({ length: CUE_COUNT }, (_, index) => time(cues[index], duration)),
    marks,
    tempo: tempo(stored.tempo),
  };
}

/** Stores the cues, markers and tempo of a file; nothing to store removes the entry. */
export function saveTrackData(fingerprint: string, data: TrackData): void {
  const empty =
    data.cues.every((cue) => cue === null) &&
    data.marks.in === null &&
    data.marks.out === null &&
    data.tempo === null;
  if (empty) {
    try {
      localStorage.removeItem(TRACK_PREFIX + fingerprint);
    } catch {
      // Storage blocked.
    }
    return;
  }
  write(TRACK_PREFIX + fingerprint, { cues: data.cues, marks: data.marks, tempo: data.tempo });
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the value stays for this session only.
  }
}

/** Stored settings merged over the defaults; unknown or mistyped values are ignored. */
export function loadSettings(): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(settings) as (keyof Settings)[]) {
      const value = stored[key];
      if (typeof value === typeof DEFAULT_SETTINGS[key]) {
        (settings as Record<keyof Settings, unknown>)[key] = value;
      }
    }
    if (!PANEL_TABS.includes(settings.panel)) settings.panel = DEFAULT_SETTINGS.panel;
    if (!VISUAL_MODES.includes(settings.visualMode))
      settings.visualMode = DEFAULT_SETTINGS.visualMode;
    settings.volume = Math.max(0, Math.min(1, settings.volume));
    if (!isAspectRatio(settings.aspect)) settings.aspect = DEFAULT_SETTINGS.aspect;
    if (!REPEAT_MODES.includes(settings.repeat)) settings.repeat = DEFAULT_SETTINGS.repeat;
    if (!WAVEFORM_STYLES.includes(settings.waveformStyle)) {
      settings.waveformStyle = DEFAULT_SETTINGS.waveformStyle;
    }
    settings.inputGain = Number.isFinite(settings.inputGain)
      ? Math.max(INPUT_GAIN_RANGE.min, Math.min(INPUT_GAIN_RANGE.max, settings.inputGain))
      : DEFAULT_SETTINGS.inputGain;
    settings.appName =
      settings.appName.trim().slice(0, APP_NAME_LENGTH) || DEFAULT_SETTINGS.appName;
    settings.syncOffset = Number.isFinite(settings.syncOffset)
      ? Math.max(SYNC_OFFSET_RANGE.min, Math.min(SYNC_OFFSET_RANGE.max, settings.syncOffset))
      : DEFAULT_SETTINGS.syncOffset;
  } catch {
    // Unreadable storage: defaults.
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

/** The Logo Spectrum parameters, validated (defaults for anything missing or invalid). */
export function loadVisuals(): LogoSpectrumSettings {
  return sanitizeSettings(read(VISUALS_KEY));
}

export function saveVisuals(visuals: LogoSpectrumSettings): void {
  write(VISUALS_KEY, visuals);
}

/** Tempo and effects, validated. */
export function loadSound(): SoundSettings {
  return sanitizeSound(read(SOUND_KEY));
}

export function saveSound(sound: SoundSettings): void {
  write(SOUND_KEY, sound);
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
  write(KALEIDO_KEY, kaleido);
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
