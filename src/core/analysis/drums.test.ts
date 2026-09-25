import { beforeAll, describe, expect, it } from 'vitest';
import { createDrumMix, type DrumMix } from './eval/drum-mix';
import { detectHits, type DetectedHits } from './eval/evaluate';
import { scoreOnsets, within } from './eval/score';

// Regression guard for the detectors on the synthetic EDM mix (offbeat bass, sidechain, claps
// with and without a body, open hats, crash, vocal synth, riser). The thresholds sit a little
// below the current results (kick 88 %, snare 98 %, hi-hat 82 %, beat 100 %); see
// docs/ANALYSIS.md for the numbers on real recordings.

let mix: DrumMix;
let hits: DetectedHits;

beforeAll(() => {
  mix = createDrumMix();
  hits = detectHits(mix.left, mix.right, mix.sampleRate);
});

describe('drum detection on the synthetic mix', () => {
  it('finds the kicks and not the offbeat bass', () => {
    const score = scoreOnsets(hits.kicks, mix.kicks);
    expect(score.recall).toBe(1);
    expect(score.f1).toBeGreaterThan(0.85);
    expect(Math.abs(score.meanOffset)).toBeLessThan(0.02);
  });

  it('finds snares and claps, with and without a body, and ignores hi-hats in the intro', () => {
    const score = scoreOnsets(hits.snares, mix.snares);
    expect(score.f1).toBeGreaterThan(0.95);
    expect(Math.abs(score.meanOffset)).toBeLessThan(0.01);
  });

  it('finds the hi-hats and mostly ignores kick clicks', () => {
    const score = scoreOnsets(hits.hats, mix.hats);
    expect(score.f1).toBeGreaterThan(0.78);
    expect(Math.abs(score.meanOffset)).toBeLessThan(0.01);
  });

  it('tracks tempo and beat, through the breakdown without drums', () => {
    const beats: number[] = [];
    for (let time = 0.5; time < mix.left.length / mix.sampleRate - 0.5; time += 60 / mix.bpm) {
      beats.push(time);
    }
    const score = scoreOnsets(within(hits.beats, 5, 1e9), within(beats, 5, 1e9), 0.07);
    expect(score.f1).toBeGreaterThan(0.95);
    expect(hits.bpm).toBeCloseTo(mix.bpm, 0);
  });
});
