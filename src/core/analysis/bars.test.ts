import { describe, expect, it } from 'vitest';
import { createPrng } from '../util/prng';
import { findBars, LEVEL_FLOOR_DB, LEVEL_STEP } from './bars';
import type { OnsetFeatures } from './beat-grid';
import { SPECTRUM_BANDS } from './features';

/** Beats every 44 frames (128 BPM at 94 frames per second). */
const PERIOD = 44;
const COUNT = 96;
const beatFrames = Array.from({ length: COUNT }, (_, k) => 20 + k * PERIOD);

interface Music {
  /** Position of beat k in its bar. */
  position: (k: number) => number;
  /** Positions with a kick and with a snare. */
  kick?: number[];
  snare?: number[];
  /** A new chord on every downbeat. */
  harmony?: boolean;
}

/** Onset features of music with the given bars (a little noise everywhere). */
function features(music: Music): OnsetFeatures {
  const frames = beatFrames[COUNT - 1]! + PERIOD;
  const random = createPrng(11);
  const noise = (scale: number) => Float32Array.from({ length: frames }, () => random() * scale);
  const kick = noise(1);
  const snare = noise(1);
  const steps = Math.ceil(frames / LEVEL_STEP);
  const levels = new Uint8Array(steps * SPECTRUM_BANDS);
  let chord: number[] = [];
  for (let k = 0; k < COUNT; k++) {
    const position = music.position(k);
    const at = beatFrames[k]!;
    if (music.kick?.includes(position)) kick[at + 1] = 8;
    if (music.snare?.includes(position)) snare[at + 1] = 8;
    if (position === 0 || chord.length === 0) {
      chord = Array.from({ length: SPECTRUM_BANDS }, () => -50 + random() * 20);
    }
    const end = Math.min(steps, Math.floor((beatFrames[k + 1] ?? frames) / LEVEL_STEP));
    for (let s = Math.floor(at / LEVEL_STEP); s < end; s++) {
      for (let b = 0; b < SPECTRUM_BANDS; b++) {
        const db = (music.harmony ? chord[b]! : -40) + random() * 4;
        levels[s * SPECTRUM_BANDS + b] = Math.round((db - LEVEL_FLOOR_DB) * 2);
      }
    }
  }
  return {
    frameRate: 48000 / 512,
    onset: noise(0.1),
    accent: noise(0.1),
    active: new Uint8Array(frames).fill(1),
    kick: music.kick ? kick : undefined,
    snare: music.snare ? snare : undefined,
    levels: music.harmony ? levels : undefined,
    delay: 0,
  };
}

/** The share of beats from `from` on that get their position in the bar. */
function right(positions: Uint8Array, position: (k: number) => number, from = 0): number {
  let count = 0;
  for (let k = from; k < positions.length; k++) if (positions[k] === position(k)) count++;
  return count / (positions.length - from);
}

describe('bars', () => {
  // The first beat is the third of its bar.
  const position = (k: number) => (k + 2) % 4;

  it('finds the downbeats where the harmony changes', () => {
    const bars = findBars(beatFrames, features({ position, harmony: true }));
    expect(right(bars, position)).toBe(1);
  });

  it('finds the downbeats from the kick and the snare on two and four', () => {
    const bars = findBars(beatFrames, features({ position, kick: [0], snare: [1, 3] }));
    expect(right(bars, position)).toBe(1);
  });

  it('follows a bar of two beats', () => {
    // Beats 46 and 47 make a bar of two: beat 48 is a downbeat.
    const shifted = (k: number) => (k < 48 ? position(k) : k % 4);
    const bars = findBars(
      beatFrames,
      features({ position: shifted, harmony: true, kick: [0], snare: [1, 3] }),
    );
    expect(right(bars.subarray(0, 46), shifted)).toBe(1);
    expect(right(bars, shifted, 52)).toBe(1);
  });

  it('counts the bars from the first beat without clues', () => {
    const plain = features({ position }); // no harmony, no drums
    expect(Array.from(findBars(beatFrames.slice(0, 8), plain))).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(findBars(beatFrames, plain)[5]).toBe(1);
  });
});
