import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME } from './app-state';
import { loadSettings } from './persistence';

/** A localStorage of the test's own. */
function stubStorage(entries: Record<string, string>): void {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
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
