/**
 * Beat grid for a whole file (AN-07): the beats of the track, computed offline from the onset
 * strength that the live beat tracker also uses. Seeing the whole track, it needs no time to
 * lock on and follows tempo changes of long mixes:
 *
 * 1. Tempo path: every half second, the autocorrelation of the last 10 s of onsets (kept up to
 *    date as a running sum) is scored with a comb over four multiples of each candidate period,
 *    times a preference within the tempo range: around 120 BPM in the automatic range, around
 *    the middle of a range the user chose (AN-12), or around the tempo the user gave (TMP-06).
 *    A Viterbi pass over the whole track finds the most likely path of tempos, preferring small
 *    changes.
 * 2. In the automatic range, the tempo is checked against the snares: double or 3/2 of it wins
 *    where it puts them clearly on the second and fourth beat of each bar (drum & bass read as
 *    87 or 116 instead of 174, hardcore as 89 instead of 178). Slower tempos are not tried,
 *    since a half-time feel (dubstep, trap) and swing show a backbeat there too. This is
 *    decided in windows of a few seconds.
 * 3. A single track (a file up to 15 minutes) keeps one tempo: stretches at a related tempo
 *    (half, 2/3, 3/4 of it or the inverse) are brought to the main tempo, the one the snares
 *    confirmed or else the one most of the track has. Longer files are mixes and keep their
 *    tempo changes.
 * 4. Beats: dynamic programming (after Ellis, "Beat Tracking by Dynamic Programming", 2007)
 *    chooses the sequence of beats that best matches strong onsets while keeping each interval
 *    close to the local period. Accents (kicks and drum bodies) count extra, so beats land on
 *    the kicks rather than on the offbeat hi-hats.
 * 5. Each beat gets a confidence: how much stronger the onsets are on the beats than around them.
 * 6. A single track whose sure beats lie on one straight grid gets that grid instead: produced
 *    music has a fixed tempo, and the straight grid holds through breaks and stretches where the
 *    beats of step 4 stumble or follow the offbeat.
 * 7. The bars: which beat of its bar each beat is, from the changes of harmony and the drums
 *    ({@link findBars}).
 */

import { findBars } from './bars';

export interface OnsetFeatures {
  /** Analysis frames per second. */
  frameRate: number;
  /** Onset strength per frame (the spectral flux). */
  onset: Float32Array;
  /** Accent per frame: kick and drum-body energy. */
  accent: Float32Array;
  /** 1 for frames with sound. */
  active: Uint8Array;
  /**
   * Rise of the kick band and of the snare band per frame (dB): where the bars start, and
   * whether a tempo puts the snares on the second and fourth beat. Optional: without them the
   * grid has no bars and keeps the tempo it finds.
   */
  kick?: Float32Array;
  snare?: Float32Array;
  /**
   * A coarse spectrum, where the harmony changes (on the downbeats): the spectrum bands of the
   * analysis frame (dB, before the auto-gain) averaged over `LEVEL_STEP` frames, in half-dB
   * steps from `LEVEL_FLOOR_DB` (see bars.ts). Optional: without it the bars follow the drums
   * alone.
   */
  levels?: Uint8Array;
  /**
   * Seconds between an onset in the audio and the moment its frame reports it (the flux peaks
   * a little after the onset; frame i reports at (i + 1) / frameRate).
   */
  delay: number;
}

export interface BeatGrid {
  /** Beat times in seconds, ascending. */
  beats: Float64Array;
  /** How clearly the music follows each beat, 0…1 (0 in silence). */
  confidence: Float32Array;
  /**
   * Position of each beat in its bar of four beats, 0 on the downbeat. Absent from grids
   * without bars (those stored with export jobs).
   */
  beatInBar?: Uint8Array;
}

/** Tempos the grid looks for, and the preference among them. */
interface TempoRange {
  min: number;
  max: number;
  prior: number;
  /** Width of the preference, in octaves. */
  octaves: number;
}

