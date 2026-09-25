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
  DEFAULT_SETTINGS,
  INPUT_GAIN_RANGE,
  PANEL_TABS,
  VISUAL_MODES,
  type Settings,
} from './app-state';

const SETTINGS_KEY = 'vibe-visualizer:settings:v1';
const VISUALS_KEY = 'vibe-visualizer:visuals:v1';
const PRESETS_KEY = 'vibe-visualizer:presets:v1';
const KALEIDO_KEY = 'vibe-visualizer:kaleido:v1';
const KALEIDO_PRESETS_KEY = 'vibe-visualizer:kaleido-presets:v1';
const EXPORT_KEY = 'vibe-visualizer:export:v1';

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
    settings.inputGain = Number.isFinite(settings.inputGain)
      ? Math.max(INPUT_GAIN_RANGE.min, Math.min(INPUT_GAIN_RANGE.max, settings.inputGain))
      : DEFAULT_SETTINGS.inputGain;
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
