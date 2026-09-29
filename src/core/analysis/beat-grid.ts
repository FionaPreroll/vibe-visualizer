/**
 * Beat grid for a whole file (AN-07): the beats of the track, computed offline from the onset
 * strength that the live beat tracker also uses. Seeing the whole track, it needs no time to
 * lock on and follows tempo changes of long mixes:
 *
 * 1. Tempo path: every half second, the autocorrelation of the last 10 s of onsets (kept up to
 *    date as a running sum) is scored with a comb over four multiples of each candidate period,
 *    times a preference for tempos around 120 BPM. A Viterbi pass over the whole track finds the
 *    most likely path of tempos, preferring small changes.
 * 2. Beats: dynamic programming (after Ellis, "Beat Tracking by Dynamic Programming", 2007)
 *    chooses the sequence of beats that best matches strong onsets while keeping each interval
 *    close to the local period. Accents (kicks and drum bodies) count extra, so beats land on
 *    the kicks rather than on the offbeat hi-hats.
 * 3. Each beat gets a confidence: how much stronger the onsets are on the beats than around them.
 * 4. The tempo is checked against the snares: double or 3/2 of the tempo found wins where it
 *    puts them clearly on the second and fourth beat of each bar (drum & bass read as 87 or 116
 *    instead of 174, hardcore as 89 instead of 178). Slower tempos are not tried, since a
 *    half-time feel (dubstep, trap) and swing show a backbeat there too. This is decided in
 *    windows of a few seconds, so a mix may change its tempo.
 */

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
}

const MIN_BPM = 75;
const MAX_BPM = 180;
const PRIOR_BPM = 120;
/** Width of the tempo preference, in octaves. */
const PRIOR_OCTAVES = 0.8;
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
 * Ratios of the score on the beats to the typical score between them, for no and for full
 * confidence. Measured: noise 2.1, a sustained pad 1.5, real recordings (MDB Drums) 5.2–8.8.
 */
const RATIO_NONE = 2.5;
const RATIO_FULL = 4.5;

/** The beats of a track from its onset features. */
export function computeBeatGrid(features: OnsetFeatures): BeatGrid {
  const frames = features.onset.length;
  if (frames < 4) return { beats: new Float64Array(0), confidence: new Float32Array(0) };
  const onset = detrend(features.onset);
  const score = beatScore(onset, detrend(features.accent));
  let periods = tempoPath(onset, features.frameRate);
  let beatFrames = trackBeats(score, periods);
  if (features.snare) {
    const checked = checkBackbeat(score, periods, beatFrames, features.snare, features.frameRate);
    if (checked !== periods) {
      periods = checked;
      beatFrames = trackBeats(score, periods);
    }
  }
  const beats = new Float64Array(beatFrames.length);
  for (let k = 0; k < beatFrames.length; k++) {
    beats[k] = (refine(onset, beatFrames[k]!) + 1) / features.frameRate - features.delay;
  }
  return { beats, confidence: confidences(score, beatFrames, features.active) };
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
function tempoPath(onset: Float64Array, frameRate: number): Float64Array {
  const frames = onset.length;
  const minPeriod = (60 * frameRate) / MAX_BPM;
  const maxPeriod = (60 * frameRate) / MIN_BPM;
  const count = Math.floor((maxPeriod - minPeriod) / PERIOD_STEP) + 1;
  const candidates = Float64Array.from({ length: count }, (_, i) => minPeriod + i * PERIOD_STEP);
  const logPrior = candidates.map((period) => {
    const octaves = Math.log2((60 * frameRate) / period / PRIOR_BPM) / PRIOR_OCTAVES;
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
 * much more clearly on the second and fourth beat, that tempo wins. Returns `periods` when
 * nothing changes, otherwise the corrected periods.
 */
function checkBackbeat(
  score: Float64Array,
  periods: Float64Array,
  beatFrames: number[],
  snare: Float32Array,
  frameRate: number,
): Float64Array {
  const frames = periods.length;
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
  if (smoothed.every((value) => value === 0)) return periods;
  const corrected = new Float64Array(frames);
  for (let n = 0; n < frames; n++) {
    const w = Math.min(starts.length - 1, Math.max(0, Math.round((n - window / 2) / hop)));
    corrected[n] = periods[n]! / candidates[smoothed[w]!]!;
  }
  return corrected;
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
