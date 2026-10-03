import { describe, expect, it } from 'vitest';
import type { TrackAnalyses, TrackAnalysisState } from '../core/library/track-analyzer';
import { newTrack } from '../core/state/app-state';
import { stillCalm } from './stream-info';

const LOUDNESS = { spectrum: -14, energy: -1, bands: [-5, -1, -32, -30, -27, -18] };

function analysis(changes: Partial<TrackAnalysisState>): TrackAnalyses {
  const state: TrackAnalysisState = {
    status: 'running',
    seconds: 0,
    waveform: null,
    grid: null,
    tempo: null,
    range: 'auto',
    loudness: null,
    ...changes,
  };
  return new Map([['f00d', state]]);
}

describe('the camera while a file is analysed (AN-05)', () => {
  const track = { ...newTrack('t1', { name: 'a.mp3', size: 1 }), fingerprint: 'f00d' };

  it('stays calm until how loud the file gets is known', () => {
    expect(stillCalm({ ...track, fingerprint: null }, new Map())).toBe(true);
    expect(stillCalm(track, analysis({ status: 'waiting' }))).toBe(true);
    expect(stillCalm(track, analysis({ status: 'running' }))).toBe(true);
    expect(stillCalm(track, analysis({ status: 'done', loudness: LOUDNESS }))).toBe(false);
  });

  it('moves when there will be no loudness, or one is known from before', () => {
    // Too little sound to tell, or no analysis: the auto-gain alone, as before.
    expect(stillCalm(track, analysis({ status: 'done' }))).toBe(false);
    expect(stillCalm(track, analysis({ status: 'failed' }))).toBe(false);
    expect(stillCalm(track, new Map())).toBe(false);
    // A new grid (another tempo) keeps the loudness found before.
    expect(stillCalm(track, analysis({ status: 'running', loudness: LOUDNESS }))).toBe(false);
  });
});
