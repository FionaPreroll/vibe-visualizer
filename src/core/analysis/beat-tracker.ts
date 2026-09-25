/**
 * Causal beat tracker, after Stark, Davies & Plumbley, "Real-time beat-synchronous analysis of
 * musical audio" (DAFx 2009, the BTrack algorithm), simplified and extended:
 *
 * - Tempo: autocorrelation of the onset strength over the last ~5.5 s, summed over the first four
 *   multiples of each candidate period (a comb), weighted by a preference for tempos around
 *   120 BPM and smoothed over time by a Viterbi-style step that favours small tempo changes.
 * - Phase: a cumulative score adds each frame's onset strength to the best score about one beat
 *   period earlier. Halfway between two beats, the score is extended into the future to predict
 *   the next beat. Because beats are predicted, they can be reported `lead` frames early, which
 *   cancels the delay of the onset strength itself.
 * - Offbeat check: with steady eighth notes (hi-hats), the score cannot tell beats from offbeats.
 *   Every four beats, the accent signal (kick and drum-body energy) on the last beats is compared
 *   with the accent halfway between them; if the offbeats are clearly stronger, the tracker
 *   moves by half a beat.
 *
 * Allocation-free after construction: safe to run in the AudioWorklet.
 */

const MIN_BPM = 75;
const MAX_BPM = 180;
const PRIOR_BPM = 120;
/** Width of the tempo preference, in octaves. */
const PRIOR_OCTAVES = 0.9;
/** Seconds of onset strength used for tempo estimation. */
const TEMPO_WINDOW_SECONDS = 5.5;
/** Tempo is re-estimated every this many frames. */
const TEMPO_EVERY = 16;
/** Frames before the first tempo estimate (1.4 s at 94 frames per second). */
const TEMPO_START_FRAMES = 128;
/** Candidate periods are spaced this many frames apart. */
const PERIOD_STEP = 0.5;
/** Allowed tempo change between two estimates (standard deviation, relative). */
const TEMPO_CHANGE = 0.03;
/** Weight of the past in the cumulative score, and the tightness of its beat window. */
const ALPHA = 0.9;
const TIGHTNESS = 5;
/** Averaging of the onset strength for the confidence estimate, in beats. */
const CONFIDENCE_BEATS = 8;
/** Beats compared by the offbeat check. */
const PHASE_CHECK_BEATS = 8;
/** The offbeats must carry this much more accent than the beats to shift the phase. */
const PHASE_FLIP_RATIO = 1.3;
/** Beats are only reported with at least this confidence. */
const MIN_CONFIDENCE = 0.1;
/** Time constant of the activity measure (silence lets the confidence fall), in seconds. */
const ACTIVITY_SECONDS = 0.25;

export class BeatTracker {
  readonly frameRate: number;
  /** Beats are reported this many frames before the onset strength peaks. */
  readonly lead: number;
  /** Tempo in beats per minute. */
  bpm = PRIOR_BPM;
  /** Beat period in frames. */
  period: number;
  /** 0…1: how clearly the onsets follow the beat; 0 in silence. */
  confidence = 0;

  private readonly onsets: Float64Array;
  private readonly accents: Float64Array;
  private readonly cumulative: Float64Array;
  private readonly detrended: Float64Array;
  private readonly autocorrelation: Float64Array;
  private readonly periods: Float64Array;
  private readonly prior: Float64Array;
  private readonly state: Float64Array;
  private readonly nextState: Float64Array;
  /** transition[i * count + j]: weight of moving from period j to period i. */
  private readonly transition: Float64Array;
  private readonly future: Float64Array;
  private readonly beatFrames = new Float64Array(PHASE_CHECK_BEATS).fill(-1);
  private beatCount = 0;
  /** Frames processed so far. */
  private frame = 0;
  /** Frame of the last beat (on the onset-strength clock, i.e. without the lead). */
  private lastBeat = 0;
  private nextBeat = -1;
  private predicted = false;
  private onBeatStrength = 0;
  private meanStrength = 0;
  /** Beats and frames seen by the strength averages (for their warm-up). */
  private strengthBeats = 0;
  private strengthFrames = 0;
  /** 1 while there is sound, falling towards 0 in silence. */
  private activity = 0;
  private rawConfidence = 0;

