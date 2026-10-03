import type { OnsetFeatures } from './beat-grid';
import { SPECTRUM_BANDS } from './features';

/**
 * The bars of a beat grid (AN-07): the position of each beat in its bar, for bars of four
 * beats. Three clues mark a downbeat: the harmony changes there (a new chord or bass note), the
 * kick plays there (often on the third beat too) and the snare on the second and fourth beat.
 * Each beat's clues are compared with those of the beats around it; a hidden Markov model over
 * the beats (each beat takes the position after the one before, a bar of another length is
 * rare) then finds the most likely position of every beat (Viterbi).
 */

/** Frames per step of {@link OnsetFeatures.levels}, and the level of its 0. */
export const LEVEL_STEP = 4;
export const LEVEL_FLOOR_DB = -110;

const BEATS_PER_BAR = 4;

/** Beats on each side against which the clues of a beat are compared. */
const CONTEXT_BEATS = 16;
/** Spectrum bands compared for a change of harmony: about 55 Hz – 3.5 kHz. */
const HARMONY_FIRST_BAND = 6;
const HARMONY_LAST_BAND = 48;
/** Beats on each side of a beat whose spectra are compared for a change of harmony. */
const HARMONY_BEATS = 2;
/**
 * How much each clue counts for each position in the bar (0 = the downbeat), measured on MDB
 * Drums and the genre patterns: the change of harmony counts most; the kick (on the downbeat,
 * often on the third beat) and the snare (on the second and fourth) settle what it leaves open.
 */
const CHANGE_WEIGHTS = [1.5, -0.5, -0.5, -0.5];
const KICK_WEIGHTS = [0.3, -0.3, 0.15, -0.3];
const SNARE_WEIGHTS = [-0.3, 0.3, -0.3, 0.3];
/** Log-probability that a beat does not take the position after the one before. */
const JUMP = -8;

/**
 * The position of each beat in its bar (0 on the downbeat), from the beat frames. Without
 * clues, the bars are counted from the first beat. `steady`: one bar of four after the other
 * throughout (a fixed tempo the user asked for, TR-12), where the clues agree best.
 */
export function findBars(
  beatFrames: readonly number[],
  features: OnsetFeatures,
  steady = false,
): Uint8Array {
  const count = beatFrames.length;
  const positions = new Uint8Array(count);
  for (let k = 0; k < count; k++) positions[k] = k % BEATS_PER_BAR;
  const clues = features.levels ?? features.kick ?? features.snare;
  if (count < 2 * BEATS_PER_BAR || !clues) return positions;
  const evidence = new Float64Array(count * BEATS_PER_BAR);
  const add = (values: Float64Array, weights: readonly number[]) => {
    const z = standardize(values);
    for (let k = 0; k < count; k++) {
      for (let p = 0; p < BEATS_PER_BAR; p++) {
        evidence[k * BEATS_PER_BAR + p]! += weights[p]! * z[k]!;
      }
    }
  };
  if (features.levels) add(harmonyChange(beatFrames, features.levels), CHANGE_WEIGHTS);
  if (features.kick) add(atBeats(beatFrames, features.kick), KICK_WEIGHTS);
  if (features.snare) add(atBeats(beatFrames, features.snare), SNARE_WEIGHTS);
  return steady ? steadyBars(evidence, count) : viterbi(evidence, count);
}

