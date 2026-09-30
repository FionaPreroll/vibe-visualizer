import { describe, expect, it } from 'vitest';
import { createPrng } from '../util/prng';
import { beatBefore, computeBeatGrid, nearestBeat, type OnsetFeatures } from './beat-grid';
import { detectHits } from './eval/evaluate';
import { createPattern } from './eval/patterns';
import { gridTempo } from './grid-beats';
import { tempoSections } from './tempo-sections';

const FRAME_RATE = 48000 / 512;

/** Onset features with a pulse on every beat of `beatTimes` (seconds), plus a little noise. */
function pulses(beatTimes: number[], seconds: number, seed = 3): OnsetFeatures {
  const frames = Math.round(seconds * FRAME_RATE);
  const random = createPrng(seed);
  const onset = Float32Array.from({ length: frames }, () => random() * 0.1);
  const accent = Float32Array.from({ length: frames }, () => random() * 0.1);
  for (const time of beatTimes) {
    // Frame i reports at (i + 1) / FRAME_RATE.
    const frame = Math.round(time * FRAME_RATE) - 1;
    if (frame < 0 || frame >= frames) continue;
    onset[frame] = 1;
    accent[frame] = 1;
  }
  return {
    frameRate: FRAME_RATE,
    onset,
    accent,
    active: new Uint8Array(frames).fill(1),
    delay: 0,
  };
}

/** Beat times of a tempo curve: `bpmAt(t)` beats per minute at time t. */
function beatsOf(seconds: number, bpmAt: (time: number) => number, first = 0.3): number[] {
  const beats: number[] = [];
  for (let time = first; time < seconds; time += 60 / bpmAt(time)) beats.push(time);
  return beats;
}

/** Fraction of the true beats after `from` seconds with a detected beat within 25 ms. */
function matched(detected: Float64Array, truth: number[], from: number): number {
  const late = truth.filter((time) => time >= from);
  const found = late.filter((time) => detected.some((beat) => Math.abs(beat - time) < 0.025));
  return found.length / late.length;
}

