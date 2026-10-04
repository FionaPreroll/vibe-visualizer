import { describe, expect, it } from 'vitest';
import {
  backupFileName,
  describeBackup,
  parseBackup,
  readEntries,
  replaceEntries,
  summarizeBackup,
  type Backup,
} from './backup';

/** localStorage in memory; full after `limit` entries. */
function memoryStorage(entries: Record<string, string> = {}, limit = Infinity): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => {
      if (!map.has(key) && map.size >= limit) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
  };
}

const BACKUP: Backup = {
  app: 'vibe-visualizer',
  kind: 'backup',
  version: 1,
  created: '2026-10-02T20:15:00.000Z',
  storage: {
    'vibe-visualizer:settings:v1': '{"appName":"Club Night"}',
    'vibe-visualizer:presets:v1': '[{"name":"A"},{"name":"B"}]',
    'vibe-visualizer:kaleido-presets:v1': '[{"name":"C"}]',
    'vibe-visualizer:track:v1:abc': '{"cues":[1]}',
    'vibe-visualizer:track:v1:def': '{"tempo":128}',
  },
  images: { logo: 'iVBORw0KGgo=' },
  covers: { abc: 'UklGRg==' },
  analysis: { 'abc.bin': 'VlZHQQ==' },
};

describe('backups (UI-06)', () => {
  it('reads and replaces only the entries of the app, all or none', () => {
    const storage = memoryStorage({
      'vibe-visualizer:settings:v1': '{}',
      'vibe-visualizer:track:v1:old': '{}',
      'another-app': 'keep',
    });
    expect(readEntries(storage)).toEqual({
      'vibe-visualizer:settings:v1': '{}',
      'vibe-visualizer:track:v1:old': '{}',
    });
    replaceEntries(storage, BACKUP.storage);
    expect(readEntries(storage)).toEqual(BACKUP.storage);
    expect(storage.getItem('another-app')).toBe('keep');

    // Storage full: everything as it was.
    const full = memoryStorage({ 'vibe-visualizer:settings:v1': '{}', other: 'x' }, 3);
    expect(() => replaceEntries(full, BACKUP.storage)).toThrow();
    expect(readEntries(full)).toEqual({ 'vibe-visualizer:settings:v1': '{}' });
  });

  it('takes back what it wrote, and leaves out what does not belong in it', () => {
    expect(parseBackup(JSON.stringify(BACKUP))).toEqual(BACKUP);
    const odd = parseBackup(
      JSON.stringify({
        ...BACKUP,
        storage: { ...BACKUP.storage, 'another-app': 'x', 'vibe-visualizer:visuals:v1': 3 },
        images: { logo: 'iVBORw0KGgo=', cover: 'AAAA' },
        covers: { abc: 'UklGRg==', '../escape': 'AAAA', 'def.webp': 'AAAA', ghi: 7 },
        analysis: { 'abc.bin': 'VlZHQQ==', '../escape.bin': 'AAAA' },
      }),
    );
    expect(odd.storage).toEqual(BACKUP.storage);
    expect(odd.images).toEqual(BACKUP.images);
    expect(odd.covers).toEqual(BACKUP.covers);
    expect(odd.analysis).toEqual(BACKUP.analysis);
    // A backup from before covers could be given (LS-21): it has none, so none stay.
    const older: Partial<Backup> = { ...BACKUP };
    delete older.covers;
    expect(parseBackup(JSON.stringify(older)).covers).toEqual({});
    // Without the analysis, there is none in it (rather than none to keep).
    const lean: Partial<Backup> = { ...BACKUP };
    delete lean.analysis;
    expect(parseBackup(JSON.stringify(lean))).not.toHaveProperty('analysis');
  });

  it('says what is wrong with a file that is not a backup', () => {
    expect(() => parseBackup('{')).toThrow('not valid JSON');
    expect(() => parseBackup('{"app":"vibe-visualizer","kind":"presets"}')).toThrow('not a backup');
    expect(() => parseBackup(JSON.stringify({ ...BACKUP, version: 2 }))).toThrow('newer version');
    expect(() => parseBackup(JSON.stringify({ ...BACKUP, version: '1' }))).toThrow('damaged');
    expect(() =>
      parseBackup(JSON.stringify({ ...BACKUP, images: { logo: 'no base64!' } })),
    ).toThrow('damaged');
    expect(() => parseBackup(JSON.stringify({ ...BACKUP, covers: { abc: 'no base64!' } }))).toThrow(
      'damaged',
    );
  });

  it('sums up what is in it', () => {
    const summary = summarizeBackup(BACKUP);
    expect(summary).toEqual({
      created: new Date('2026-10-02T20:15:00.000Z'),
      presets: 3,
      tracks: 2,
      images: 1,
      covers: 1,
      analysis: 1,
    });
    expect(describeBackup(summary)).toBe(
      'the settings, 3 presets, the cues, markers, tempos and names of 2 tracks, 1 image, ' +
        '1 cover and the analysis of 1 track',
    );
    const bare = summarizeBackup({
      ...BACKUP,
      created: 'yesterday',
      storage: {},
      images: {},
      covers: {},
    });
    expect(bare).toMatchObject({ created: null, presets: 0, tracks: 0, images: 0, covers: 0 });
    expect(describeBackup({ ...bare, analysis: null })).toBe('the settings');
  });

  it('is named after the app and the day', () => {
    const day = new Date(2026, 9, 2, 22, 15);
    expect(backupFileName('FibeStation', day)).toBe('FibeStation backup 2026-10-02.json');
    expect(backupFileName('Club: Night?', day)).toBe('Club_ Night_ backup 2026-10-02.json');
    expect(backupFileName('  ', day)).toBe('FibeStation backup 2026-10-02.json');
  });
});