/** Bars of four throughout, from the first beat at the position all clues agree on best. */
function steadyBars(evidence: Float64Array, count: number): Uint8Array {
  let best = 0;
  let bestScore = -Infinity;
  for (let start = 0; start < BEATS_PER_BAR; start++) {
    let score = 0;
    for (let k = 0; k < count; k++)
      score += evidence[k * BEATS_PER_BAR + ((k + start) % BEATS_PER_BAR)]!;
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return Uint8Array.from({ length: count }, (_, k) => (k + best) % BEATS_PER_BAR);
}

/** The largest value from just before each beat to just after it (the drums rise there). */
function atBeats(beatFrames: readonly number[], values: Float32Array): Float64Array {
  const result = new Float64Array(beatFrames.length);
  for (let k = 0; k < beatFrames.length; k++) {
    const at = beatFrames[k]!;
    let strength = 0;
    for (let f = at - 1; f <= at + 3; f++) strength = Math.max(strength, values[f] ?? 0);
    result[k] = strength;
  }
  return result;
}

/**
 * How much the spectrum changes at each beat: the mean spectrum of the two beats after it
 * against that of the two before, each without its overall level (in dB per band).
 */
function harmonyChange(beatFrames: readonly number[], levels: Uint8Array): Float64Array {
  const count = beatFrames.length;
  const steps = Math.floor(levels.length / SPECTRUM_BANDS);
  const low = HARMONY_FIRST_BAND;
  const width = HARMONY_LAST_BAND - HARMONY_FIRST_BAND + 1;
  // The mean spectrum from each beat to the next, less its mean level.
  const means = new Float64Array(count * width);
  for (let k = 0; k < count; k++) {
    const start = beatFrames[k]!;
    const end = beatFrames[k + 1] ?? start + (start - (beatFrames[k - 1] ?? start - 1));
    const from = Math.min(steps - 1, Math.floor(start / LEVEL_STEP));
    const to = Math.min(steps, Math.max(from + 1, Math.floor(end / LEVEL_STEP)));
    const row = k * width;
    for (let s = from; s < to; s++) {
      for (let j = 0; j < width; j++) means[row + j]! += levels[s * SPECTRUM_BANDS + low + j]!;
    }
    let level = 0;
    for (let j = 0; j < width; j++) {
      means[row + j]! /= 2 * (to - from); // half-dB steps
      level += means[row + j]!;
    }
    level /= width;
    for (let j = 0; j < width; j++) means[row + j]! -= level;
  }
  const span = HARMONY_BEATS;
  const change = new Float64Array(count);
  for (let k = 1; k < count; k++) {
    const before = Math.min(span, k);
    const after = Math.min(span, count - k);
    let distance = 0;
    for (let j = 0; j < width; j++) {
      let a = 0;
      for (let i = 1; i <= before; i++) a += means[(k - i) * width + j]!;
      let b = 0;
      for (let i = 0; i < after; i++) b += means[(k + i) * width + j]!;
      distance += Math.abs(a / before - b / after);
    }
    change[k] = distance / width;
  }
  change[0] = change[1] ?? 0;
  return change;
}

/** Each value against the beats around it (z-score over the context), limited to ±3. */
function standardize(values: Float64Array): Float64Array {
  const count = values.length;
  const sum = new Float64Array(count + 1);
  const squares = new Float64Array(count + 1);
  for (let k = 0; k < count; k++) {
    sum[k + 1] = sum[k]! + values[k]!;
    squares[k + 1] = squares[k]! + values[k]! * values[k]!;
  }
  const result = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const from = Math.max(0, k - CONTEXT_BEATS);
    const to = Math.min(count, k + CONTEXT_BEATS + 1);
    const n = to - from;
    const mean = (sum[to]! - sum[from]!) / n;
    const variance = Math.max(0, (squares[to]! - squares[from]!) / n - mean * mean);
    const z = (values[k]! - mean) / (Math.sqrt(variance) + 1e-9);
    result[k] = Math.max(-3, Math.min(3, z));
  }
  return result;
}

/** The most likely positions, given the evidence for each beat and position (log-likelihoods). */
function viterbi(evidence: Float64Array, count: number): Uint8Array {
  const n = BEATS_PER_BAR;
  const back = new Uint8Array(count * n);
  let previous = new Float64Array(n);
  let current = new Float64Array(n);
  for (let p = 0; p < n; p++) previous[p] = evidence[p]!;
  for (let k = 1; k < count; k++) {
    let best = 0;
    for (let q = 1; q < n; q++) if (previous[q]! > previous[best]!) best = q;
    for (let p = 0; p < n; p++) {
      const before = (p + n - 1) % n;
      let value = previous[before]!;
      let from = before;
      if (best !== before && previous[best]! + JUMP > value) {
        value = previous[best]! + JUMP;
        from = best;
      }
      current[p] = value + evidence[k * n + p]!;
      back[k * n + p] = from;
    }
    [previous, current] = [current, previous];
  }
  const positions = new Uint8Array(count);
  let state = 0;
  for (let p = 1; p < n; p++) if (previous[p]! > previous[state]!) state = p;
  for (let k = count - 1; k >= 0; k--) {
    positions[k] = state;
    if (k > 0) state = back[k * n + state]!;
  }
  return positions;
}
