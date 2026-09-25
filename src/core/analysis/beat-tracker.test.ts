import { describe, expect, it } from 'vitest';
import { BeatTracker } from './beat-tracker';
import { createPrng } from '../util/prng';

const FRAME_RATE = 48000 / 512;

interface Pattern {
  bpm: number;
  seconds: number;
  /** Onset strength at a position within the beat (0…1), before noise. */
  onset: (phase: number) => number;
  /** Accent at a position within the beat; defaults to the onset strength. */
  accent?: (phase: number) => number;
  /** Where the pattern's beat starts, in beats (shifts the first beat away from frame 0). */
  offset?: number;
}

/** Feeds a synthetic onset-strength pattern with a little noise; returns reported beat times. */
function track(pattern: Pattern, tracker = new BeatTracker(FRAME_RATE)): number[] {
  const random = createPrng(7);
  const period = (60 * FRAME_RATE) / pattern.bpm;
  const beats: number[] = [];
  const frames = Math.round(pattern.seconds * FRAME_RATE);
  for (let n = 0; n < frames; n++) {
    const beatPosition = n / period - (pattern.offset ?? 0);
    const phase = beatPosition - Math.floor(beatPosition);
    const noise = random() * 0.1;
    const onset = pattern.onset(phase) + noise;
    const accent = (pattern.accent ?? pattern.onset)(phase) + noise;
    if (tracker.process(onset, accent)) beats.push(n / FRAME_RATE);
  }
  return beats;
}

/** 1 at the frames closest to the given positions within the beat. */
function impulses(bpm: number, ...positions: number[]): (phase: number) => number {
  const halfFrame = 0.5 / ((60 * FRAME_RATE) / bpm);
  return (phase) =>
    positions.some((p) => Math.abs(phase - p) < halfFrame || Math.abs(phase - p - 1) < halfFrame)
      ? 1
      : 0;
}

/** Fraction of the reported beats after `from` seconds that lie within 35 ms of a true beat. */
function onBeat(beats: number[], bpm: number, offset: number, from = 6): number {
  const period = 60 / bpm;
  const late = beats.filter((time) => time >= from);
  const good = late.filter((time) => {
    const position = time / period - offset;
    const distance = Math.abs(position - Math.round(position)) * period;
    return distance < 0.035;
  });
  return late.length > 0 ? good.length / late.length : 0;
}

describe('BeatTracker', () => {
  it.each([90, 110, 128, 150])('finds tempo and beat of a %i BPM pulse', (bpm) => {
    const tracker = new BeatTracker(FRAME_RATE);
    const beats = track({ bpm, seconds: 20, onset: impulses(bpm, 0), offset: 0.3 }, tracker);
    expect(Math.abs(tracker.bpm / bpm - 1)).toBeLessThan(0.01);
    expect(onBeat(beats, bpm, 0.3)).toBeGreaterThan(0.95);
    expect(tracker.confidence).toBeGreaterThan(0.5);
  });

  it('moves off the offbeat when the accents (kicks) are on the other eighths', () => {
    const bpm = 120;
    // Eighth notes of equal strength (hi-hats), kicks only on the beat.
    for (const offset of [0, 0.25, 0.5, 0.75]) {
      const beats = track({
        bpm,
        seconds: 20,
        onset: impulses(bpm, 0, 0.5),
        accent: impulses(bpm, 0),
        offset,
      });
      expect(onBeat(beats, bpm, offset, 10)).toBeGreaterThan(0.9);
    }
  });

  it('reports beats early by its lead, to cancel the onset delay', () => {
    const bpm = 120;
    const lead = 2;
    const beats = track(
      { bpm, seconds: 15, onset: impulses(bpm, 0), offset: 0.3 },
      new BeatTracker(FRAME_RATE, lead),
    );
    const period = 60 / bpm;
    const late = beats.filter((time) => time > 6);
    const mean =
      late.reduce((sum, time) => {
        const position = time / period - 0.3;
        return sum + (position - Math.round(position)) * period;
      }, 0) / late.length;
    expect(mean * FRAME_RATE).toBeCloseTo(-lead, 0);
  });

  it('reports no beats in silence', () => {
    const tracker = new BeatTracker(FRAME_RATE);
    track({ bpm: 120, seconds: 10, onset: impulses(120, 0) }, tracker);
    let beats = 0;
    for (let n = 0; n < FRAME_RATE * 5; n++) if (tracker.process(0, 0, false)) beats++;
    // The confidence fades within a fraction of a second.
    expect(beats).toBeLessThanOrEqual(2);
    expect(tracker.confidence).toBeLessThan(0.01);
  });
});