describe('beat grid', () => {
  it('finds the beats of a steady pulse from the start', () => {
    const truth = beatsOf(40, () => 128);
    const grid = computeBeatGrid(pulses(truth, 40));
    expect(matched(grid.beats, truth, 0)).toBeGreaterThan(0.97);
    expect(grid.beats.length).toBeLessThan(truth.length + 3);
    expect(Math.min(...grid.confidence.subarray(2, -2))).toBeGreaterThan(0.8);
  });

  it('follows a jump to a new tempo, as between two tracks of a mix', () => {
    const truth = beatsOf(80, (time) => (time < 40 ? 120 : 140));
    const grid = computeBeatGrid(pulses(truth, 80));
    expect(matched(grid.beats, truth, 0)).toBeGreaterThan(0.95);
    expect(matched(grid.beats, truth, 42)).toBeGreaterThan(0.97);
  });

  it('follows a gradual tempo change', () => {
    const truth = beatsOf(90, (time) => 118 + (8 * time) / 90);
    const grid = computeBeatGrid(pulses(truth, 90));
    expect(matched(grid.beats, truth, 0)).toBeGreaterThan(0.97);
  });

  it('keeps close to a tempo the user gave (TMP-06)', () => {
    const truth = beatsOf(40, () => 120);
    const features = pulses(truth, 40);
    expect(Math.round(gridTempo(computeBeatGrid(features)))).toBe(120);
    // Double and half: a beat between the pulses too, or only on every second pulse.
    expect(Math.round(gridTempo(computeBeatGrid(features, { bpm: 240 })))).toBe(240);
    const half = computeBeatGrid(features, { bpm: 60 });
    expect(Math.round(gridTempo(half))).toBe(60);
    // Its beats are on the pulses (on every second one, whichever).
    const onPulses = Array.from(half.beats.subarray(2)).filter((beat) =>
      truth.some((time) => Math.abs(time - beat) < 0.025),
    );
    expect(onPulses.length).toBeGreaterThan(0.9 * (half.beats.length - 2));
  });

  it('gives a track with a fixed tempo a straight grid', () => {
    // Beats up to 8 ms early or late, a few missing, a few onsets between them.
    const random = createPrng(5);
    const truth = beatsOf(60, () => 128);
    const played = truth
      .filter(() => random() > 0.05)
      .map((time) => time + (random() - 0.5) * 0.016);
    const extra = truth.filter(() => random() < 0.05).map((time) => time + 60 / 128 / 2);
    const grid = computeBeatGrid(
      pulses(
        [...played, ...extra].sort((a, b) => a - b),
        60,
      ),
    );
    const beats = grid.beats;
    const period = (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
    expect(60 / period).toBeCloseTo(128, 1);
    for (let k = 1; k < beats.length; k++) expect(beats[k]! - beats[k - 1]!).toBeCloseTo(period, 9);
    expect(matched(beats, truth, 0)).toBeGreaterThan(0.97);
  });

  it('keeps the grid of a fixed tempo where the onsets stress the offbeat for a while', () => {
    // From 30 to 40 s, the onsets are half a beat late: the drums of that section stress the
    // offbeat, the grid of the track stays.
    const beat = 60 / 172;
    const truth = beatsOf(70, () => 172);
    const onsets = truth.map((time) => (time >= 30 && time < 40 ? time + beat / 2 : time));
    const grid = computeBeatGrid(pulses(onsets, 70));
    const beats = grid.beats;
    const period = (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
    for (let k = 1; k < beats.length; k++) expect(beats[k]! - beats[k - 1]!).toBeCloseTo(period, 9);
    expect(matched(beats, truth, 0)).toBeGreaterThan(0.97);
  });

  it('keeps one tempo in a single track: a stretch at 2/3 of it is brought to it', () => {
    // The middle of the track reads at 2/3 of its tempo (as drum & bass with kicks every three
    // eighths does); the grid stays at the tempo of the rest.
    const truth = beatsOf(90, () => 130);
    const middle = beatsOf(60, () => (130 * 2) / 3, 30).filter((time) => time < 60);
    const onsets = [...truth.filter((time) => time < 30 || time >= 60), ...middle];
    const grid = computeBeatGrid(
      pulses(
        onsets.sort((a, b) => a - b),
        90,
      ),
    );
    expect(gridTempo(grid)).toBeCloseTo(130, 0);
    expect(tempoSections(grid)).toHaveLength(1);
    const outside = truth.filter((time) => time < 30 || time >= 60);
    const found = outside.filter((time) =>
      grid.beats.some((beat) => Math.abs(beat - time) < 0.025),
    );
    expect(found.length / outside.length).toBeGreaterThan(0.97);
  });

  it('finds fast tempos in the fast tempo range (AN-12)', () => {
    // At 174 BPM with only every second pulse sounding strongly, the automatic range prefers
    // half the tempo; the fast range does not reach down to it.
    const truth = beatsOf(40, () => 174);
    const features = pulses(truth, 40);
    for (let k = 1; k < truth.length; k += 2) {
      const frame = Math.round(truth[k]! * FRAME_RATE) - 1;
      features.onset[frame] = 0.45;
      features.accent[frame] = 0.2;
    }
    expect(Math.round(gridTempo(computeBeatGrid(features, { range: 'fast' })))).toBe(174);
  });

  it('has no confidence where there is no beat', () => {
    const random = createPrng(9);
    const frames = Math.round(30 * FRAME_RATE);
    const grid = computeBeatGrid({
      frameRate: FRAME_RATE,
      onset: Float32Array.from({ length: frames }, () => random()),
      accent: Float32Array.from({ length: frames }, () => random()),
      active: new Uint8Array(frames).fill(1),
      delay: 0,
    });
    expect(Math.max(...grid.confidence)).toBeLessThan(0.2);
  });

  // Drum & bass and hardcore tempt the tempo path to half their tempo; techno has a kick on
  // every beat, so only the harmony and the snares tell its bars.
  it.each(['dnb', 'hardcore', 'techno'])('finds the tempo and the bars of %s', (name) => {
    const pattern = createPattern(name, 12);
    const hits = detectHits(pattern.left, pattern.right, pattern.sampleRate);
    const grid = computeBeatGrid(hits.onsets);
    expect(gridTempo(grid) / pattern.bpm).toBeCloseTo(1, 1);
    const downbeats = pattern.downbeats.slice(1);
    const found = downbeats.filter((time) =>
      grid.beats.some((beat, k) => Math.abs(beat - time) < 0.05 && grid.beatInBar![k] === 0),
    );
    expect(found.length).toBe(downbeats.length);
    const bars = Array.from(grid.beatInBar!).filter((position) => position === 0).length;
    expect(bars).toBeLessThanOrEqual(pattern.downbeats.length + 1);
  });

  it('finds the beat at or before a time', () => {
    const grid = { beats: Float64Array.of(0.5, 1, 1.5), confidence: new Float32Array(3) };
    expect(beatBefore(grid, 0.2)).toBe(-1);
    expect(beatBefore(grid, 0.5)).toBe(0);
    expect(beatBefore(grid, 1.2)).toBe(1);
    expect(beatBefore(grid, 9)).toBe(2);
  });

  it('snaps to the nearest beat where the rhythm is clear', () => {
    const grid = { beats: Float64Array.of(0.5, 1, 1.5), confidence: Float32Array.of(1, 1, 0) };
    expect(nearestBeat(grid, 0.3)).toBe(0.5);
    expect(nearestBeat(grid, 0.7)).toBe(0.5);
    expect(nearestBeat(grid, 0.8)).toBe(1);
    // The last beat has no confidence: nothing to snap to.
    expect(nearestBeat(grid, 1.4)).toBeNull();
    // More than half a beat before the first beat: nothing near.
    expect(nearestBeat(grid, 0.1)).toBeNull();
    expect(
      nearestBeat({ beats: new Float64Array(0), confidence: new Float32Array(0) }, 1),
    ).toBeNull();
  });
});
