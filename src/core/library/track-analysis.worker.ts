import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { Analyzer, FLUX_DELAY } from '../analysis/analyzer';
import { computeBeatGrid } from '../analysis/beat-grid';
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

/** A growable Float32Array/Uint8Array pair of lists, for the per-frame onset features. */
class FrameLists {
  onset: Float32Array;
  accent: Float32Array;
  active: Uint8Array;
  length = 0;

  constructor(capacity: number) {
    this.onset = new Float32Array(capacity);
    this.accent = new Float32Array(capacity);
    this.active = new Uint8Array(capacity);
  }

  push(onset: number, accent: number, active: boolean): void {
    if (this.length === this.onset.length) {
      const grow = <T extends Float32Array | Uint8Array>(old: T, next: T) => {
        next.set(old);
        return next;
      };
      const capacity = this.onset.length * 2;
      this.onset = grow(this.onset, new Float32Array(capacity));
      this.accent = grow(this.accent, new Float32Array(capacity));
      this.active = grow(this.active, new Uint8Array(capacity));
    }
    this.onset[this.length] = onset;
    this.accent[this.length] = accent;
    this.active[this.length] = active ? 1 : 0;
    this.length++;
  }
}

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
    const frames = new FrameLists(Math.ceil((expected * rate) / analyzer.hop) + 16);
    const onFrame = () => frames.push(analyzer.flux, analyzer.accent, analyzer.active);
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
    const grid = computeBeatGrid({
      frameRate: rate / analyzer.hop,
      onset: frames.onset.subarray(0, frames.length),
      accent: frames.accent.subarray(0, frames.length),
      active: frames.active.subarray(0, frames.length),
      delay: FLUX_DELAY,
    });
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
  return withTransfer(result, [
    result.waveform.data.buffer,
    result.grid.beats.buffer,
    result.grid.confidence.buffer,
  ]);
}

/** Stops the analysis of `fingerprint` at its next decoded block. */
function cancel(args: { fingerprint: string }): void {
  cancelled.add(args.fingerprint);
}

exposeWorker({ analyse, cancel });