/**
 * The tempo ranges the user can choose for the analysis (AN-12), as in DJ software: without one,
 * the grid prefers tempos around 120 BPM, and fast genres can read at half or 2/3 of their
 * tempo; within 120–200 BPM they cannot.
 */
export type TempoRangeId = 'auto' | 'slow' | 'mid' | 'fast';
export const TEMPO_RANGES: Readonly<Record<TempoRangeId, Readonly<TempoRange>>> = {
  auto: { min: 75, max: 180, prior: 120, octaves: 0.8 },
  slow: { min: 60, max: 120, prior: 85, octaves: 0.5 },
  mid: { min: 90, max: 150, prior: 122, octaves: 0.5 },
  fast: { min: 120, max: 200, prior: 160, octaves: 0.5 },
};
export const TEMPO_RANGE_IDS: readonly TempoRangeId[] = ['auto', 'slow', 'mid', 'fast'];
/**
 * With a tempo from the user (TMP-06): within this factor of it, so no related tempo (4/3, 3/2,
 * double) can take its place, and a narrow preference for it.
 */
const HINT_SPREAD = 1.2;
const HINT_OCTAVES = 0.1;
/** Tempos the user can give, in BPM. */
export const TEMPO_HINT_RANGE = { min: 40, max: 250 } as const;
const TEMPO_WINDOW_SECONDS = 10;
const TEMPO_STEP_SECONDS = 0.5;
/** Candidate periods are spaced this many frames apart. */
const PERIOD_STEP = 0.5;
/** Allowed tempo change per tempo step (standard deviation of the log period). */
const TEMPO_CHANGE = 0.01;
/** Probability floor for a jump to any tempo (a new track in a mix). */
const TEMPO_JUMP = 1e-4;
/** How strictly beat intervals follow the local period. */
const TIGHTNESS = 200;
/** Weight of the accent relative to the onset strength in the beat score. */
const ACCENT_WEIGHT = 1;
/** Beats on each side used for the confidence. */
const CONFIDENCE_BEATS = 8;
/** Faster tempos tried against the snares (factors of the tempo found), up to this BPM. */
const FASTER_TEMPOS = [2, 1.5];
const FASTER_MAX_BPM = 200;
/** Windows (seconds) in which the snares decide the tempo, and their hop. */
const BACKBEAT_WINDOW_SECONDS = 12;
const BACKBEAT_HOP_SECONDS = 6;
/** A related tempo wins with a backbeat at least this clear, and this much clearer. */
const BACKBEAT_MIN = 0.3;
const BACKBEAT_MARGIN = 0.15;
/**
 * Files up to this long are single tracks, keeping one tempo; longer ones are mixes, whose tempo
 * may change from track to track.
 */
const SINGLE_TRACK_SECONDS = 15 * 60;
/** Tempos a single track does not change to: these factors of its main tempo are brought to it. */
const RELATED_FACTORS = [0.5, 2 / 3, 3 / 4, 4 / 3, 1.5, 2];
/** Tempos within this factor count as the same. */
const SAME_TEMPO = 1.04;
/**
 * A track with a fixed tempo gets a straight grid: when at least this share of its sure beats
 * lie within this share of a beat of one (and this many at least), and their spread about it
 * (root mean square, in beats) is at most this. The period is searched within this share of the
 * typical beat interval.
 */
const STEADY_SHARE = 0.7;
const STEADY_TOLERANCE = 0.1;
const STEADY_MIN_BEATS = 32;
const STEADY_SPREAD = 0.04;
const STEADY_SEARCH = 0.01;
/** Bins of the beat positions within a period, in the search for the straight grid. */
const PHASE_BINS = 50;
/** Beats this sure count for the straight grid. */
const STEADY_CONFIDENCE = 0.3;
/**
 * Ratios of the score on the beats to the typical score between them, for no and for full
 * confidence. Measured: noise 2.1, a sustained pad 1.5, real recordings (MDB Drums) 5.2–8.8.
 */
const RATIO_NONE = 2.5;
const RATIO_FULL = 4.5;

