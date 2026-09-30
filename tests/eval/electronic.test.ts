import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  computeBeatGrid,
  TEMPO_RANGE_IDS,
  TEMPO_RANGES,
  type BeatGrid,
  type TempoRangeId,
} from '../../src/core/analysis/beat-grid';
import { detectHits } from '../../src/core/analysis/eval/evaluate';
import { gridTempo } from '../../src/core/analysis/grid-beats';
import { tempoSections } from '../../src/core/analysis/tempo-sections';
import { readWav } from './wav-reader';

/**
 * The beat grid of a file (AN-07) on electronic music, whose tempo is fixed and whose fast genres
 * read at a related tempo: per track, for the automatic tempo range and for each range the user
 * can choose that holds its tempo (AN-12), the tempo found, the share of the track at the true
 * tempo, and whether the grid is straight. The tracks are not part of the repository; set EDM_DIR
 * to a folder of WAV files with a `tracks.json` that gives the tempo of each, as
 * `{ "Artist - Title.wav": { "bpm": 174 } }`, and run `pnpm eval:drums`. The files are analysed
 * at their own rate, as the app's analysis does.
 */

const root = process.env['EDM_DIR'];
const tracksFile = root ? join(root, 'tracks.json') : '';

interface TrackInfo {
  bpm: number;
}

/** Tempos within 4 % count as right (as on MDB Drums). */
const TOLERANCE = 0.04;
/** The related tempos a grid can read instead of the true one, as a factor and label. */
const RELATED = [
  [1 / 2, '÷2'],
  [2 / 3, '÷1.5'],
  [3 / 4, '×3/4'],
  [4 / 3, '×4/3'],
  [3 / 2, '×1.5'],
  [2, '×2'],
] as const;

function right(bpm: number, truth: number): boolean {
  return Math.abs(bpm / truth - 1) < TOLERANCE;
}

/** How the tempo found relates to the true one: '', a related factor, or '?'. */
function relation(bpm: number, truth: number): string {
  if (right(bpm, truth)) return '';
  const related = RELATED.find(([factor]) => right(bpm, truth * factor));
  return related ? related[1] : '?';
}

/** Share of the grid's time at the true tempo. */
function shareAt(grid: BeatGrid, truth: number): number {
  let at = 0;
  let total = 0;
  for (const section of tempoSections(grid)) {
    const length = section.end - section.start;
    total += length;
    if (right(section.bpm, truth)) at += length;
  }
  return total > 0 ? at / total : 0;
}

/** Whether the beats are evenly spaced (a straight grid). */
function straight(grid: BeatGrid): boolean {
  const beats = grid.beats;
  if (beats.length < 3) return false;
  const period = (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1);
  return beats.every((time, k) => Math.abs(time - beats[0]! - k * period) < 1e-6);
}

describe.skipIf(!root || !existsSync(tracksFile))('beat grid on electronic music', () => {
  it('finds the tempo of each track in each range', { timeout: 600_000 }, () => {
    const tracks = JSON.parse(readFileSync(tracksFile, 'utf8')) as Record<string, TrackInfo>;
    const tally = new Map<TempoRangeId, { right: number; straight: number; count: number }>();
    const lines: string[] = [];
    for (const [file, info] of Object.entries(tracks)) {
      const wav = readWav(readFileSync(join(root!, file)));
      const left = wav.channels[0]!;
      const hits = detectHits(left, wav.channels[1] ?? left, wav.sampleRate, undefined, 4096);
      const ranges = TEMPO_RANGE_IDS.filter((id) => {
        const range = TEMPO_RANGES[id];
        return id === 'auto' || (info.bpm >= range.min && info.bpm <= range.max);
      });
      const cells = ranges.map((range) => {
        const grid = computeBeatGrid(hits.onsets, { range });
        const bpm = gridTempo(grid);
        const entry = tally.get(range) ?? { right: 0, straight: 0, count: 0 };
        entry.count++;
        if (right(bpm, info.bpm)) entry.right++;
        if (straight(grid)) entry.straight++;
        tally.set(range, entry);
        const sections = tempoSections(grid).length;
        return (
          `${range} ${bpm.toFixed(1).padStart(5)}${relation(bpm, info.bpm).padEnd(5)} ` +
          `${(shareAt(grid, info.bpm) * 100).toFixed(0).padStart(3)}% ` +
          `${straight(grid) ? 'straight' : `${sections} section${sections === 1 ? '' : 's'}`}`
        );
      });
      lines.push(
        `${file.replace(/\.wav$/i, '').padEnd(30)} ${String(info.bpm).padStart(5)} | ${cells.join(' | ')}`,
      );
    }
    const summary = TEMPO_RANGE_IDS.filter((id) => tally.has(id)).map((id) => {
      const entry = tally.get(id)!;
      return `${id}: tempo right for ${entry.right} of ${entry.count}, straight ${entry.straight}`;
    });
    console.log(
      [
        'track (true BPM) | per range: tempo found (relation), share at the true tempo, grid',
        ...lines,
        '',
        ...summary,
      ].join('\n'),
    );
  });
});
