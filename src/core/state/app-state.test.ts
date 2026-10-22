import { describe, expect, it } from 'vitest';
import { NO_GRID_EDIT } from '../analysis/grid-edit';
import { sceneDefaults } from '../render/kaleido-settings';
import { BUILT_IN_PRESETS, DEFAULT_LOGO_SPECTRUM, RANGES } from '../render/visual-settings';
import {
  CUE_COUNT,
  initialState,
  LIVE_OFF,
  newTrack,
  reducer,
  restoredTrack,
  sanitizeTrackLook,
  shownArtist,
  shownCover,
  shownTitle,
  trackEdit,
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
        fingerprint: 'abc',
      },
    });
    expect(probed.tracks[0]).toMatchObject({ title: 'Song', artist: 'Artist', status: 'ready' });
    expect(probed.tracks[0]!.cues).toEqual(Array(CUE_COUNT).fill(null));
  });

  it('brings back stored cues and markers, and sets and clears cues within the track', () => {
    const cues = [12, null, 30, null, null, null, null, 170];
    let state = reducer(withTracks('Song.mp3'), {
      type: 'tracks/probed',
      id: 't0',
      info: {
        status: 'ready',
        reason: null,
        title: null,
        artist: null,
        album: null,
        duration: 180,
        sampleRate: 44100,
        codec: 'mp3',
        format: 'MP3',
        coverUrl: null,
        fingerprint: 'abc',
        stored: {
          cues,
          marks: { in: 10, out: 40 },
          tempo: 174,
          fixedTempo: true,
          gridEdit: { shift: 0.02, downbeat: 1.5 },
          edit: { title: 'Better title', artist: null },
          colors: { source: 'own', own: ['#ff2fd6'], vivid: 1.4 },
          look: { mode: 'kaleidoscope', preset: 'Neon Mandala' },
        },
      },
    });
    expect(state.tracks[0]).toMatchObject({
      cues,
      marks: { in: 10, out: 40 },
      tempo: 174,
      fixedTempo: true,
      gridEdit: { shift: 0.02, downbeat: 1.5 },
      edit: { title: 'Better title', artist: null },
      colors: { source: 'own', own: ['#ff2fd6'], vivid: 1.4 },
      look: { mode: 'kaleidoscope', preset: 'Neon Mandala' },
    });
    // A look of its own for every entry of the file (PR-06), and none again.
    state = reducer(state, { type: 'tracks/look', fingerprint: 'abc', look: null });
    expect(state.tracks[0]!.look).toBeNull();
    state = reducer(state, { type: 'tracks/cue', id: 't0', index: 1, seconds: 500 });
    expect(state.tracks[0]!.cues[1]).toBe(180);
    state = reducer(state, { type: 'tracks/cue', id: 't0', index: 0, seconds: null });
    expect(state.tracks[0]!.cues.slice(0, 3)).toEqual([null, 180, 30]);
    // Slots beyond the eight are ignored.
    const same = reducer(state, { type: 'tracks/cue', id: 't0', index: 8, seconds: 5 });
    expect(same.tracks[0]!.cues).toEqual(state.tracks[0]!.cues);
  });

  it('names a file as the user gives it, for every entry of that file (LS-18)', () => {
    let state = withTracks('a.mp3', 'b.mp3', 'c.mp3');
    state = {
      ...state,
      tracks: state.tracks.map((track, i) => ({
        ...track,
        fingerprint: i < 2 ? 'same' : 'other',
        artist: 'DJ',
      })),
    };
    const track = state.tracks[0]!;
    // What the file has already is no edit.
    expect(trackEdit(track, ' a ', 'DJ')).toBeNull();
    const edit = trackEdit(track, '  Night Drive ', '');
    expect(edit).toEqual({ title: 'Night Drive', artist: null });
    state = reducer(state, { type: 'tracks/edited', id: 't0', edit });
    expect(state.tracks.map(shownTitle)).toEqual(['Night Drive', 'Night Drive', 'c']);
    expect(state.tracks.map(shownArtist)).toEqual([null, null, 'DJ']);
    // Without a title, the file's stays.
    expect(trackEdit(track, '   ', 'Someone')).toEqual({ title: 'a', artist: 'Someone' });
    // A name given while the file is probed is kept when its tags come in.
    let probing = withTracks('new.mp3');
    probing = reducer(probing, {
      type: 'tracks/edited',
      id: 't0',
      edit: { title: 'Mine', artist: null },
    });
    probing = reducer(probing, {
      type: 'tracks/probed',
      id: 't0',
      info: {
        status: 'ready',
        reason: null,
        title: 'Tagged',
        artist: 'Someone',
        album: null,
        duration: 60,
        sampleRate: 44100,
        codec: 'mp3',
        format: 'MP3',
        coverUrl: null,
        fingerprint: 'new',
      },
    });
    expect(shownTitle(probing.tracks[0]!)).toBe('Mine');
    state = reducer(state, { type: 'tracks/edited', id: 't1', edit: null });
    expect(state.tracks.map(shownTitle)).toEqual(['a', 'b', 'c']);
  });

  it('sets the tempo, fixed or not, the grid correction and the colours of every entry of a file', () => {
    let state = withTracks('a', 'b', 'c');
    state = {
      ...state,
      tracks: state.tracks.map((track, i) => ({ ...track, fingerprint: i < 2 ? 'same' : 'other' })),
    };
    state = reducer(state, { type: 'tracks/tempo', fingerprint: 'same', tempo: 174 });
    const edit = { shift: -0.01, downbeat: 2.5 };
    state = reducer(state, { type: 'tracks/grid', fingerprint: 'same', edit });
    state = reducer(state, { type: 'tracks/fixed', fingerprint: 'same', fixed: true });
    const colors = { source: 'look' as const, own: [], vivid: 1 };
    state = reducer(state, { type: 'tracks/colors', fingerprint: 'same', colors });
    expect(state.tracks.map((track) => track.tempo)).toEqual([174, 174, null]);
    expect(state.tracks.map((track) => track.fixedTempo)).toEqual([true, true, false]);
    expect(state.tracks.map((track) => track.gridEdit)).toEqual([edit, edit, NO_GRID_EDIT]);
    expect(state.tracks.map((track) => track.colors)).toEqual([colors, colors, null]);
  });

  it("shows the cover the user gave a file, on every entry of it, instead of the file's (LS-21)", () => {
    let state = withTracks('a', 'b', 'c');
    state = {
      ...state,
      tracks: state.tracks.map((track, i) => ({
        ...track,
        fingerprint: i < 2 ? 'same' : 'other',
        coverUrl: i === 0 ? 'blob:file' : null,
      })),
    };
    expect(state.tracks.map(shownCover)).toEqual(['blob:file', null, null]);
    state = reducer(state, { type: 'tracks/cover', fingerprint: 'same', url: 'blob:mine' });
    expect(state.tracks.map(shownCover)).toEqual(['blob:mine', 'blob:mine', null]);
    // Probed again as the same file, it keeps it; as another file (changed since), it does not.
    const probed = (id: string, fingerprint: string) =>
      reducer(state, {
        type: 'tracks/probed',
        id,
        info: {
          status: 'ready',
          reason: null,
          title: null,
          artist: null,
          album: null,
          duration: 60,
          sampleRate: 44100,
          codec: 'mp3',
          format: 'MP3',
          coverUrl: null,
          fingerprint,
        },
      });
    expect(shownCover(probed('t1', 'same').tracks[1]!)).toBe('blob:mine');
    expect(shownCover(probed('t1', 'changed').tracks[1]!)).toBeNull();
    state = reducer(state, { type: 'tracks/cover', fingerprint: 'same', url: null });
    expect(state.tracks.map(shownCover)).toEqual(['blob:file', null, null]);
  });

  it('moves tracks', () => {
    const state = reducer(withTracks('a', 'b', 'c'), { type: 'tracks/moved', from: 0, to: 2 });
    expect(state.tracks.map((t) => t.title)).toEqual(['b', 'c', 'a']);
  });

  it('brings back the last queue ahead of new files, with the file status of each entry', () => {
    const info = {
      fileName: 'Old.mp3',
      size: 5,
      title: 'Old song',
      artist: 'Band',
      album: null,
      duration: 200,
      sampleRate: 44100,
      codec: 'mp3',
      format: 'MP3',
      fingerprint: 'fp',
    };
    const cues = [5, null, null, null, null, null, null, null];
    let state = reducer(withTracks('New.mp3'), {
      type: 'tracks/restored',
      tracks: [
        restoredTrack('r0', info, 'locked', {
          cues,
          marks: { in: null, out: 20 },
          tempo: null,
          fixedTempo: false,
          gridEdit: NO_GRID_EDIT,
          edit: null,
          colors: null,
          look: null,
        }),
        restoredTrack('r1', { ...info, fileName: 'Gone.mp3' }, 'missing'),
      ],
      currentId: 'r1',
    });
    expect(state.tracks.map((t) => t.id)).toEqual(['r0', 'r1', 't0']);
    expect(state.tracks[0]).toMatchObject({ status: 'locked', title: 'Old song', cues });
    expect(state.tracks[0]!.marks).toEqual({ in: null, out: 20 });
    expect(state.currentId).toBe('r1');
    state = reducer(state, { type: 'tracks/access', id: 'r0', status: 'probing' });
    expect(state.tracks[0]!.status).toBe('probing');
  });

  it('puts removed tracks back where they were (undo)', () => {
    const state = withTracks('a', 'b', 'c');
    const removed = state.tracks[1]!;
    let next = reducer(state, { type: 'tracks/removed', id: removed.id });
    next = reducer(next, { type: 'undo/offered', label: 'Removed “b”' });
    expect(next.undo).toBe('Removed “b”');
    next = reducer(next, { type: 'tracks/inserted', index: 1, tracks: [removed], currentId: 't1' });
    next = reducer(next, { type: 'undo/offered', label: null });
    expect(next.tracks.map((t) => t.title)).toEqual(['a', 'b', 'c']);
    expect(next.currentId).toBe('t1');
    expect(next.undo).toBeNull();
  });

  it('arranges tracks within the places they hold', () => {
    let state = withTracks('a', 'b', 'c', 'd');
    // A folder's files t1–t3, sorted by track number: they keep their places, in a new order.
    state = reducer(state, { type: 'tracks/arranged', ids: ['t3', 't1', 'gone', 't2'] });
    expect(state.tracks.map((t) => t.id)).toEqual(['t0', 't3', 't1', 't2']);
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
    const store = createStore<AppState, AppAction>(initialState(), reducer, {
      now: () => ++time,
      logLimit: 100,
    });
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

  it('keeps no log unless asked to', () => {
    const store = createStore<AppState, AppAction>(initialState(), reducer);
    store.dispatch({ type: 'player/seeked', seconds: 12 });
    store.dispatch({ type: 'player/playing', playing: true });
    expect(store.log).toEqual([]);
    expect(store.state.playing).toBe(true);
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

  it('gives the Logo Spectrum a Kaleidoscope of its own behind it (VE-08)', () => {
    // A look with an image behind (the default has a Kaleidoscope of its own).
    const classic = reducer(initialState(), {
      type: 'visuals/replaced',
      visuals: BUILT_IN_PRESETS.find((preset) => preset.name === 'Classic Rainbow')!.settings,
    });
    const crystal = reducer(classic, { type: 'kaleido/scene', scene: 'crystal' });
    // Switched to the Kaleidoscope behind, it starts as the Kaleidoscope is set up.
    const layered = reducer(crystal, {
      type: 'visuals/changed',
      changes: { backgroundSource: 'kaleidoscope' },
    });
    expect(layered.visuals.layerLook).toEqual(crystal.kaleido);
    // From then on it is its own: setting it up leaves the Kaleidoscope mode's look …
    const ribbons = reducer(layered, { type: 'layer/scene', scene: 'ribbons' });
    expect(ribbons.visuals.layerLook!.scene).toBe('ribbons');
    expect(ribbons.visuals.layerLook!.common['flow']).toBe(sceneDefaults('ribbons').common['flow']);
    const changed = reducer(ribbons, {
      type: 'layer/param',
      scope: 'common',
      key: 'segments',
      value: 3,
    });
    expect(changed.visuals.layerLook!.common['segments']).toBe(3);
    expect(changed.kaleido).toBe(crystal.kaleido);
    // … and the Kaleidoscope mode's changes leave it.
    const own = reducer(changed, { type: 'kaleido/scene', scene: 'vortex' });
    expect(own.visuals.layerLook).toBe(changed.visuals.layerLook);
    // An image for a while, then the Kaleidoscope again: it is kept.
    const image = reducer(own, { type: 'visuals/changed', changes: { backgroundSource: 'image' } });
    const again = reducer(image, {
      type: 'visuals/changed',
      changes: { backgroundSource: 'kaleidoscope' },
    });
    expect(again.visuals.layerLook).toEqual(changed.visuals.layerLook);
    const preset = reducer(again, { type: 'layer/replaced', kaleido: sceneDefaults('crystal') });
    expect(preset.visuals.layerLook).toEqual(sceneDefaults('crystal'));
    // Without a look of its own yet, setting it up starts from the Kaleidoscope's.
    const fresh = reducer(crystal, {
      type: 'layer/param',
      scope: 'crystal',
      key: 'points',
      value: 5,
    });
    expect(fresh.visuals.layerLook).toEqual({
      ...crystal.kaleido,
      scenes: {
        ...crystal.kaleido.scenes,
        crystal: { ...crystal.kaleido.scenes.crystal, points: 5 },
      },
    });
    expect(reducer(crystal, { type: 'layer/scene', scene: 'crystal' }).visuals.layerLook).toEqual(
      crystal.kaleido,
    );
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

describe('the look of a track (PR-06)', () => {
  it('keeps a preset of a visual mode by name, and nothing else', () => {
    expect(sanitizeTrackLook({ mode: 'logoSpectrum', preset: 'Night Rain' })).toEqual({
      mode: 'logoSpectrum',
      preset: 'Night Rain',
    });
    expect(sanitizeTrackLook({ mode: 'analysis', preset: 'Night Rain' })).toBeNull();
    expect(sanitizeTrackLook({ mode: 'kaleidoscope', preset: ' ' })).toBeNull();
    expect(sanitizeTrackLook('Night Rain')).toBeNull();
  });
});
