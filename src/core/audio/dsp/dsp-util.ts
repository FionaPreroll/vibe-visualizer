/** Small helpers shared by the effects. */

/** Below this level a signal counts as silence (−100 dB). */
export const SILENCE = 1e-5;

/** Dry gain for a mix knob (0 dry … 1 wet): full level up to the middle. */
export function dryGain(mix: number): number {
  return Math.min(1, 2 * (1 - mix));
}

/** Wet gain for a mix knob: full level from the middle on. */
export function wetGain(mix: number): number {
  return Math.min(1, 2 * mix);
}

/** True if either plane has a sample above {@link SILENCE}. */
export function hasSignal(left: Float32Array, right: Float32Array, frames: number): boolean {
  for (let i = 0; i < frames; i++) {
    if (Math.abs(left[i]!) >= SILENCE || Math.abs(right[i]!) >= SILENCE) return true;
  }
  return false;
}