  constructor(frameRate: number, lead = 0) {
    this.frameRate = frameRate;
    this.lead = lead;
    this.period = (60 * frameRate) / PRIOR_BPM;
    const maxPeriod = (60 * frameRate) / MIN_BPM;
    const minPeriod = (60 * frameRate) / MAX_BPM;
    // Enough history for the tempo window and for the offbeat check.
    const history = Math.max(TEMPO_WINDOW_SECONDS * frameRate, (PHASE_CHECK_BEATS + 2) * maxPeriod);
    const length = 2 ** Math.ceil(Math.log2(history));
    this.onsets = new Float64Array(length);
    this.accents = new Float64Array(length);
    this.cumulative = new Float64Array(length);
    this.detrended = new Float64Array(Math.round(TEMPO_WINDOW_SECONDS * frameRate));
    this.autocorrelation = new Float64Array(Math.ceil(4 * maxPeriod) + 2);
    const count = Math.floor((maxPeriod - minPeriod) / PERIOD_STEP) + 1;
    this.periods = Float64Array.from({ length: count }, (_, i) => minPeriod + i * PERIOD_STEP);
    this.prior = this.periods.map((period) => {
      const octaves = Math.log2((60 * frameRate) / period / PRIOR_BPM) / PRIOR_OCTAVES;
      return Math.exp(-0.5 * octaves * octaves);
    });
    this.state = new Float64Array(count).fill(1 / count);
    this.nextState = new Float64Array(count);
    this.transition = new Float64Array(count * count);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        const change = Math.log(this.periods[i]! / this.periods[j]!) / TEMPO_CHANGE;
        this.transition[i * count + j] = Math.exp(-0.5 * change * change);
      }
    }
    this.future = new Float64Array(Math.ceil(maxPeriod) + 2);
  }

  /** The reported time, in frames: the last processed frame plus the lead. */
  private get now(): number {
    return this.frame - 1 + this.lead;
  }

  /** Frames since the last reported beat. */
  get sinceBeat(): number {
    return Math.max(0, this.now - this.lastBeat);
  }

  /** Beat phase: 0 on the beat, rising to just below 1 before the next. */
  get phase(): number {
    return Math.min(0.999, this.sinceBeat / this.period);
  }

  /**
   * Feeds the onset strength of the next frame, and its accent: the strength of the sounds that
   * usually mark the beat (kick and drum body), used to tell beats from offbeats. `active` is
   * false for silent frames. Returns true if a beat is reported on this frame (beats are tracked
   * all the time, but only reported with some confidence).
   */
  process(onset: number, accent: number, active = true): boolean {
    const mask = this.onsets.length - 1;
    const n = this.frame;
    this.onsets[n & mask] = onset;
    this.accents[n & mask] = accent;
    this.cumulative[n & mask] = (1 - ALPHA) * onset + ALPHA * this.bestPast(n, n);
    this.frame++;
    this.strengthFrames++;
    const meanRate = Math.max(1 / this.strengthFrames, 1 / (CONFIDENCE_BEATS * this.period));
    this.meanStrength += (onset - this.meanStrength) * meanRate;
    this.activity += ((active ? 1 : 0) - this.activity) / (ACTIVITY_SECONDS * this.frameRate);
    this.confidence = this.rawConfidence * Math.min(1, this.activity * 1.5);

    if (n % TEMPO_EVERY === 0 && n >= TEMPO_START_FRAMES) this.estimateTempo();

    if (this.nextBeat < 0) {
      this.lastBeat = n;
      this.nextBeat = n + Math.round(this.period);
    }
    if (!this.predicted && n - this.lastBeat >= this.period / 2) {
      this.updateConfidence();
      this.predictNextBeat(n);
      this.predicted = true;
    }

    if (n + this.lead < this.nextBeat) return false;
    if (this.beatCount % 4 === 3 && this.onOffbeat(n)) {
      // Skip this beat: the next one comes half a period later.
      this.nextBeat += Math.round(this.period / 2);
      this.beatFrames.fill(-1);
      this.beatCount = 0;
      return false;
    }
    this.lastBeat = this.nextBeat;
    this.nextBeat = this.lastBeat + Math.round(this.period);
    this.predicted = false;
    this.beatFrames[this.beatCount % PHASE_CHECK_BEATS] = this.lastBeat;
    this.beatCount++;
    return this.confidence >= MIN_CONFIDENCE;
  }

  /** Whether the accents halfway between the recent beats are clearly stronger than on them. */
  private onOffbeat(n: number): boolean {
    const half = this.period / 2;
    let onBeat = 0;
    let offBeat = 0;
    for (let i = 0; i < PHASE_CHECK_BEATS; i++) {
      const beat = this.beatFrames[i]!;
      if (beat < 0 || beat + half + 2 > n || n - beat > this.accents.length - 4) continue;
      onBeat += this.peakAccent(beat);
      offBeat += this.peakAccent(beat + half);
    }
    return offBeat > 0 && offBeat > PHASE_FLIP_RATIO * onBeat;
  }

  private peakAccent(frame: number): number {
    const mask = this.accents.length - 1;
    const center = Math.round(frame);
    let max = 0;
    for (let j = center - 2; j <= center + 2; j++) max = Math.max(max, this.accents[j & mask]!);
    return max;
  }

  /** Confidence: onset strength at the last beat compared to the average onset strength. */
  private updateConfidence(): void {
    const mask = this.onsets.length - 1;
    let strength = 0;
    for (let j = this.lastBeat - 1; j <= this.lastBeat + 2; j++) {
      if (j >= 0 && j < this.frame) strength = Math.max(strength, this.onsets[j & mask]!);
    }
    this.strengthBeats++;
    const rate = Math.max(1 / this.strengthBeats, 1 / CONFIDENCE_BEATS);
    this.onBeatStrength += (strength - this.onBeatStrength) * rate;
    const ratio = this.meanStrength > 1e-9 ? this.onBeatStrength / this.meanStrength : 0;
    this.rawConfidence = Math.min(1, Math.max(0, (ratio - 1.2) / 1.5));
  }

  /**
   * The best cumulative score about one period before frame `t`, weighted by a log-Gaussian
   * window around t − period. Scores after frame `known` come from the future extension.
   */
  private bestPast(t: number, known: number): number {
    const mask = this.cumulative.length - 1;
    const period = this.period;
    const from = Math.max(t - Math.round(2 * period), known - this.cumulative.length + 1, 0);
    const to = Math.min(t - Math.round(period / 2), t - 1);
    let best = 0;
    for (let v = from; v <= to; v++) {
      const score = v <= known ? this.cumulative[v & mask]! : this.future[v - known]!;
      const x = TIGHTNESS * Math.log((t - v) / period);
      const value = Math.exp(-0.5 * x * x) * score;
      if (value > best) best = value;
    }
    return best;
  }

  /** Extends the cumulative score into the future and picks the most likely next beat. */
  private predictNextBeat(n: number): void {
    const period = this.period;
    const expected = this.lastBeat + period;
    const horizon = Math.min(this.future.length - 1, Math.ceil(expected + period / 2 - n));
    let bestFrame = Math.round(expected);
    let bestValue = 0;
    for (let j = 1; j <= horizon; j++) {
      this.future[j] = ALPHA * this.bestPast(n + j, n);
      const offset = (n + j - expected) / (period / 4);
      const weighted = this.future[j]! * Math.exp(-0.5 * offset * offset);
      if (weighted > bestValue) {
        bestValue = weighted;
        bestFrame = n + j;
      }
    }
    this.nextBeat = bestFrame;
  }

  /** Re-estimates the beat period from the autocorrelation of the recent onset strength. */
  private estimateTempo(): void {
    const mask = this.onsets.length - 1;
    const length = this.detrended.length;
    const newest = this.frame - 1;
    // Remove the local average (an adaptive threshold) and keep the peaks.
    const half = 8;
    for (let i = 0; i < length; i++) {
      const n = newest - length + 1 + i;
      if (n < 0) {
        this.detrended[i] = 0;
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, n - half); j <= Math.min(newest, n + half); j++) {
        sum += this.onsets[j & mask]!;
        count++;
      }
      const value = this.onsets[n & mask]! - sum / count;
      this.detrended[i] = value > 0 ? value : 0;
    }
    // Smooth slightly: widens the autocorrelation peaks, so that periods between two whole
    // frames (e.g. 37.5 frames at 150 BPM) still line up with the candidate grid.
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const current = this.detrended[i]!;
      const next = i + 1 < length ? this.detrended[i + 1]! : 0;
      this.detrended[i] = 0.25 * previous + 0.5 * current + 0.25 * next;
      previous = current;
    }
    const acf = this.autocorrelation;
    for (let lag = 0; lag < acf.length; lag++) {
      let sum = 0;
      for (let i = lag; i < length; i++) sum += this.detrended[i]! * this.detrended[i - lag]!;
      // Unbiased: compensates for the shrinking overlap.
      acf[lag] = sum / (length - lag);
    }
    if (acf[0]! <= 1e-12) return;

    // Comb over the first four multiples of each period, times the tempo preference, then a
    // Viterbi-style step from the previous estimate.
    const periods = this.periods;
    let total = 0;
    for (let i = 0; i < periods.length; i++) {
      let comb = 0;
      for (let m = 1; m <= 4; m++) comb += interpolate(acf, periods[i]! * m) / acf[0]!;
      const likelihood = Math.max(1e-6, comb) * this.prior[i]!;
      let best = 0;
      const row = i * periods.length;
      for (let j = 0; j < periods.length; j++) {
        const value = this.state[j]! * this.transition[row + j]!;
        if (value > best) best = value;
      }
      this.nextState[i] = likelihood * (best + 1e-3 / periods.length);
      total += this.nextState[i]!;
    }
    let bestIndex = 0;
    for (let i = 0; i < periods.length; i++) {
      this.state[i] = this.nextState[i]! / total;
      if (this.state[i]! > this.state[bestIndex]!) bestIndex = i;
    }
    // Refine between neighbouring candidates (parabolic interpolation).
    const left = this.state[Math.max(0, bestIndex - 1)]!;
    const center = this.state[bestIndex]!;
    const right = this.state[Math.min(periods.length - 1, bestIndex + 1)]!;
    const curvature = left - 2 * center + right;
    const shift =
      curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / curvature)) : 0;
    this.period = periods[bestIndex]! + shift * PERIOD_STEP;
    this.bpm = (60 * this.frameRate) / this.period;
  }

  reset(): void {
    this.onsets.fill(0);
    this.accents.fill(0);
    this.cumulative.fill(0);
    this.state.fill(1 / this.state.length);
    this.beatFrames.fill(-1);
    this.beatCount = 0;
    this.frame = 0;
    this.lastBeat = 0;
    this.nextBeat = -1;
    this.predicted = false;
    this.period = (60 * this.frameRate) / PRIOR_BPM;
    this.bpm = PRIOR_BPM;
    this.confidence = 0;
    this.rawConfidence = 0;
    this.onBeatStrength = 0;
    this.meanStrength = 0;
    this.strengthBeats = 0;
    this.strengthFrames = 0;
    this.activity = 0;
  }
}

function interpolate(values: Float64Array, position: number): number {
  const index = Math.floor(position);
  if (index + 1 >= values.length) return 0;
  const t = position - index;
  return values[index]! * (1 - t) + values[index + 1]! * t;
}