export interface BeatGridOptions {
  /**
   * The tempo of the track in BPM, as the user corrected it (TMP-06): the grid keeps close to
   * it, and the snares do not change it. Null or absent: the grid finds the tempo itself.
   */
  bpm?: number | null;
  /** The tempo range the grid looks in when it finds the tempo itself (AN-12). */
  range?: TempoRangeId;
}

/** The beats of a track from its onset features. */
export function computeBeatGrid(features: OnsetFeatures, options: BeatGridOptions = {}): BeatGrid {
  const frames = features.onset.length;
  if (frames < 4) {
    return {
      beats: new Float64Array(0),
      confidence: new Float32Array(0),
      beatInBar: new Uint8Array(0),
    };
  }
  const onset = detrend(features.onset);
  const score = beatScore(onset, detrend(features.accent));
  const frameRate = features.frameRate;
  const hint = options.bpm ?? null;
  const rangeId = options.range ?? 'auto';
  const range: TempoRange = hint
    ? { min: hint / HINT_SPREAD, max: hint * HINT_SPREAD, prior: hint, octaves: HINT_OCTAVES }
    : TEMPO_RANGES[rangeId];
  let periods = tempoPath(onset, frameRate, range);
  // Only without a range or a tempo from the user: the snares may make the tempo faster.
  let confirmed: Uint8Array | null = null;
  if (features.snare && !hint && rangeId === 'auto') {
    const checked = checkBackbeat(score, periods, features.snare, frameRate);
    periods = checked.periods;
    confirmed = checked.confirmed;
  }
  const single = frames / frameRate <= SINGLE_TRACK_SECONDS;
  if (single) periods = unifyTempo(periods, confirmed, features.active, frameRate);
  const beatFrames = trackBeats(score, periods);
  const beats = new Float64Array(beatFrames.length);
  for (let k = 0; k < beatFrames.length; k++) {
    beats[k] = (refine(onset, beatFrames[k]!) + 1) / frameRate - features.delay;
  }
  const confidence = confidences(score, beatFrames, features.active);
  // A fixed tempo: one straight grid instead of beats that follow every onset.
  const straight = single ? straightGrid(beats, confidence) : null;
  if (straight) {
    const straightFrames = Array.from(straight, (time) =>
      Math.max(0, Math.min(frames - 1, Math.round((time + features.delay) * frameRate) - 1)),
    );
    return {
      beats: straight,
      confidence: confidences(score, straightFrames, features.active),
      beatInBar: findBars(straightFrames, features),
    };
  }
  return { beats, confidence, beatInBar: findBars(beatFrames, features) };
}

/** Onset strength above its local mean (an adaptive threshold), slightly smoothed. */
function detrend(values: Float32Array): Float64Array {
  const frames = values.length;
  const half = 8;
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  const raw = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(frames, i + half + 1);
    const value = values[i]! - (prefix[to]! - prefix[from]!) / (to - from);
    raw[i] = value > 0 ? value : 0;
  }
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = 0.25 * (raw[i - 1] ?? 0) + 0.5 * raw[i]! + 0.25 * (raw[i + 1] ?? 0);
  }
  return out;
}

