import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME, DEFAULT_SETTINGS } from './app-state';
import {
  flushWrites,
  loadSettings,
  saveSettings,
  setSaving,
  WRITE_INTERVAL_MS,
} from './persistence';

/** A localStorage of the test's own. */
function stubStorage(entries: Record<string, string>): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
}

const KEY = 'vibe-visualizer:settings:v1';

describe('the lettering in the ring and the app name', () => {
  beforeEach(() => stubStorage({}));
  afterEach(() => vi.unstubAllGlobals());

  it('is FibeStation at first', () => {
    expect(loadSettings().logoText).toBe(APP_NAME);
  });

  it('keeps a name given to the app before as the lettering in the ring', () => {
    stubStorage({ [KEY]: JSON.stringify({ appName: 'Club Night' }) });
    expect(loadSettings().logoText).toBe('Club Night');
    stubStorage({ [KEY]: JSON.stringify({ appName: 'Old', logoText: 'New' }) });
    expect(loadSettings().logoText).toBe('New');
  });

  it('takes the app name for an empty lettering, and cuts a long one', () => {
    stubStorage({ [KEY]: JSON.stringify({ logoText: '   ' }) });
    expect(loadSettings().logoText).toBe(APP_NAME);
    stubStorage({ [KEY]: JSON.stringify({ logoText: ` ${'x'.repeat(60)} ` }) });
    expect(loadSettings().logoText).toBe('x'.repeat(40));
  });
});

describe('settings changed in bursts', () => {
  let setItem: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    const store = stubStorage({});
    setItem = vi.fn((key: string, value: string) => store.set(key, value));
    vi.stubGlobal('localStorage', { ...localStorage, setItem });
  });
  afterEach(() => {
    flushWrites();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const volume = () =>
    (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { volume?: number }).volume;

  it('stores the first change at once, and the last of a burst after a moment', () => {
    for (let step = 1; step <= 50; step++) saveSettings({ ...DEFAULT_SETTINGS, volume: step / 50 });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(volume()).toBe(0.02);
    vi.advanceTimersByTime(WRITE_INTERVAL_MS);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(volume()).toBe(1);
    // Nothing new: nothing more is written, and the next change is stored at once again.
    vi.advanceTimersByTime(WRITE_INTERVAL_MS * 4);
    expect(setItem).toHaveBeenCalledTimes(2);
    saveSettings({ ...DEFAULT_SETTINGS, volume: 0.5 });
    expect(volume()).toBe(0.5);
  });

  it('stores what waits at once when flushed', () => {
    saveSettings({ ...DEFAULT_SETTINGS, volume: 0.1 });
    saveSettings({ ...DEFAULT_SETTINGS, volume: 0.3 });
    expect(volume()).toBe(0.1);
    flushWrites();
    expect(volume()).toBe(0.3);
    vi.advanceTimersByTime(WRITE_INTERVAL_MS);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('drops what waits once storing stops (a backup is restored)', () => {
    saveSettings({ ...DEFAULT_SETTINGS, volume: 0.1 });
    saveSettings({ ...DEFAULT_SETTINGS, volume: 0.3 });
    setSaving(false);
    vi.advanceTimersByTime(WRITE_INTERVAL_MS);
    flushWrites();
    setSaving(true);
    expect(volume()).toBe(0.1);
  });
});
