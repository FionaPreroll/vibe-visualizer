import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { detectHits, formatScore } from '../../src/core/analysis/eval/evaluate';
import { scoreOnsets, within, type OnsetScore } from '../../src/core/analysis/eval/score';
import { Resampler } from '../../src/core/audio/resampler';
import { readWav } from './wav-reader';

/**
 * Drum detection on real music: the MDB Drums dataset (23 MedleyDB tracks with drum annotations,
 * CC BY-NC-SA 4.0, https://github.com/CarlSouthall/MDBDrums). Not part of the repository; set
 * MDB_DRUMS_DIR to the dataset's "MDB Drums" folder to run it: `pnpm eval:drums`. With
 * EVAL_CACHE_DIR set, the audio converted to the engine rate is cached there between runs.
 */

const root = process.env['MDB_DRUMS_DIR'];
const cacheDir = process.env['EVAL_CACHE_DIR'];
const EVAL_OPTIONS = process.env['EVAL_OPTIONS']
  ? JSON.parse(process.env['EVAL_OPTIONS'])
  : undefined;
const ENGINE_RATE = 48000;

interface Annotations {
  kicks: number[];
  snares: number[];
  hats: number[];
  /** Snare hits without ghost notes and brushes (from the subclass annotations). */
  mainSnares: number[];
  cymbals: number[];
}

function readBeats(path: string): number[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((time) => Number.isFinite(time) && time > 0);
}

function readAnnotations(classPath: string, subclassPath: string): Annotations {
  const result: Annotations = { kicks: [], snares: [], hats: [], mainSnares: [], cymbals: [] };
  const lines = (path: string) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter(([time, label]) => time && label) as [string, string][];
  for (const [time, label] of lines(classPath)) {
    const list = { KD: result.kicks, SD: result.snares, HH: result.hats, CY: result.cymbals }[
      label
    ];
    list?.push(Number(time));
  }
  for (const [time, label] of lines(subclassPath)) {
    if (['SD', 'SDF', 'SDD', 'SDNS'].includes(label)) result.mainSnares.push(Number(time));
  }
  result.cymbals.push(...result.hats);
  result.cymbals.sort((a, b) => a - b);
  return result;
}

/**
 * Scoring closer to what the visuals need: recall counts only `recallTruth` (e.g. snares without
 * ghost notes), precision accepts any of `precisionTruth` (e.g. cymbals for the hi-hat).
 */
interface VisualTally {
  detected: number;
  falsePositives: number;
  found: number;
  total: number;
}

function visualTally(detected: number[], recallTruth: number[], precisionTruth: number[]) {
  const recall = scoreOnsets(detected, recallTruth);
  const precision = scoreOnsets(detected, precisionTruth);
  return {
    detected: detected.length,
    falsePositives: precision.falsePositives,
    found: recall.truePositives,
    total: recallTruth.length,
  };
}

function formatVisual(name: string, tallies: VisualTally[]): string {
  const add = (key: keyof VisualTally) => tallies.reduce((sum, tally) => sum + tally[key], 0);
  const precision = 1 - add('falsePositives') / Math.max(1, add('detected'));
  const recall = add('found') / Math.max(1, add('total'));
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(6);
  return `${name.padEnd(6)} P ${percent(precision)}  R ${percent(recall)}  F1 ${percent(f1)}`;
}

/** Converts to the engine rate with the app's own resampler, as the media worker does. */
function toEngineRate(channels: Float32Array[], sampleRate: number): Float32Array[] {
  if (sampleRate === ENGINE_RATE) return channels;
  const resampler = new Resampler(2, sampleRate, ENGINE_RATE);
  const stereo = [channels[0]!, channels[1] ?? channels[0]!];
  const parts = [resampler.push(stereo, stereo[0]!.length), resampler.flush()];
  return [0, 1].map((c) => {
    const out = new Float32Array(parts.reduce((sum, part) => sum + part[c]!.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part[c]!, at);
      at += part[c]!.length;
    }
    return out;
  });
}

/** Loads a track at the engine rate, from the cache if possible. */
function loadTrack(path: string, name: string): Float32Array[] {
  const cached = cacheDir ? join(cacheDir, `${name}.f32`) : null;
  if (cached && existsSync(cached)) {
    const bytes = readFileSync(cached);
    const all = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const frames = all.length / 2;
    return [all.slice(0, frames), all.slice(frames)];
  }
  const wav = readWav(readFileSync(path));
  const planes = toEngineRate(wav.channels, wav.sampleRate);
  if (cached) {
    mkdirSync(cacheDir!, { recursive: true });
    const all = new Float32Array(planes[0]!.length * 2);
    all.set(planes[0]!, 0);
    all.set(planes[1]!, planes[0]!.length);
    writeFileSync(cached, new Uint8Array(all.buffer));
  }
  return planes;
}

