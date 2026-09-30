import { beatBefore, type BeatGrid } from './beat-grid';
import { F } from './features';

/**
 * Beat values from a file's beat grid (AN-07) instead of the live beat tracker: the beat phase,
 * the beat hits, the tempo and the confidence at a position in the file. With the grid, the
 * visuals are on the beat from the first second and through tempo changes. Allocation-free.
 */

/** Seconds after a beat until its envelope has fallen to 1/e (as in the analyzer). */
const BEAT_DECAY = 0.1;
/** Beats are reported only with at least this confidence (as by the live tracker). */
const MIN_CONFIDENCE = 0.1;
/** A jump longer than this (a seek) reports no hits for the beats in between. */
const MAX_STEP_SECONDS = 0.5;

export class GridBeats {
  private current: BeatGrid | null = null;
  private lastTime = Number.NEGATIVE_INFINITY;

  get grid(): BeatGrid | null {
    return this.current;
  }

  get active(): boolean {
    return this.current !== null && this.current.beats.length > 1;
  }

  /** Uses `grid` from now on; the next frame reports no hit (the position may have jumped). */
  set(grid: BeatGrid | null): void {
    this.current = grid;
    this.lastTime = Number.NEGATIVE_INFINITY;
  }

  /**
   * Writes the beat fields of `frame` for the file position `time` (seconds), which plays at
   * `rate` times its speed. Returns false (and changes nothing) without a grid.
   */
  apply(frame: Float32Array, time: number, rate: number): boolean {
    const grid = this.current;
    if (!grid || grid.beats.length < 2) return false;
    const beats = grid.beats;
    const last = beats.length - 1;
    const index = Math.min(last - 1, Math.max(0, beatBefore(grid, time)));
    const beat = beats[index]!;
    const next = beats[index + 1]!;
    const period = next - beat;
    const confidence = grid.confidence[index]!;
    const step = time - this.lastTime;
    // A beat between the last frame and this one is a hit.
    const crossed =
      step > 0 &&
      step < MAX_STEP_SECONDS &&
      beat > this.lastTime &&
      beat <= time &&
      time >= beats[0]!;
    this.lastTime = time;
    const since = Math.max(0, time - beat) / Math.max(1e-3, rate);
    frame[F.beatHit] = crossed && confidence >= MIN_CONFIDENCE ? 1 : 0;
    frame[F.beat] = time >= beats[0]! ? Math.exp(-since / BEAT_DECAY) * confidence : 0;
    frame[F.beatPhase] = Math.min(0.999, Math.max(0, (time - beat) / period));
    frame[F.bpm] = (60 / period) * rate;
    frame[F.beatConfidence] = confidence;
    return true;
  }
}

const tempos = new WeakMap<BeatGrid, number>();

/**
 * The tempo of a track, in BPM (0 without beats): the median over its grid of the mean beat
 * interval across sixteen beats. The span evens out beats that land a frame early or late (at
 * fast tempos, beats between the onsets alternate by a frame); the median follows the tempo most
 * of the track has.
 */
export function gridTempo(grid: BeatGrid): number {
  let tempo = tempos.get(grid);
  if (tempo === undefined) {
    tempo = medianTempo(grid);
    tempos.set(grid, tempo);
  }
  return tempo;
}

/** Beats across which the tempo is averaged. */
const TEMPO_SPAN = 16;

function medianTempo(grid: BeatGrid): number {
  const beats = grid.beats;
  if (beats.length < 3) return 0;
  const span = Math.min(TEMPO_SPAN, beats.length - 1);
  const intervals: number[] = [];
  for (let i = span; i < beats.length; i++) {
    const sure =
      grid.confidence[i]! >= MIN_CONFIDENCE && grid.confidence[i - span]! >= MIN_CONFIDENCE;
    if (sure) intervals.push((beats[i]! - beats[i - span]!) / span);
  }
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a - b);
  return 60 / intervals[intervals.length >> 1]!;
}

/** A stretch of a beat grid at one tempo. */
export interface TempoSection {
  /** Its first and last beat, in seconds (the next section starts on the last). */
  start: number;
  end: number;
  /** Its tempo in BPM (from the mean beat interval). */
  bpm: number;
}

/** Tempos within this factor of each other are one section. */
const SECTION_TOLERANCE = 1.04;
/** A section needs this many beats; a shorter one (a fill, a stumble in a break) joins its neighbours. */
const MIN_SECTION_BEATS = 32;

const sectionCache = new WeakMap<BeatGrid, readonly TempoSection[]>();

