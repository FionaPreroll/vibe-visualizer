import { describe, expect, it } from 'vitest';
import { F } from './features';
import { GridBeats, gridTempo, tempoSections } from './grid-beats';

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
    // Beats that alternate by a frame (at 94 frames per second) still give the tempo.
    const jittered = grid(240, 64);
    jittered.beats.forEach((time, k) => (jittered.beats[k] = time + (k % 2 ? 0.005 : -0.005)));
    expect(gridTempo(jittered)).toBeCloseTo(240, 0);
    expect(gridTempo({ beats: new Float64Array(0), confidence: new Float32Array(0) })).toBe(0);
  });

  it('splits a grid into sections of steady tempo (Korrektur 5)', () => {
    expect(tempoSections(grid(128, 100))).toEqual([
      { start: 0.5, end: expect.closeTo(0.5 + (99 * 60) / 128, 9), bpm: expect.closeTo(128, 9) },
    ]);
    // 178 BPM, then 119 (as a drum & bass track read at 2/3 in its middle), then 178 again.
    const fast = grid(178, 80);
    const slow = grid(119, 60, fast.beats[79]! + 60 / 119);
    const again = grid(178, 80, slow.beats[59]! + 60 / 178);
    const joined = {
      beats: Float64Array.from([...fast.beats, ...slow.beats, ...again.beats]),
      confidence: new Float32Array(220).fill(1),
    };
    const sections = tempoSections(joined);
    expect(sections.map((section) => Math.round(section.bpm))).toEqual([178, 119, 178]);
    // The slower section starts on the last beat of the fast one, where the intervals change.
    expect(sections[1]!.start).toBe(fast.beats[79]);
    expect(sections[0]!.end).toBe(sections[1]!.start);
    expect(sections[2]!.start).toBe(slow.beats[59]);
    expect(tempoSections({ beats: new Float64Array(0), confidence: new Float32Array(0) })).toEqual(
      [],
    );
  });

  it('joins short stretches and unsure beats to the section around them', () => {
    // A fill of 12 beats at another tempo, and a break without a clear rhythm.
    const before = grid(120, 60);
    const fill = grid(150, 12, before.beats[59]! + 0.4);
    const after = grid(120, 60, fill.beats[11]! + 0.5);
    const beats = Float64Array.from([...before.beats, ...fill.beats, ...after.beats]);
    const confidence = new Float32Array(beats.length).fill(1);
    const unsure = grid(90, 40, beats[beats.length - 1]! + 0.5);
    const all = {
      beats: Float64Array.from([...beats, ...unsure.beats]),
      confidence: Float32Array.from([...confidence, ...new Float32Array(40)]),
    };
    const sections = tempoSections(all);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.end).toBe(all.beats[all.beats.length - 1]);
  });
});