function sum(scores: OnsetScore[]): OnsetScore {
  const tp = scores.reduce((s, x) => s + x.truePositives, 0);
  const fp = scores.reduce((s, x) => s + x.falsePositives, 0);
  const fn = scores.reduce((s, x) => s + x.falseNegatives, 0);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const meanOffset =
    tp > 0 ? scores.reduce((s, x) => s + x.meanOffset * x.truePositives, 0) / tp : 0;
  return {
    precision,
    recall,
    f1,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    meanOffset,
  };
}

describe.skipIf(!root || !existsSync(root))('drum detection on MDB Drums', () => {
  it('scores kick, snare and hi-hat per track and overall', { timeout: 600_000 }, () => {
    const mixDir = join(root!, 'audio', 'full_mix');
    const tracks = readdirSync(mixDir)
      .filter((name) => name.endsWith('_MIX.wav'))
      .map((name) => name.replace('_MIX.wav', ''))
      .filter((name) => !process.env['MDB_TRACK'] || name.includes(process.env['MDB_TRACK']));
    const totals = {
      kick: [] as OnsetScore[],
      snare: [] as OnsetScore[],
      hat: [] as OnsetScore[],
      beat: [] as OnsetScore[],
      mainSnare: [] as VisualTally[],
      hatOrCymbal: [] as VisualTally[],
    };
    let tempoCorrect = 0;
    const lines: string[] = [];
    for (const track of tracks) {
      const [left, right] = loadTrack(join(mixDir, `${track}_MIX.wav`), track);
      const truth = readAnnotations(
        join(root!, 'annotations', 'class', `${track}_class.txt`),
        join(root!, 'annotations', 'subclass', `${track}_subclass.txt`),
      );
      const hits = detectHits(left!, right!, ENGINE_RATE, EVAL_OPTIONS);
      const kick = scoreOnsets(hits.kicks, truth.kicks);
      const snare = scoreOnsets(hits.snares, truth.snares);
      const hat = scoreOnsets(hits.hats, truth.hats);
      totals.kick.push(kick);
      totals.snare.push(snare);
      totals.hat.push(hat);
      totals.mainSnare.push(visualTally(hits.snares, truth.mainSnares, truth.snares));
      totals.hatOrCymbal.push(visualTally(hits.hats, truth.hats, truth.cymbals));
      // Beats after a 5 s warm-up, ±70 ms (MIREX beat F-measure).
      const beatTruth = readBeats(join(root!, 'annotations', 'beats', `${track}_MIX.beats`));
      const beat = scoreOnsets(within(hits.beats, 5, 1e9), within(beatTruth, 5, 1e9), 0.07);
      totals.beat.push(beat);
      const periods = beatTruth
        .slice(1)
        .map((time, i) => time - beatTruth[i]!)
        .sort((a, b) => a - b);
      const truthBpm = periods.length > 0 ? 60 / periods[Math.floor(periods.length / 2)]! : 0;
      const tempoOk = Math.abs(hits.bpm / truthBpm - 1) < 0.04;
      if (tempoOk) tempoCorrect++;
      const f1 = (score: OnsetScore, count: number) =>
        count === 0 ? '   -  ' : `${(score.f1 * 100).toFixed(0).padStart(4)}% `;
      lines.push(
        `${track.replace('MusicDelta_', '').padEnd(14)} kick ${f1(kick, truth.kicks.length)}` +
          `snare ${f1(snare, truth.snares.length)}hat ${f1(hat, truth.hats.length)}` +
          `beat ${f1(beat, beatTruth.length)} bpm ${hits.bpm.toFixed(0).padStart(3)} ` +
          `(${truthBpm.toFixed(0).padStart(3)})${tempoOk ? '' : ' ✗'}`,
      );
    }
    console.log(
      [
        ...lines,
        '',
        formatScore('kick', sum(totals.kick)),
        formatScore('snare', sum(totals.snare)),
        formatScore('hat', sum(totals.hat)),
        formatScore('beat', sum(totals.beat)),
        'Visual relevance: snare recall without ghost notes and brushes; hi-hat precision with cymbals',
        formatVisual('snare', totals.mainSnare),
        formatVisual('hat', totals.hatOrCymbal),
        `tempo within 4 %: ${tempoCorrect} of ${tracks.length} tracks`,
      ].join('\n'),
    );
  });
});
