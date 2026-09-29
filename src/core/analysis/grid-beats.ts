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

/** The tempo of a track: the median beat interval of its grid, in BPM (0 without beats). */
export function gridTempo(grid: BeatGrid): number {
  let tempo = tempos.get(grid);
  if (tempo === undefined) {
    tempo = medianTempo(grid);
    tempos.set(grid, tempo);
  }
  return tempo;
}

function medianTempo(grid: BeatGrid): number {
  const beats = grid.beats;
  if (beats.length < 3) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    if (grid.confidence[i]! >= MIN_CONFIDENCE) intervals.push(beats[i]! - beats[i - 1]!);
  }
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a - b);
  return 60 / intervals[intervals.length >> 1]!;
}