/** The most likely beat period (frames) at every frame, from a Viterbi pass over the track. */
function tempoPath(onset: Float64Array, frameRate: number, range: TempoRange): Float64Array {
  const frames = onset.length;
  const minPeriod = (60 * frameRate) / range.max;
  const maxPeriod = (60 * frameRate) / range.min;
  const count = Math.floor((maxPeriod - minPeriod) / PERIOD_STEP) + 1;
  const candidates = Float64Array.from({ length: count }, (_, i) => minPeriod + i * PERIOD_STEP);
  const logPrior = candidates.map((period) => {
    const octaves = Math.log2((60 * frameRate) / period / range.prior) / range.octaves;
    return -0.5 * octaves * octaves;
  });
  const window = Math.round(TEMPO_WINDOW_SECONDS * frameRate);
  const step = Math.max(1, Math.round(TEMPO_STEP_SECONDS * frameRate));
  const maxLag = Math.ceil(4 * maxPeriod) + 2;
  // Running autocorrelation over the last `window` frames, updated frame by frame.
  const acf = new Float64Array(maxLag + 1);
  const steps = Math.max(1, Math.ceil(frames / step));
  const centres = new Float64Array(steps);
  const logLikelihood = new Float64Array(steps * count);
  let stepIndex = 0;
  for (let n = 0; n < frames; n++) {
    const x = onset[n]!;
    for (let lag = 0; lag <= maxLag && lag <= n; lag++) acf[lag] = acf[lag]! + x * onset[n - lag]!;
    const old = n - window;
    if (old >= 0) {
      const y = onset[old]!;
      for (let lag = 0; lag <= maxLag && lag <= old; lag++) {
        acf[lag] = acf[lag]! - y * onset[old - lag]!;
      }
    }
    if ((n + 1) % step !== 0 && n !== frames - 1) continue;
    const row = stepIndex * count;
    const energy = acf[0]!;
    for (let i = 0; i < count; i++) {
      let comb = 0;
      if (energy > 1e-12) {
        for (let m = 1; m <= 4; m++) comb += interpolate(acf, candidates[i]! * m) / energy;
      }
      logLikelihood[row + i] = Math.log(Math.max(1e-6, comb)) + logPrior[i]!;
    }
    centres[stepIndex] = Math.max(0, n - window / 2);
    stepIndex++;
  }

  // Viterbi over the tempo steps.
  const used = stepIndex;
  const back = new Int32Array(used * count);
  let previous = new Float64Array(count);
  let current = new Float64Array(count);
  for (let i = 0; i < count; i++) previous[i] = logLikelihood[i]!;
  const jump = Math.log(TEMPO_JUMP / count);
  for (let s = 1; s < used; s++) {
    let bestAny = 0;
    for (let j = 1; j < count; j++) if (previous[j]! > previous[bestAny]!) bestAny = j;
    for (let i = 0; i < count; i++) {
      let best = previous[bestAny]! + jump;
      let from = bestAny;
      // Only nearby tempos are more likely than a jump.
      const reach = Math.ceil((candidates[i]! * TEMPO_CHANGE * 4) / PERIOD_STEP) + 1;
      for (let j = Math.max(0, i - reach); j <= Math.min(count - 1, i + reach); j++) {
        const change = Math.log(candidates[i]! / candidates[j]!) / TEMPO_CHANGE;
        const value = previous[j]! - 0.5 * change * change;
        if (value > best) {
          best = value;
          from = j;
        }
      }
      current[i] = best + logLikelihood[s * count + i]!;
      back[s * count + i] = from;
    }
    [previous, current] = [current, previous];
  }
  const path = new Float64Array(used);
  let state = 0;
  for (let i = 1; i < count; i++) if (previous[i]! > previous[state]!) state = i;
  for (let s = used - 1; s >= 0; s--) {
    path[s] = candidates[state]!;
    if (s > 0) state = back[s * count + state]!;
  }
  // Per frame, between the window centres.
  const periods = new Float64Array(frames);
  let s = 0;
  for (let n = 0; n < frames; n++) {
    while (s + 1 < used && centres[s + 1]! <= n) s++;
    if (s + 1 >= used || n <= centres[s]!) {
      periods[n] = path[s]!;
    } else {
      const t = (n - centres[s]!) / (centres[s + 1]! - centres[s]!);
      periods[n] = path[s]! + (path[s + 1]! - path[s]!) * t;
    }
  }
  return periods;
}

/** The score of a beat at each frame: onset strength plus accent, each in units of its spread. */
function beatScore(onset: Float64Array, accent: Float64Array): Float64Array {
  const scale = (values: Float64Array) => {
    let sum = 0;
    for (const value of values) sum += value * value;
    return 1 / Math.max(1e-9, Math.sqrt(sum / values.length));
  };
  const onsetScale = scale(onset);
  const accentScale = scale(accent);
  const score = new Float64Array(onset.length);
  for (let i = 0; i < onset.length; i++) {
    score[i] = onset[i]! * onsetScale + ACCENT_WEIGHT * accent[i]! * accentScale;
  }
  return score;
}

