import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { Analyzer } from '../analysis/analyzer';
import { computeBeatGrid } from '../analysis/beat-grid';
import { GridFeatureCollector } from '../analysis/grid-features';
import { WAVEFORM_STRIDE, WaveformBuilder } from '../analysis/waveform';
import { decodeAtRate } from '../audio/decode-stream';
import { exposeWorker, withTransfer } from '../util/worker-rpc';
import {
  readCachedAnalysis,
  writeCachedAnalysis,
  type TrackAnalysisResult,
} from './analysis-cache';

/**
 * Analyses whole tracks in the background (TR-03, AN-07, NF-06): decodes the file at its own
 * rate, builds the waveform and collects the onset strength of every analysis frame, then
 * computes the beat grid. The waveform is reported as it grows, so long mixes show it
 * progressively. Results are cached per fingerprint.
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

async function analyse(
  args: { file: File; fingerprint: string },
  progress: (update: AnalysisProgress) => void,
) {
  cancelled.delete(args.fingerprint);
  const cached = await readCachedAnalysis(args.fingerprint);
  if (cached) return transferable(cached);
  const input = new Input({ source: new BlobSource(args.file), formats: ALL_FORMATS });
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
    const grid = computeBeatGrid(features.finish());
    const result: TrackAnalysisResult = {
      fingerprint: args.fingerprint,
      duration: samples / rate,
      waveform: { rate: finished.rate, length: finished.length, data: finished.data.slice() },
      grid,
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
