import { Analyzer, DRUM_DECAY_SECONDS, type AnalyzerOptions } from '../analyzer';
import { F } from '../features';
import type { OnsetScore } from './score';

/** Event times in seconds, as reported by the analyzer. */
export interface DetectedHits {
  /** Estimated onset times of the drum hits. */
  kicks: number[];
  snares: number[];
  hats: number[];
  /** Beat times (the end of the frame that reported the beat). */
  beats: number[];
  /** Tempo estimate at the end of the input. */
  bpm: number;
}

/** Runs a fresh analyzer over stereo input in blocks of `block` samples and collects hits. */
export function detectHits(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  options?: AnalyzerOptions,
  block = 128,
): DetectedHits {
  const analyzer = new Analyzer(sampleRate, options);
  const hits: DetectedHits = { kicks: [], snares: [], hats: [], beats: [], bpm: 0 };
  const lists = [hits.kicks, hits.snares, hits.hats];
  for (let start = 0; start < left.length; start += block) {
    const count = Math.min(block, left.length - start);
    analyzer.process(left.subarray(start), right.subarray(start), count, (offset) => {
      const time = (start + offset) / sampleRate;
      const frame = analyzer.frame;
      for (let d = 0; d < 3; d++) {
        if (frame[F.kickHit + d] !== 1) continue;
        // The envelope tells how long ago the onset was.
        const age = -Math.log(Math.max(1e-9, frame[F.kick + d]!)) * DRUM_DECAY_SECONDS[d]!;
        lists[d]!.push(time - age);
      }
      if (frame[F.beatHit] === 1) hits.beats.push(time);
      hits.bpm = frame[F.bpm]!;
    });
  }
  return hits;
}

export function formatScore(name: string, score: OnsetScore): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(6);
  return (
    `${name.padEnd(6)} P ${percent(score.precision)}  R ${percent(score.recall)}  ` +
    `F1 ${percent(score.f1)}  TP ${String(score.truePositives).padStart(3)}  ` +
    `FP ${String(score.falsePositives).padStart(3)}  FN ${String(score.falseNegatives).padStart(3)}  ` +
    `offset ${(score.meanOffset * 1000).toFixed(1).padStart(5)} ms`
  );
}
