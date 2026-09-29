import { describe, expect, it } from 'vitest';
import { F } from './features';
import { GridBeats, gridTempo } from './grid-beats';

/** A grid at `bpm` from `first` seconds on. */
function grid(bpm: number, count: number, first = 0.5) {
  const beats = Float64Array.from({ length: count }, (_, i) => first + (60 / bpm) * i);
  return { beats, confidence: new Float32Array(count).fill(1) };
}

describe('beats from the grid', () => {
  it('reports each beat once, with its phase and tempo', () => {
    const beats = new GridBeats();
    beats.set(grid(120, 20));
    const frame = new Float32Array(F.size);
    const hits: number[] = [];
    const step = 512 / 48000;
    for (let time = 0; time < 5; time += step) {
      beats.apply(frame, time, 1);
      if (frame[F.beatHit] === 1) hits.push(time);
      if (Math.abs(time - 0.75) < step / 2) expect(frame[F.beatPhase]).toBeCloseTo(0.5, 1);
    }
    expect(hits).toHaveLength(9); // 0.5 … 4.5 s
    expect(hits[0]).toBeGreaterThanOrEqual(0.5);
    expect(hits[0]! - 0.5).toBeLessThan(step);
    expect(frame[F.bpm]).toBeCloseTo(120, 6);
  });

  it('reports the heard tempo, and no hits across a jump', () => {
    const beats = new GridBeats();
    beats.set(grid(100, 100));
    const frame = new Float32Array(F.size);
    beats.apply(frame, 1, 0.8);
    expect(frame[F.bpm]).toBeCloseTo(80, 6);
    beats.apply(frame, 20, 0.8); // a seek over many beats
    expect(frame[F.beatHit]).toBe(0);
  });

  it('does nothing without a grid', () => {
    const beats = new GridBeats();
    const frame = new Float32Array(F.size).fill(0.5);
    expect(beats.apply(frame, 1, 1)).toBe(false);
    expect(frame[F.beatPhase]).toBe(0.5);
  });

  it('finds the tempo of a track', () => {
    expect(gridTempo(grid(128, 50))).toBeCloseTo(128, 6);
    expect(gridTempo({ beats: new Float64Array(0), confidence: new Float32Array(0) })).toBe(0);
  });
});