/** The best sequence of beat frames (dynamic programming). */
function trackBeats(score: Float64Array, periods: Float64Array): number[] {
  const frames = score.length;
  const total = new Float64Array(frames);
  const back = new Int32Array(frames).fill(-1);
  for (let t = 0; t < frames; t++) {
    const period = periods[t]!;
    const from = Math.max(0, t - Math.round(2 * period));
    const to = t - Math.round(period / 2);
    let best = 0;
    let bestFrom = -1;
    for (let v = from; v <= to; v++) {
      const x = Math.log((t - v) / period);
      const value = total[v]! - TIGHTNESS * x * x;
      if (bestFrom < 0 || value > best) {
        best = value;
        bestFrom = v;
      }
    }
    // A beat may also start a new sequence (the start of the track).
    if (bestFrom >= 0 && best > 0) {
      total[t] = score[t]! + best;
      back[t] = bestFrom;
    } else {
      total[t] = score[t]!;
    }
  }
  // The last beat: the best total within the last period.
  const lastPeriod = Math.round(periods[frames - 1]!);
  let last = frames - 1;
  for (let t = Math.max(0, frames - lastPeriod); t < frames; t++) {
    if (total[t]! > total[last]!) last = t;
  }
  const beats: number[] = [];
  for (let t = last; t >= 0; t = back[t]!) beats.push(t);
  return beats.reverse();
}

/**
 * How clearly the snares fall on the second and fourth beat, from -1 to 1: the weaker of the two
 * backbeats against the stronger of the other two beats, for the best way to count the bar.
 * Half or 2/3 of the right tempo puts the snares between the beats, double of it leaves only one
 * backbeat per bar.
 */
function backbeatClarity(beatFrames: readonly number[], snare: Float32Array): number {
  if (beatFrames.length < 8) return -1;
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let k = 0; k < beatFrames.length; k++) {
    const at = beatFrames[k]!;
    // The snare band rises during the frame of the beat or just after it.
    let strength = 0;
    for (let f = at - 1; f <= at + 3; f++) strength = Math.max(strength, snare[f] ?? 0);
    sums[k % 4]! += strength;
    counts[k % 4]!++;
  }
  const profile = sums.map((sum, j) => sum / Math.max(1, counts[j]!));
  const total = profile.reduce((a, b) => a + b, 0) / 2;
  if (total <= 1e-6) return -1;
  let best = -1;
  for (let phase = 0; phase < 4; phase++) {
    const backbeat = Math.min(profile[(phase + 1) % 4]!, profile[(phase + 3) % 4]!);
    const other = Math.max(profile[phase]!, profile[(phase + 2) % 4]!);
    best = Math.max(best, (backbeat - other) / total);
  }
  return best;
}

/**
 * Checks the tempo against the snares, window by window: where a faster related tempo puts them
 * much more clearly on the second and fourth beat, that tempo wins. Returns the periods (the
 * same array when nothing changes) and the frames where the snares made the tempo faster.
 */
