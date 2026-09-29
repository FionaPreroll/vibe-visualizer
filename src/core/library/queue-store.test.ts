import { describe, expect, it } from 'vitest';
import { newTrack } from '../state/app-state';
import { parseQueue, storedInfo } from './queue-store';

describe('queue store', () => {
  it('keeps what the queue shows about an entry, not its cover or status', () => {
    const track = {
      ...newTrack('a', { name: 'Song.mp3', size: 10 }),
      status: 'ready' as const,
      title: 'Song',
      duration: 120,
      coverUrl: 'blob:cover',
      fingerprint: 'fp',
    };
    const info = storedInfo(track);
    expect(info).toMatchObject({ fileName: 'Song.mp3', size: 10, title: 'Song', duration: 120 });
    expect(info).not.toHaveProperty('coverUrl');
    expect(info).not.toHaveProperty('status');
  });

  it('checks a stored queue field by field', () => {
    const queue = parseQueue({
      currentId: 'b',
      entries: [
        { id: 'a', info: { fileName: 'A.mp3', size: 1, title: 7, duration: 'long' }, handle: {} },
        { id: 'b', info: { fileName: 'B.mp3', size: 2, artist: 'Band' }, handle: null },
        { id: 'c', info: { size: 3 } },
        'nonsense',
      ],
    });
    expect(queue?.entries.map((entry) => entry.id)).toEqual(['a', 'b']);
    // A wrong type falls back (the title to the file name); a handle must be a real one.
    expect(queue?.entries[0]).toMatchObject({
      info: { title: 'A.mp3', duration: null },
      handle: null,
    });
    expect(queue?.entries[1]!.info.artist).toBe('Band');
    expect(queue?.currentId).toBe('b');
    expect(parseQueue({ entries: [], currentId: 'gone' })?.currentId).toBeNull();
    expect(parseQueue(null)).toBeNull();
    expect(parseQueue({ entries: 'no' })).toBeNull();
  });
});
