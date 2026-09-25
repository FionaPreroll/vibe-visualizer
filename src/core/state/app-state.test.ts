import { describe, expect, it } from 'vitest';
import { initialState, newTrack, reducer, type AppAction, type AppState } from './app-state';
import { createStore } from './store';

function withTracks(...names: string[]): AppState {
  return reducer(initialState(), {
    type: 'tracks/added',
    tracks: names.map((name, i) => newTrack(`t${i}`, { name, size: 1 })),
  });
}

describe('app state', () => {
  it('adds tracks titled after their file name until tags are known', () => {
    const state = withTracks('Artist - Song.mp3');
    expect(state.tracks[0]!.title).toBe('Artist - Song');
    const probed = reducer(state, {
      type: 'tracks/probed',
      id: 't0',
      info: {
        status: 'ready',
        reason: null,
        title: 'Song',
        artist: 'Artist',
        album: null,
        duration: 180,
        sampleRate: 44100,
        codec: 'mp3',
        format: 'MP3',
        coverUrl: null,
      },
    });
    expect(probed.tracks[0]).toMatchObject({ title: 'Song', artist: 'Artist', status: 'ready' });
  });

  it('moves tracks', () => {
    const state = reducer(withTracks('a', 'b', 'c'), { type: 'tracks/moved', from: 0, to: 2 });
    expect(state.tracks.map((t) => t.title)).toEqual(['b', 'c', 'a']);
  });

  it('removing the current track stops playback', () => {
    let state = withTracks('a', 'b');
    state = reducer(state, { type: 'player/current', id: 't0' });
    state = reducer(state, { type: 'player/playing', playing: true });
    state = reducer(state, { type: 'tracks/removed', id: 't0' });
    expect(state).toMatchObject({ currentId: null, playing: false });
    expect(state.tracks).toHaveLength(1);
  });

  it('logs every action with a timestamp, including ones that change nothing', () => {
    let time = 0;
    const store = createStore<AppState, AppAction>(initialState(), reducer, { now: () => ++time });
    const seen: AppState[] = [];
    store.subscribe((state) => seen.push(state));
    store.dispatch({ type: 'player/seeked', seconds: 12 });
    store.dispatch({ type: 'player/playing', playing: true });
    expect(store.log.map((a) => [a.type, a.at])).toEqual([
      ['player/seeked', 1],
      ['player/playing', 2],
    ]);
    expect(seen).toHaveLength(2); // initial call + the one real change
  });
});
