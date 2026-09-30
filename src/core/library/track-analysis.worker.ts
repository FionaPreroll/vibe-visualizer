import { Analyzer } from '../analysis/analyzer';
import { computeBeatGrid, type OnsetFeatures } from '../analysis/beat-grid';
import { GridFeatureCollector } from '../analysis/grid-features';
import { WAVEFORM_STRIDE, WaveformBuilder, type Waveform } from '../analysis/waveform';
import { decodeAtRate, openInput } from '../audio/decode-stream';
import { exposeWorker, withTransfer } from '../util/worker-rpc';
import {
  readCachedAnalysis,
  sameGrid,
  writeCachedAnalysis,
  type GridRequest,
  type TrackAnalysisResult,
} from './analysis-cache';

/**
 * Analyses whole tracks in the background (TR-03, AN-07, NF-06): decodes the file at its own
 * rate, builds the waveform and collects the onset strength of every analysis frame, then
 * computes the beat grid. The waveform is reported as it grows, so long mixes show it
 * progressively. Results are cached per fingerprint. The onset features of recent tracks stay in
 * memory, so a tempo the user corrects (TMP-06) or another tempo range (AN-12) gives a new grid
 * without decoding again.
 */

export interface AnalysisProgress {
  /** Seconds analysed so far. */
  seconds: number;
  /** New waveform buckets from bucket `from` on. */
  from: number;
  data: Uint8Array;
}

export const ANALYSIS_CANCELLED = 'The analysis was cancelled.';
const REPORT_INTERVAL_MS = 500;

const cancelled = new Set<string>();

/** What a new grid for a track needs: its onset features, and the rest of its result. */
interface Kept {
  features: OnsetFeatures;
  duration: number;
  waveform: Waveform;
  bytes: number;
}

/** Recently analysed tracks, oldest first, up to {@link KEPT_BYTES} (about six hours). */
const kept = new Map<string, Kept>();
const KEPT_BYTES = 64 * 1024 * 1024;

function keep(fingerprint: string, entry: Kept): void {
  kept.delete(fingerprint);
  kept.set(fingerprint, entry);
  let total = 0;
  for (const { bytes } of kept.values()) total += bytes;
  for (const [key, { bytes }] of kept) {
    if (total <= KEPT_BYTES || key === fingerprint) break;
    kept.delete(key);
    total -= bytes;
  }
}

/** A copy of the features, as compact as their length (the collector's lists have room). */
function compact(features: OnsetFeatures): OnsetFeatures {
  return {
    ...features,
    onset: features.onset.slice(),
    accent: features.accent.slice(),
    active: features.active.slice(),
    kick: features.kick?.slice(),
    snare: features.snare?.slice(),
    levels: features.levels?.slice(),
  };
}

function byteSize(features: OnsetFeatures, waveform: Waveform): number {
  const lists = [
    features.onset,
    features.accent,
    features.active,
    features.kick,
    features.snare,
    features.levels,
  ];
  return lists.reduce((sum, list) => sum + (list?.byteLength ?? 0), waveform.data.byteLength);
}

/**
 * The waveform and beat grid of a file, with the tempo the user gave (TMP-06) or in the tempo
 * range (AN-12): from the cache, from the features kept in memory, or by decoding the file.
 */
async function analyse(
  args: { file: File; fingerprint: string } & GridRequest,
  progress: (update: AnalysisProgress) => void,
) {
  cancelled.delete(args.fingerprint);
  const cached = await readCachedAnalysis(args.fingerprint);
  if (cached && sameGrid(cached, args)) return transferable(cached);
  const options = { bpm: args.tempo, range: args.range };
  const known = kept.get(args.fingerprint);
  if (known) {
    keep(args.fingerprint, known);
    const result: TrackAnalysisResult = {
      fingerprint: args.fingerprint,
      duration: known.duration,
      waveform: { ...known.waveform, data: known.waveform.data.slice() },
      grid: computeBeatGrid(known.features, options),
      tempo: args.tempo,
      range: args.range,
    };
    await writeCachedAnalysis(result);
    return transferable(result);
  }
  const input = openInput(args.file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('The file contains no audio track.');
    const rate = track.sampleRate;
    const expected = (await input.getDurationFromMetadata()) ?? 60;
    const analyzer = new Analyzer(rate);
    const waveform = new WaveformBuilder(rate, expected);
    const features = new GridFeatureCollector(analyzer, (expected * rate) / analyzer.hop + 16);
    const onFrame = () => features.push();
    let samples = 0;
    let sent = 0;
    let reported = performance.now();
    for await (const planes of decodeAtRate(track, null, 0)) {
      if (cancelled.has(args.fingerprint)) throw new Error(ANALYSIS_CANCELLED);
      const left = planes[0]!;
      const right = planes[1] ?? left;
      waveform.add(left, right, left.length);
      analyzer.process(left, right, left.length, onFrame);
      samples += left.length;
      if (performance.now() - reported > REPORT_INTERVAL_MS) {
        reported = performance.now();
        const current = waveform.waveform;
        progress({
          seconds: samples / rate,
          from: sent,
          data: current.data.slice(sent * WAVEFORM_STRIDE),
        });
        sent = current.length;
      }
    }
    const finished = waveform.finish();
    const onsets = compact(features.finish());
    const shape = { rate: finished.rate, length: finished.length };
    const whole = { ...shape, data: finished.data.slice(0, finished.length * WAVEFORM_STRIDE) };
    const duration = samples / rate;
    keep(args.fingerprint, {
      features: onsets,
      duration,
      waveform: whole,
      bytes: byteSize(onsets, whole),
    });
    const result: TrackAnalysisResult = {
      fingerprint: args.fingerprint,
      duration,
      waveform: { ...shape, data: whole.data.slice() },
      grid: computeBeatGrid(onsets, options),
      tempo: args.tempo,
      range: args.range,
    };
    await writeCachedAnalysis(result);
    return transferable(result);
  } finally {
    cancelled.delete(args.fingerprint);
    input.dispose();
  }
}

function transferable(result: TrackAnalysisResult) {
  const buffers = [
    result.waveform.data.buffer,
    result.grid.beats.buffer,
    result.grid.confidence.buffer,
  ];
  if (result.grid.beatInBar) buffers.push(result.grid.beatInBar.buffer);
  return withTransfer(result, buffers);
}

/** Stops the analysis of `fingerprint` at its next decoded block. */
function cancel(args: { fingerprint: string }): void {
  cancelled.add(args.fingerprint);
}

exposeWorker({ analyse, cancel });
