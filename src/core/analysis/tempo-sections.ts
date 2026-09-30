import type { BeatGrid } from './beat-grid';

/**
 * The sections of steady tempo in a beat grid (AN-07): where a mix changes tempo, and whether a
 * track has one tempo (the straight grid needs it; the timeline and the queue show the changes,
 * Korrektur 5).
 */

/** A stretch of a beat grid at one tempo. */
export interface TempoSection {
  /** Its first and last beat, in seconds (the next section starts on the last). */
  start: number;
  end: number;
  /** Its tempo in BPM (from the mean beat interval). */
  bpm: number;
}

/** Beats at least this sure count for the tempo (as for the grid's tempo). */
const MIN_CONFIDENCE = 0.1;
/** Beats across which the tempo at a beat is averaged (as for the grid's tempo). */
const TEMPO_SPAN = 16;
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

/**
 * The different tempos of a grid's sections, the one most of the track has first (Korrektur 5):
 * sections within {@link SECTION_TOLERANCE} of each other count as one tempo.
 */
export function sectionTempos(grid: BeatGrid): number[] {
  const groups: { bpm: number; length: number }[] = [];
  for (const section of tempoSections(grid)) {
    const length = Math.max(1e-6, section.end - section.start);
    const group = groups.find(
      (other) => Math.abs(Math.log(other.bpm / section.bpm)) <= Math.log(SECTION_TOLERANCE),
    );
    if (group) {
      group.bpm = (group.bpm * group.length + section.bpm * length) / (group.length + length);
      group.length += length;
    } else {
      groups.push({ bpm: section.bpm, length });
    }
  }
  return groups.sort((a, b) => b.length - a.length).map((group) => group.bpm);
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
