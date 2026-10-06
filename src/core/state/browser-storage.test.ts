import { describe, expect, it } from 'vitest';
import { analysisBytes, entryBytes, formatBytes, split, trackBytes } from './browser-storage';
import { STORAGE_PREFIX, TRACK_PREFIX } from './persistence';

describe('what the app keeps in the browser (UI-12)', () => {
  it('counts the details and covers of each track together, apart from the settings', () => {
    const entries = {
      [`${TRACK_PREFIX}aaa`]: '{"cues":[1]}',
      [`${TRACK_PREFIX}bbb`]: '{"cues":[2]}',
      [`${STORAGE_PREFIX}settings:v1`]: '{"volume":1}',
    };
    const tracks = trackBytes(entries, [
      { name: 'bbb', bytes: 5000 },
      { name: 'ccc', bytes: 3000 },
      { name: 'not a fingerprint.txt', bytes: 1 },
    ]);
    expect([...tracks.keys()].sort()).toEqual(['aaa', 'bbb', 'ccc']);
    const aaa = entryBytes(`${TRACK_PREFIX}aaa`, '{"cues":[1]}');
    expect(tracks.get('aaa')).toBe(aaa);
    expect(tracks.get('bbb')).toBe(aaa + 5000);
    expect(tracks.get('ccc')).toBe(3000);
  });

  it('finds the analysis of a track by its file, and what is not in the queue', () => {
    const analysis = analysisBytes([
      { name: 'aaa.bin', bytes: 100 },
      { name: 'bbb.bin', bytes: 200 },
      { name: 'stray.tmp', bytes: 50 },
    ]);
    expect(analysis).toEqual(
      new Map([
        ['aaa', 100],
        ['bbb', 200],
      ]),
    );
    expect(split(analysis, new Set(['aaa']))).toEqual({
      count: 2,
      bytes: 300,
      unused: { count: 1, bytes: 200 },
    });
    expect(split(new Map(), new Set())).toEqual({
      count: 0,
      bytes: 0,
      unused: { count: 0, bytes: 0 },
    });
  });

  it('says sizes as people read them', () => {
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(999)).toBe('999 bytes');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(820_000)).toBe('820 KB');
    expect(formatBytes(3_400_000)).toBe('3.4 MB');
    expect(formatBytes(12_000_000_000)).toBe('12 GB');
  });
});
