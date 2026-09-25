/**
 * Evaluation measures for onset and beat detection, as used in MIREX: a detection counts as
 * correct if it lies within a tolerance window of an unmatched ground-truth event.
 */

export interface OnsetScore {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Mean detected − true time of the matches, in seconds. */
  meanOffset: number;
}

/** Matches detections to ground truth within `tolerance` seconds (standard onset evaluation). */
export function scoreOnsets(
  detected: readonly number[],
  truth: readonly number[],
  tolerance = 0.05,
): OnsetScore {
  const used = new Array<boolean>(detected.length).fill(false);
  const offsets: number[] = [];
  for (const time of truth) {
    let best = -1;
    for (let i = 0; i < detected.length; i++) {
      if (used[i]) continue;
      const distance = Math.abs(detected[i]! - time);
      if (distance <= tolerance && (best < 0 || distance < Math.abs(detected[best]! - time))) {
        best = i;
      }
    }
    if (best >= 0) {
      used[best] = true;
      offsets.push(detected[best]! - time);
    }
  }
  const truePositives = offsets.length;
  const falsePositives = detected.length - truePositives;
  const falseNegatives = truth.length - truePositives;
  const precision = detected.length > 0 ? truePositives / detected.length : 0;
  const recall = truth.length > 0 ? truePositives / truth.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const meanOffset = offsets.length > 0 ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;
  return { precision, recall, f1, truePositives, falsePositives, falseNegatives, meanOffset };
}

/** Keeps the times within [from, to). */
export function within(times: readonly number[], from: number, to: number): number[] {
  return times.filter((time) => time >= from && time < to);
}