function checkBackbeat(
  score: Float64Array,
  periods: Float64Array,
  snare: Float32Array,
  frameRate: number,
): { periods: Float64Array; confirmed: Uint8Array | null } {
  const frames = periods.length;
  const beatFrames = trackBeats(score, periods);
  const window = Math.round(BACKBEAT_WINDOW_SECONDS * frameRate);
  const hop = Math.round(BACKBEAT_HOP_SECONDS * frameRate);
  const minPeriod = (60 * frameRate) / FASTER_MAX_BPM;
  const candidates = [1, ...FASTER_TEMPOS];
  // The beats with each faster tempo.
  const tracks = candidates.map((factor) => {
    if (factor === 1) return beatFrames;
    const scaled = periods.map((period) => period / factor);
    return trackBeats(score, scaled);
  });
  const starts: number[] = [];
  for (let start = 0; start === 0 || start + window / 2 < frames; start += hop) starts.push(start);
  const choice = starts.map((start) => {
    const end = Math.min(frames, start + window);
    const middle = periods[Math.min(frames - 1, Math.floor((start + end) / 2))]!;
    const inWindow = (beats: number[]) => beats.filter((at) => at >= start && at < end);
    const found = backbeatClarity(inWindow(tracks[0]!), snare);
    let best = 0;
    let bestClarity = found;
    for (let c = 1; c < candidates.length; c++) {
      if (middle / candidates[c]! < minPeriod) continue;
      const clarity = backbeatClarity(inWindow(tracks[c]!), snare);
      if (clarity >= BACKBEAT_MIN && clarity >= found + BACKBEAT_MARGIN && clarity > bestClarity) {
        best = c;
        bestClarity = clarity;
      }
    }
    return best;
  });
  // A choice holds only where its neighbours agree (no flicker between windows).
  const smoothed = choice.map((value, w) => {
    const around = [choice[w - 1], value, choice[w + 1]].filter((v) => v !== undefined);
    return around.filter((v) => v === value).length * 2 > around.length ? value : 0;
  });
  if (smoothed.every((value) => value === 0)) return { periods, confirmed: null };
  const corrected = new Float64Array(frames);
  const confirmed = new Uint8Array(frames);
  for (let n = 0; n < frames; n++) {
    const w = Math.min(starts.length - 1, Math.max(0, Math.round((n - window / 2) / hop)));
    corrected[n] = periods[n]! / candidates[smoothed[w]!]!;
    confirmed[n] = smoothed[w]! > 0 ? 1 : 0;
  }
  return { periods: corrected, confirmed };
}

/**
 * One tempo for a single track: sections at half, 2/3, 3/2 or double the main tempo are brought
 * to it (a drum & bass track read at 119 BPM in its breaks and at 178 elsewhere is at 178
 * throughout). The main tempo is the one the snares confirmed where they did (see
 * {@link checkBackbeat}), else the one most of the track has. Returns `periods` when nothing
 * changes.
 */
function unifyTempo(
  periods: Float64Array,
  confirmed: Uint8Array | null,
  active: Uint8Array,
  frameRate: number,
): Float64Array {
  const frames = periods.length;
  // A histogram of the tempo in bins of 1/100 octave, over the frames with sound (or over the
  // confirmed ones, where there are enough).
  const bins = new Float64Array(400);
  const binOf = (period: number) => Math.round(100 * Math.log2((60 * frameRate) / period / 30));
  let confirmedCount = 0;
  let activeCount = 0;
  for (let n = 0; n < frames; n++) {
    if (!active[n]) continue;
    activeCount++;
    if (confirmed?.[n]) confirmedCount++;
  }
  const useConfirmed = confirmed !== null && confirmedCount >= 0.05 * activeCount;
  for (let n = 0; n < frames; n++) {
    if (!active[n] || (useConfirmed && !confirmed[n])) continue;
    const bin = binOf(periods[n]!);
    if (bin >= 0 && bin < bins.length) bins[bin]!++;
  }
  let best = -1;
  let bestWeight = 0;
  for (let b = 0; b < bins.length; b++) {
    let weight = 0;
    for (let d = -2; d <= 2; d++) weight += bins[b + d] ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = b;
    }
  }
  if (best < 0) return periods;
  const main = 30 * 2 ** (best / 100);
  let changed = false;
  const unified = periods.slice();
  for (let n = 0; n < frames; n++) {
    const ratio = (60 * frameRate) / periods[n]! / main;
    for (const factor of RELATED_FACTORS) {
      if (Math.abs(Math.log(ratio / factor)) < Math.log(SAME_TEMPO)) {
        unified[n] = periods[n]! * factor;
        changed = true;
        break;
      }
    }
  }
  return changed ? unified : periods;
}

