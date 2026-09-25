import { describe, expect, it } from 'vitest';
import { sceneDefaults } from '../render/kaleido-settings';
import { DEFAULT_LOGO_SPECTRUM, RANGES } from '../render/visual-settings';
import {
  initialState,
  LIVE_OFF,
  newTrack,
  reducer,
  trackRange,
  type AppAction,
  type AppState,
} from './app-state';
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

  it('changes visual settings and keeps them valid', () => {
    const changed = reducer(initialState(), {
      type: 'visuals/changed',
      changes: { glow: 2, palette: 'fire' },
    });
    expect(changed.visuals.glow).toBe(RANGES.glow[1]);
    expect(changed.visuals.palette).toBe('fire');
    const reset = reducer(changed, { type: 'visuals/replaced', visuals: DEFAULT_LOGO_SPECTRUM });
    expect(reset.visuals).toEqual(DEFAULT_LOGO_SPECTRUM);
  });

  it('switches Kaleidoscope scenes with their look and keeps parameters valid', () => {
    const crystal = reducer(initialState(), { type: 'kaleido/scene', scene: 'crystal' });
    expect(crystal.kaleido.scene).toBe('crystal');
    expect(crystal.kaleido.common['flow']).toBe(sceneDefaults('crystal').common['flow']);
    const changed = reducer(crystal, {
      type: 'kaleido/param',
      scope: 'crystal',
      key: 'points',
      value: 99,
    });
    expect(changed.kaleido.scenes.crystal['points']).toBe(12);
    const common = reducer(changed, {
      type: 'kaleido/param',
      scope: 'common',
      key: 'segments',
      value: 3,
    });
    expect(common.kaleido.common['segments']).toBe(3);
    // Switching back keeps the other scene's own parameters.
    const back = reducer(common, { type: 'kaleido/scene', scene: 'vortex' });
    expect(back.kaleido.scenes.crystal['points']).toBe(12);
  });

  it('keeps in/out markers inside the track and in order (TR-09)', () => {
    let state = reducer(initialState(), {
      type: 'tracks/added',
      tracks: [newTrack('a', { name: 'a.mp3', size: 1 })],
    });
    state = reducer(state, {
      type: 'tracks/probed',
      id: 'a',
      info: { ...state.tracks[0]!, status: 'ready', duration: 200 },
    });
    const mark = (mark: 'in' | 'out', seconds: number | null) => {
      state = reducer(state, { type: 'tracks/marked', id: 'a', mark, seconds });
      return state.tracks[0]!.marks;
    };
    expect(trackRange(state.tracks[0]!, true)).toEqual({ start: 0, end: 200 });
    expect(mark('in', 30)).toEqual({ in: 30, out: null });
    expect(mark('out', 500)).toEqual({ in: 30, out: 200 });
    expect(trackRange(state.tracks[0]!, true)).toEqual({ start: 30, end: 200 });
    expect(trackRange(state.tracks[0]!, false)).toEqual({ start: 0, end: 200 });
    // An in marker after the out marker clears the out marker, and the other way round.
    expect(mark('in', 250)).toEqual({ in: 200, out: null });
    expect(mark('out', 60)).toEqual({ in: null, out: 60 });
    expect(mark('out', null)).toEqual({ in: null, out: null });
  });

  it('tracks live input: starting, running, failing, monitoring and stopping (IN-01…04)', () => {
    let state = reducer(initialState(), { type: 'player/playing', playing: true });
    state = reducer(state, { type: 'live/starting', kind: 'device' });
    expect(state.live.status).toBe('starting');
    state = reducer(state, { type: 'live/started', kind: 'device', label: 'Line in' });
    // The queue pauses while live input is the source.
    expect(state.playing).toBe(false);
    expect(state.live).toMatchObject({ status: 'on', label: 'Line in', monitor: false });
    state = reducer(state, { type: 'live/monitor', monitor: true });
    expect(state.live.monitor).toBe(true);
    // A failed switch keeps the running input; a new source starts unmonitored.
    state = reducer(state, { type: 'live/starting', kind: 'display' });
    state = reducer(state, {
      type: 'live/failed',
      message: 'Sharing was cancelled',
      running: true,
    });
    expect(state.live).toMatchObject({
      status: 'on',
      label: 'Line in',
      error: 'Sharing was cancelled',
    });
    state = reducer(state, { type: 'live/started', kind: 'display', label: 'Shared tab' });
    expect(state.live).toMatchObject({ kind: 'display', monitor: false, error: null });
    state = reducer(state, { type: 'live/stopped', reason: 'Sharing has ended.' });
    expect(state.live).toEqual({ ...LIVE_OFF, error: 'Sharing has ended.' });
    state = reducer(state, { type: 'live/failed', message: 'Denied', running: false });
    expect(state.live.status).toBe('off');
  });
});
