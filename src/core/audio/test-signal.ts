/**
 * Deterministic, music-like test signal (120 BPM: kick, snare, hi-hats, chord pad).
 * Every sample is a pure function of its absolute frame index, so the signal can be rendered in
 * arbitrary chunks — e.g. three hours in pieces — and always comes out identical.
 */
export interface TestSignalOptions {
  /** Adds a 1 kHz beep during the first 50 ms of every second (A/V sync checks). */
  beepEverySecond?: boolean;
}

const TWO_PI = 2 * Math.PI;

function hashNoise(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

export function renderTestSignal(
  output: readonly Float32Array[],
  startFrame: number,
  frames: number,
  sampleRate: number,
  options: TestSignalOptions = {},
): void {
  const beat = (sampleRate * 60) / 120;
  const left = output[0]!;
  const right = output[1] ?? output[0]!;
  for (let i = 0; i < frames; i++) {
    const n = startFrame + i;
    const t = n / sampleRate;

    const sinceBeat = (n % beat) / sampleRate;
    const kickPhase = TWO_PI * (50 * sinceBeat + (100 / 30) * (1 - Math.exp(-30 * sinceBeat)));
    const kick = 0.8 * Math.sin(kickPhase) * Math.exp(-18 * sinceBeat);

    const beatIndex = Math.floor(n / beat);
    // Snare: tonal body around 190 Hz plus noise, on beats 2 and 4.
    const snare =
      beatIndex % 2 === 1
        ? 0.35 *
          (0.6 * hashNoise(n) + 0.5 * Math.sin(TWO_PI * 190 * sinceBeat)) *
          Math.exp(-25 * sinceBeat)
        : 0;

    // Hi-hat: high-passed noise (first difference) on every 8th note.
    const sinceEighth = (n % (beat / 2)) / sampleRate;
    const hat = 0.1 * (hashNoise(n + 7919) - hashNoise(n + 7918)) * Math.exp(-80 * sinceEighth);

    const tremolo = 0.6 + 0.4 * Math.sin(TWO_PI * 0.25 * t);
    const pad =
      0.07 *
      tremolo *
      (Math.sin(TWO_PI * 220 * t) + Math.sin(TWO_PI * 261.63 * t) + Math.sin(TWO_PI * 329.63 * t));

    let beep = 0;
    if (options.beepEverySecond && t % 1 < 0.05) beep = 0.3 * Math.sin(TWO_PI * 1000 * t);

    left[i] = kick + snare + hat * 0.8 + pad + beep;
    if (right !== left) right[i] = kick + snare + hat + pad * 0.9 + beep;
  }
}

/** Convenience: renders `seconds` of the test signal into new stereo planes. */
export function createTestSignal(
  seconds: number,
  sampleRate: number,
  options?: TestSignalOptions,
): Float32Array[] {
  const frames = Math.round(seconds * sampleRate);
  const planes = [new Float32Array(frames), new Float32Array(frames)];
  renderTestSignal(planes, 0, frames, sampleRate, options);
  return planes;
}