/**
 * A straight grid for a track with a fixed tempo, or null: the period and phase on which most
 * of the sure beats lie (the phase coherence of the beats, searched near their typical interval,
 * then a least-squares fit to the beats on it), if enough of them lie on it closely. Beats the
 * tracker missed, added or put on the offbeat for a while (the drums of a section stress it)
 * do not count against the rest. The straight grid spans the beats found.
 */
function straightGrid(beats: Float64Array, confidence: Float32Array): Float64Array | null {
  const count = beats.length;
  const sure: number[] = [];
  for (let k = 0; k < count; k++) if (confidence[k]! >= STEADY_CONFIDENCE) sure.push(k);
  if (sure.length < STEADY_MIN_BEATS) return null;
  const intervals: number[] = [];
  for (let j = 1; j < sure.length; j++) {
    if (sure[j]! === sure[j - 1]! + 1) intervals.push(beats[sure[j]!]! - beats[sure[j - 1]!]!);
  }
  if (intervals.length < STEADY_MIN_BEATS) return null;
  const guess = median(intervals);
  // The grid through most sure beats: for periods near the guess, in steps finer than the width
  // of a match (a period divided by the beats spanned), the phase with the most beats near it.
  const spanned = (beats[sure[sure.length - 1]!]! - beats[sure[0]!]!) / guess;
  const step = guess / Math.max(1, spanned) / 8;
  const bins = new Int32Array(PHASE_BINS);
  const reach = Math.round(STEADY_TOLERANCE * PHASE_BINS);
  let best = { period: guess, phase: 0, count: -1 };
  for (
    let period = guess * (1 - STEADY_SEARCH);
    period <= guess * (1 + STEADY_SEARCH);
    period += step
  ) {
    bins.fill(0);
    for (const k of sure) {
      const position = beats[k]! / period;
      bins[Math.floor((position - Math.floor(position)) * PHASE_BINS) % PHASE_BINS]!++;
    }
    for (let b = 0; b < PHASE_BINS; b++) {
      let near = 0;
      for (let d = -reach; d <= reach; d++) near += bins[(b + d + PHASE_BINS) % PHASE_BINS]!;
      if (near > best.count) best = { period, phase: (b + 0.5) / PHASE_BINS, count: near };
    }
  }
  let period = best.period;
  let offset = best.phase * period;
  // The beats on the grid, then the line through them (twice, as the grid settles).
  const onGrid = () =>
    sure.filter((k) => {
      const position = (beats[k]! - offset) / period;
      return Math.abs(position - Math.round(position)) < STEADY_TOLERANCE;
    });
  let use = onGrid();
  for (let pass = 0; pass < 2 && use.length >= STEADY_MIN_BEATS; pass++) {
    const index = use.map((k) => Math.round((beats[k]! - offset) / period));
    const fit = lineFit(
      index,
      use.map((k) => beats[k]!),
    );
    period = fit.period;
    offset = fit.offset;
    use = onGrid();
  }
  let squares = 0;
  for (const k of use) {
    const position = (beats[k]! - offset) / period;
    squares += (position - Math.round(position)) ** 2;
  }
  const spread = Math.sqrt(squares / Math.max(1, use.length));
  if (use.length < Math.max(STEADY_MIN_BEATS, STEADY_SHARE * sure.length)) return null;
  if (spread > STEADY_SPREAD) return null;
  const first = Math.round((beats[0]! - offset) / period);
  const last = Math.round((beats[count - 1]! - offset) / period);
  const straight = new Float64Array(Math.max(0, last - first + 1));
  for (let m = first; m <= last; m++) straight[m - first] = offset + period * m;
  return straight;
}

/** The least-squares line y = offset + period · x. */
function lineFit(x: number[], y: number[]): { offset: number; period: number } {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const period = sxx > 0 ? sxy / sxx : 0;
  return { offset: my - period * mx, period };
}

