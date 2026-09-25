import {
  sanitizeSettings,
  type LogoSpectrumSettings,
  type VisualPreset,
} from '../render/visual-settings';
import { DEFAULT_SETTINGS, VISUAL_MODES, type Settings } from './app-state';

const SETTINGS_KEY = 'vibe-visualizer:settings:v1';
const VISUALS_KEY = 'vibe-visualizer:visuals:v1';
const PRESETS_KEY = 'vibe-visualizer:presets:v1';

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
    if (settings.panel !== 'queue' && settings.panel !== 'visuals') settings.panel = 'queue';
    if (!VISUAL_MODES.includes(settings.visualMode))
      settings.visualMode = DEFAULT_SETTINGS.visualMode;
    settings.volume = Math.max(0, Math.min(1, settings.volume));
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
