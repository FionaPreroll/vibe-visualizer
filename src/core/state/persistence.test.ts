import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_GRID_EDIT } from '../analysis/grid-edit';
import { APP_NAME, CUE_COUNT, DEFAULT_SETTINGS, type TrackData } from './app-state';
import {
  flushWrites,
  loadSettings,
  loadTrackData,
  saveSettings,
  saveTrackData,
  setSaving,
  TRACK_PREFIX,
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

describe('reduce flashing at first', () => {
  afterEach(() => vi.unstubAllGlobals());
  const system = (reduce: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
    }));

  it('follows the system asking for less motion', () => {
    stubStorage({});
    system(true);
    expect(loadSettings().reduceFlashing).toBe(true);
    system(false);
    expect(loadSettings().reduceFlashing).toBe(false);
  });

  it("keeps the user's choice over the system's", () => {
    system(true);
    stubStorage({ [KEY]: JSON.stringify({ reduceFlashing: false, reduceFlashingChosen: true }) });
    expect(loadSettings().reduceFlashing).toBe(false);
    system(false);
    stubStorage({ [KEY]: JSON.stringify({ reduceFlashing: true, reduceFlashingChosen: true }) });
    expect(loadSettings().reduceFlashing).toBe(true);
  });

  it('follows the system until the user chooses, with other settings stored', () => {
    system(true);
    stubStorage({ [KEY]: JSON.stringify({ reduceFlashing: false, reduceFlashingChosen: false }) });
    expect(loadSettings().reduceFlashing).toBe(true);
    // Stored before the choice was kept: off was the default, on was the user's choice.
    stubStorage({ [KEY]: JSON.stringify({ reduceFlashing: false, volume: 0.5 }) });
    expect(loadSettings().reduceFlashing).toBe(true);
    system(false);
    stubStorage({ [KEY]: JSON.stringify({ reduceFlashing: true, volume: 0.5 }) });
    expect(loadSettings()).toMatchObject({ reduceFlashing: true, reduceFlashingChosen: true });
  });

  it('is off without a way to ask the system', () => {
    stubStorage({});
    expect(loadSettings().reduceFlashing).toBe(false);
  });
});

describe('what is kept per file (TR-05)', () => {
  beforeEach(() => stubStorage({}));
  afterEach(() => vi.unstubAllGlobals());

  /** Reads what is stored for a file of 100 seconds. */
  const load = (stored: unknown, duration = 100) => {
    stubStorage({ [`${TRACK_PREFIX}file`]: JSON.stringify(stored) });
    return loadTrackData('file', duration);
  };
  const NOTHING: TrackData = {
    cues: Array.from({ length: CUE_COUNT }, () => null),
    marks: { in: null, out: null },
    tempo: null,
    fixedTempo: false,
    gridEdit: NO_GRID_EDIT,
    edit: null,
    colors: null,
    look: null,
  };

  it('is nothing for a file never kept, or for what is not an object', () => {
    expect(loadTrackData('other', 100)).toBeNull();
    expect(load(5)).toBeNull();
    expect(load([])).toEqual(NOTHING);
    expect(load({})).toEqual(NOTHING);
  });

  it('keeps the cues and markers within the file, and an out marker only after the in marker', () => {
    expect(
      load({ cues: [1, -1, 100.5, 'x', 50, null, 3, 4, 99], marks: { in: 10, out: 5 } }),
    ).toMatchObject({
      cues: [1, null, null, null, 50, null, 3, 4],
      marks: { in: 10, out: null },
    });
    expect(load({ cues: 'x', marks: { in: 0, out: 100 } })).toMatchObject({
      cues: NOTHING.cues,
      marks: { in: 0, out: 100 },
    });
    expect(load({ marks: { in: Number.NaN, out: 120 } })?.marks).toEqual({ in: null, out: null });
    expect(load({ marks: 'x' })?.marks).toEqual({ in: null, out: null });
  });

  it('keeps a tempo the user can give, and the tempo fixed only when it is', () => {
    expect(load({ tempo: 128, fixed: true })).toMatchObject({ tempo: 128, fixedTempo: true });
    expect(load({ tempo: 300, fixed: 'yes' })).toMatchObject({ tempo: null, fixedTempo: false });
    expect(load({ tempo: '128' })?.tempo).toBeNull();
  });

  it('keeps the grid correction, with its first beat up to a second around the file', () => {
    expect(load({ grid: { shift: 0.012345, downbeat: -0.5 } })?.gridEdit).toEqual({
      shift: 0.0123,
      downbeat: -0.5,
    });
    expect(load({ grid: { shift: 'x', downbeat: 101.5 } })?.gridEdit).toEqual({
      shift: 0,
      downbeat: null,
    });
    expect(load({ grid: { shift: 5 } })?.gridEdit.shift).toBeLessThan(5);
    expect(load({ grid: 1 })?.gridEdit).toEqual(NO_GRID_EDIT);
  });

  it('keeps the names given to the file, trimmed, and none without a title', () => {
    expect(load({ edit: { title: '  Song  ', artist: '  ' } })?.edit).toEqual({
      title: 'Song',
      artist: null,
    });
    expect(load({ edit: { title: 'x'.repeat(300), artist: ' Band ' } })?.edit).toEqual({
      title: 'x'.repeat(200),
      artist: 'Band',
    });
    expect(load({ edit: { title: ' ', artist: 'Band' } })?.edit).toBeNull();
    expect(load({ edit: { artist: 'Band' } })?.edit).toBeNull();
  });

  it('keeps the colours and the look given to the file', () => {
    expect(
      load({
        colors: { source: 'own', own: ['#AABBCC'], vivid: 1.5 },
        look: { mode: 'kaleidoscope', preset: 'Deep Space' },
      }),
    ).toMatchObject({
      colors: { source: 'own', own: ['#aabbcc'], vivid: 1.5 },
      look: { mode: 'kaleidoscope', preset: 'Deep Space' },
    });
    expect(load({ colors: 'red', look: { mode: 'analysis', preset: 'x' } })).toMatchObject({
      colors: null,
      look: null,
    });
  });

  it('reads back what it stored, and removes a file with nothing to keep', () => {
    const store = stubStorage({});
    const data: TrackData = {
      cues: [1, null, null, 30, null, null, null, 70],
      marks: { in: 5, out: 95 },
      tempo: 124,
      fixedTempo: true,
      gridEdit: { shift: -0.01, downbeat: 0.25 },
      edit: { title: 'Song', artist: null },
      colors: { source: 'own', own: ['#112233'], vivid: 1 },
      look: { mode: 'logoSpectrum', preset: 'Neon Night' },
    };
    saveTrackData('file', data);
    expect(loadTrackData('file', 100)).toEqual(data);
    saveTrackData('file', NOTHING);
    expect(store.has(`${TRACK_PREFIX}file`)).toBe(false);
  });
});