/** Sub-frame position of the onset peak near frame `t` (parabolic interpolation). */
function refine(onset: Float64Array, t: number): number {
  const left = onset[t - 1] ?? 0;
  const centre = onset[t]!;
  const right = onset[t + 1] ?? 0;
  const curvature = left - 2 * centre + right;
  if (curvature >= 0) return t;
  return t + Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / curvature));
}

/**
 * Per beat: how much the nearby beats stand out. The score on each beat is compared with the
 * typical (median) score between it and the next beat; noise or a sustained pad scores alike
 * everywhere, music with a beat does not. The median over the nearby beats keeps a single loud
 * onset (the start of the sound) from making a whole passage look rhythmic.
 */
function confidences(score: Float64Array, beats: number[], active: Uint8Array): Float32Array {
  const frames = score.length;
  const peak = (at: number) => Math.max(score[at] ?? 0, score[at - 1] ?? 0, score[at + 1] ?? 0);
  const sound = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) sound[i + 1] = sound[i]! + active[i]!;
  // Per beat interval: the peak on the beat against the median score of the interval.
  const on = new Float64Array(beats.length);
  const off = new Float64Array(beats.length);
  const between: number[] = [];
  for (let j = 0; j < beats.length; j++) {
    const at = beats[j]!;
    const next = beats[j + 1] ?? at + (at - (beats[j - 1] ?? at - 1));
    on[j] = peak(at);
    between.length = 0;
    for (let t = at + 2; t <= next - 2 && t < frames; t++) between.push(score[t]!);
    off[j] = median(between);
  }
  const floor = 0.1 * median(Array.from(on));
  const ratios = Array.from(on, (value, j) => value / (off[j]! + floor + 1e-12));
  const result = new Float32Array(beats.length);
  const window: number[] = [];
  for (let k = 0; k < beats.length; k++) {
    const first = Math.max(0, k - CONFIDENCE_BEATS);
    const last = Math.min(beats.length - 1, k + CONFIDENCE_BEATS);
    window.length = 0;
    for (let j = first; j <= last; j++) window.push(ratios[j]!);
    const ratio = median(window);
    const from = beats[first]!;
    const to = Math.min(frames, beats[last]! + 1);
    const activity = (sound[to]! - sound[from]!) / Math.max(1, to - from);
    const clarity = (ratio - RATIO_NONE) / (RATIO_FULL - RATIO_NONE);
    result[k] = Math.min(1, Math.max(0, clarity)) * Math.min(1, activity * 1.5);
  }
  return result;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : 0.5 * (sorted[middle - 1]! + sorted[middle]!);
}

function interpolate(values: Float64Array, position: number): number {
  const index = Math.floor(position);
  if (index + 1 >= values.length) return 0;
  const t = position - index;
  return values[index]! * (1 - t) + values[index + 1]! * t;
}

/** Index of the last beat at or before `time`, or -1. */
export function beatBefore(grid: BeatGrid, time: number): number {
  const beats = grid.beats;
  let low = 0;
  let high = beats.length - 1;
  if (high < 0 || beats[0]! > time) return -1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (beats[middle]! <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Beats less sure than this are not snapped to (no clear rhythm there). */
const SNAP_CONFIDENCE = 0.1;

/**
 * The beat nearest to `time` (TR-06: markers and cues snap to it), or null where the grid has
 * no clear beat, or no beat within half a beat (before the first beat or after the last).
 */
export function nearestBeat(grid: BeatGrid, time: number): number | null {
  const beats = grid.beats;
  if (beats.length < 2) return null;
  const before = beatBefore(grid, time);
  const after = Math.min(beats.length - 1, before + 1);
  const index =
    before < 0 || Math.abs(beats[after]! - time) < Math.abs(time - beats[before]!) ? after : before;
  const neighbour = index > 0 ? index - 1 : index + 1;
  const interval = Math.abs(beats[index]! - beats[neighbour]!);
  if (Math.abs(beats[index]! - time) > interval / 2) return null;
  return grid.confidence[index]! >= SNAP_CONFIDENCE ? beats[index]! : null;
}