/**
 * The sections of steady tempo in a grid, in order (Korrektur 5): a single track has one, a mix
 * one per tempo it passes through. The tempo at each beat is the mean interval across
 * {@link TEMPO_SPAN} beats; beats without a clear rhythm keep the tempo of the section they are in.
 */
export function tempoSections(grid: BeatGrid): readonly TempoSection[] {
  let sections = sectionCache.get(grid);
  if (!sections) {
    sections = findSections(grid);
    sectionCache.set(grid, sections);
  }
  return sections;
}

function findSections(grid: BeatGrid): TempoSection[] {
  const beats = grid.beats;
  const count = beats.length;
  if (count < 2) return [];
  const sure = (k: number) => grid.confidence[k]! >= MIN_CONFIDENCE;
  const span = Math.min(TEMPO_SPAN, count - 1);
  const half = span >> 1;
  // The local tempo at each beat, or NaN where the beats around it are not sure.
  const local = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const from = Math.max(0, Math.min(count - 1 - span, k - half));
    const to = from + span;
    local[k] = sure(from) && sure(to) ? (60 * span) / (beats[to]! - beats[from]!) : Number.NaN;
  }
  // Runs of beats at one tempo: a run ends where a sure beat's tempo leaves the run's tempo.
  let runs: Run[] = [];
  let first = 0;
  let tempo = Number.NaN;
  for (let k = 0; k < count; k++) {
    const value = local[k]!;
    if (Number.isNaN(value)) continue;
    if (Number.isNaN(tempo)) {
      tempo = value;
    } else if (Math.abs(Math.log(value / tempo)) > Math.log(SECTION_TOLERANCE)) {
      runs.push({ first, last: k - 1 });
      first = k;
      tempo = value;
    }
  }
  runs.push({ first, last: count - 1 });
  // The tempo of a run: from its sure beat intervals (all of them where none is sure).
  const bpmOf = (run: Run) => {
    let time = 0;
    let intervals = 0;
    for (let k = run.first; k < run.last; k++) {
      if (!sure(k) || !sure(k + 1)) continue;
      time += beats[k + 1]! - beats[k]!;
      intervals++;
    }
    if (intervals === 0 && run.last > run.first) {
      time = beats[run.last]! - beats[run.first]!;
      intervals = run.last - run.first;
    }
    return time > 0 ? (60 * intervals) / time : 0;
  };
  const apart = (a: Run, b: Run) => Math.abs(Math.log(bpmOf(a) / Math.max(1e-9, bpmOf(b))));
  // Short runs join the neighbour with the closer tempo; then neighbours at one tempo merge.
  for (;;) {
    let shortest = -1;
    for (let r = 0; r < runs.length && runs.length > 1; r++) {
      const length = runs[r]!.last - runs[r]!.first + 1;
      const best = shortest < 0 ? Infinity : runs[shortest]!.last - runs[shortest]!.first + 1;
      if (length < MIN_SECTION_BEATS && length < best) shortest = r;
    }
    if (shortest < 0) break;
    const run = runs[shortest]!;
    const before = runs[shortest - 1];
    const after = runs[shortest + 1];
    if (before && (!after || apart(before, run) <= apart(after, run))) before.last = run.last;
    else after!.first = run.first;
    runs.splice(shortest, 1);
  }
  runs = runs.reduce<Run[]>((merged, run) => {
    const previous = merged[merged.length - 1];
    if (previous && apart(previous, run) <= Math.log(SECTION_TOLERANCE)) previous.last = run.last;
    else merged.push({ ...run });
    return merged;
  }, []);
  // Each boundary moves to the beat where the intervals change from the one tempo to the other
  // (the local tempo, across several beats, changes before that); both sections share it.
  for (let r = 1; r < runs.length; r++) {
    const a = runs[r - 1]!;
    const b = runs[r]!;
    const periodA = 60 / bpmOf(a);
    const periodB = 60 / bpmOf(b);
    const from = Math.max(a.first + 1, b.first - span);
    const to = Math.min(b.last, b.first + span);
    let best = b.first;
    let bestCost = Infinity;
    for (let split = from; split <= to; split++) {
      let cost = 0;
      for (let k = from - 1; k < to; k++) {
        const interval = beats[k + 1]! - beats[k]!;
        cost += (interval - (k < split ? periodA : periodB)) ** 2;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = split;
      }
    }
    a.last = best;
    b.first = best;
  }
  return runs.map((run) => ({ start: beats[run.first]!, end: beats[run.last]!, bpm: bpmOf(run) }));
}

interface Run {
  first: number;
  last: number;
}
