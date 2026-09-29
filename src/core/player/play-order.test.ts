import { describe, expect, it } from 'vitest';
import { newTrack, type Track } from '../state/app-state';
import { nextTrack, previousTrack } from './play-order';

function queue(...ids: string[]): Track[] {
  return ids.map((id) => ({ ...newTrack(id, { name: `${id}.mp3`, size: 1 }), status: 'ready' }));
}

const inOrder = { shuffle: false, repeat: 'off' } as const;

describe('play order', () => {
  it('plays the queue in order and stops at its end', () => {
    const tracks = queue('a', 'b', 'c');
    expect(nextTrack(tracks, 'a', [], inOrder, true)).toBe('b');
    expect(nextTrack(tracks, 'c', [], inOrder, true)).toBeNull();
    expect(previousTrack(tracks, 'b', [], inOrder)).toBe('a');
    expect(previousTrack(tracks, 'a', [], inOrder)).toBeNull();
  });

  it('skips files that cannot play', () => {
    const tracks = queue('a', 'b', 'c');
    tracks[1] = { ...tracks[1]!, status: 'unsupported' };
    expect(nextTrack(tracks, 'a', [], inOrder, true)).toBe('c');
  });

  it('starts again with repeat all, and repeats the track with repeat one', () => {
    const tracks = queue('a', 'b');
    expect(nextTrack(tracks, 'b', [], { shuffle: false, repeat: 'all' }, true)).toBe('a');
    expect(previousTrack(tracks, 'a', [], { shuffle: false, repeat: 'all' })).toBe('b');
    const one = { shuffle: false, repeat: 'one' } as const;
    expect(nextTrack(tracks, 'a', [], one, true)).toBe('a');
    // The Next button still moves on.
    expect(nextTrack(tracks, 'a', [], one, false)).toBe('b');
  });

  it('shuffles: every track once per round, then a new round with repeat', () => {
    const tracks = queue('a', 'b', 'c', 'd');
    const shuffle = { shuffle: true, repeat: 'off' } as const;
    const played = ['a'];
    let current = 'a';
    for (let i = 0; i < 3; i++) {
      const next = nextTrack(tracks, current, played, shuffle, true, () => 0.99)!;
      expect(played).not.toContain(next);
      played.push(next);
      current = next;
    }
    expect(nextTrack(tracks, current, played, shuffle, true)).toBeNull();
    const again = nextTrack(tracks, current, played, { shuffle: true, repeat: 'all' }, true);
    expect(again).not.toBeNull();
    expect(again).not.toBe(current);
    // Previous goes back through what was played.
    expect(previousTrack(tracks, current, played, shuffle)).toBe(played[played.length - 2]);
  });
});
