import { describe, expect, it, vi } from 'vitest';
import type { BeatGrid } from '../analysis/beat-grid';
import { NO_GRID_EDIT } from '../analysis/grid-edit';
import type { TrackAnalysisState } from '../library/track-analyzer';
import { initialState, newTrack, reducer, type AppAction, type AppState } from '../state/app-state';
import { createStore } from '../state/store';
import { GridEditor, type GridAnalysis } from './grid-editor';

/** Twelve beats at 120 BPM from 1 s on, the first of each bar on the first beat. */
function grid(): BeatGrid {
  return {
    beats: Float64Array.from({ length: 12 }, (_, k) => 1 + k * 0.5),
    confidence: new Float32Array(12).fill(1),
    beatInBar: Uint8Array.from({ length: 12 }, (_, k) => k % 4),
  };
}

/** A queue entry of the file `fingerprint`, as after probing. */
function track(id: string, fingerprint: string) {
  return { ...newTrack(id, { name: `${id}.wav`, size: 1 }), fingerprint };
}

/**
 * The editor on a queue of `tracks`, the files of `readable` given by the browser; the analysis
 * has a grid for the files of `analysed`.
 */
function setup(tracks: ReturnType<typeof track>[], readable: string[], analysed: string[] = []) {
  const store = createStore<AppState, AppAction>(initialState(), reducer);
  store.dispatch({ type: 'tracks/added', tracks });
  const files = new Map(readable.map((id) => [id, new File([], `${id}.wav`)]));
  const states = new Map(
    analysed.map((fingerprint): [string, TrackAnalysisState] => [
      fingerprint,
      {
        status: 'done',
        seconds: 7,
        waveform: null,
        grid: grid(),
        tempo: null,
        range: 'auto',
        fixed: false,
        loudness: null,
      },
    ]),
  );
  const analysis = {
    get: (fingerprint: string | null) => (fingerprint ? states.get(fingerprint) : undefined),
    request: vi.fn<GridAnalysis['request']>(),
    setEdit: vi.fn<GridAnalysis['setEdit']>(),
  } satisfies GridAnalysis;
  const playhead = { seconds: 0 };
  const editor = new GridEditor(
    store,
    analysis,
    (id) => files.get(id),
    () => playhead.seconds,
  );
  const entry = (id: string) => store.state.tracks.find((other) => other.id === id)!;
  return { store, files, analysis, playhead, editor, entry };
}

describe('the beat grids as the user wants them', () => {
  it('take the tempo given for a file, for each of its entries, and are computed anew', () => {
    // a and b are the same file: only b's is readable now.
    const { store, files, analysis, editor, entry } = setup(
      [track('a', 'one'), track('b', 'one'), track('c', 'two')],
      ['b', 'c'],
    );
    store.dispatch({ type: 'player/current', id: 'a' });
    editor.setTempo('a', 128.456);
    expect(entry('a').tempo).toBe(128.46);
    expect(entry('b').tempo).toBe(128.46);
    expect(entry('c').tempo).toBeNull();
    expect(analysis.request).toHaveBeenCalledExactlyOnceWith('one', files.get('b'), true, {
      tempo: 128.46,
      range: 'auto',
      fixed: false,
    });
    expect(analysis.setEdit).toHaveBeenCalledWith('one', NO_GRID_EDIT);

    // The same tempo, or one out of range, changes nothing.
    editor.setTempo('b', 128.46);
    editor.setTempo('b', 1000);
    expect(analysis.request).toHaveBeenCalledTimes(1);
    // Without a tempo, the grid finds it again; c does not play, so it waits its turn.
    editor.setTempo('c', 90);
    editor.setTempo('c', null);
    expect(entry('c').tempo).toBeNull();
    expect(analysis.request.mock.calls.map((call) => [call[0], call[2], call[3]?.tempo])).toEqual([
      ['one', true, 128.46],
      ['two', false, 90],
      ['two', false, null],
    ]);
  });

  it('keep one tempo throughout a file when asked', () => {
    const { analysis, editor, entry } = setup([track('a', 'one')], ['a']);
    editor.setFixedTempo('a', true);
    expect(entry('a').fixedTempo).toBe(true);
    expect(analysis.request).toHaveBeenCalledWith('one', expect.any(File), false, {
      tempo: null,
      range: 'auto',
      fixed: true,
    });
    editor.setFixedTempo('a', true);
    expect(analysis.request).toHaveBeenCalledTimes(1);
  });

  it('are found anew in a new tempo range, where no tempo is given: the current one first', () => {
    const tracks = [track('a', 'one'), track('b', 'two'), track('c', 'two'), track('d', 'three')];
    // d's file is not readable (locked): it gets its grid once it is.
    const { store, analysis, editor } = setup(tracks, ['a', 'b', 'c']);
    store.dispatch({ type: 'tracks/tempo', fingerprint: 'one', tempo: 120 });
    store.dispatch({ type: 'player/current', id: 'c' });
    store.dispatch({ type: 'settings/changed', changes: { bpmRange: 'fast' } });
    editor.regridAll();
    expect(analysis.request.mock.calls.map((call) => [call[0], call[2], call[3]?.range])).toEqual([
      ['two', true, 'fast'],
    ]);
  });

  it('are corrected for the track playing, and the correction is kept once committed', () => {
    const { store, analysis, playhead, editor, entry } = setup(
      [track('a', 'one'), track('b', 'two')],
      ['a', 'b'],
      ['one'],
    );
    // Without a track playing, or without its grid, there is nothing to correct.
    editor.nudge(0.01);
    store.dispatch({ type: 'player/current', id: 'b' });
    editor.nudge(0.01);
    expect(analysis.setEdit).not.toHaveBeenCalled();

    store.dispatch({ type: 'player/current', id: 'a' });
    playhead.seconds = 3.1;
    editor.setDownbeat();
    expect(entry('a').gridEdit).toEqual({ shift: 0, downbeat: 3 });
    editor.moveBars(1);
    expect(entry('a').gridEdit).toEqual({ shift: 0, downbeat: 3.5 });
    editor.nudge(0.012);
    expect(entry('a').gridEdit).toEqual({ shift: 0.012, downbeat: 3.5 });

    // While the grid is dragged only the grid follows; the drag's end keeps it.
    editor.shift(0.2, false);
    expect(analysis.setEdit).toHaveBeenLastCalledWith('one', { shift: 0.2, downbeat: 3.5 });
    expect(entry('a').gridEdit.shift).toBe(0.012);
    editor.shift(0.8, true);
    expect(entry('a').gridEdit).toEqual({ shift: 0.5, downbeat: 3.5 });

    editor.reset();
    expect(entry('a').gridEdit).toEqual(NO_GRID_EDIT);
    expect(analysis.setEdit).toHaveBeenLastCalledWith('one', NO_GRID_EDIT);
  });
});
