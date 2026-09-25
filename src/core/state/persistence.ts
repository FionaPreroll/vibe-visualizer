import { DEFAULT_SETTINGS, type Settings } from './app-state';

const SETTINGS_KEY = 'vibe-visualizer:settings:v1';

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
    settings.volume = Math.max(0, Math.min(1, settings.volume));
  } catch {
    // Unreadable storage: defaults.
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: settings stay for this session only.
  }
}
