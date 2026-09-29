/**
 * DJ filter (FX-06): one knob from low-pass (−1) through neutral (0) to high-pass (+1), with
 * resonance. A state-variable filter in the topology-preserving form (Zavalishin, Simper): it
 * stays stable and click-free while the cutoff moves. Around the centre the filter fades out,
 * so turning the knob through neutral switches between low- and high-pass without a click.
 */

/** Cutoff at the far ends of the knob (Hz). */
const LOW_PASS_END = 150;
const HIGH_PASS_END = 6000;
const OPEN_LOW_PASS = 20000;
const OPEN_HIGH_PASS = 20;
/** Knob distance from the centre over which the filter fades in. */
const FADE_ZONE = 0.05;
/** Knob distance over which the resonance comes in (no resonant peak at the open ends). */
const RESONANCE_ZONE = 0.2;
const MAX_EXTRA_Q = 3.3;
/** Time constant of the knob smoothing (seconds). */
const SMOOTHING = 0.02;

/** Cutoff frequency (Hz) of the filter at knob position `amount` (−1…1, not 0). */
export function djFilterCutoff(amount: number): number {
  const distance = Math.abs(amount);
  return amount < 0
    ? OPEN_LOW_PASS * (LOW_PASS_END / OPEN_LOW_PASS) ** distance
    : OPEN_HIGH_PASS * (HIGH_PASS_END / OPEN_HIGH_PASS) ** distance;
}

export class DjFilter {
  /** −1 low-pass … 0 off … +1 high-pass. */
  amount = 0;
  /** 0…1 */
  resonance = 0.3;

  private readonly smoothing: number;
  private current = 0;
  private currentResonance = 0.3;
  private readonly state = new Float64Array(4); // ic1, ic2 per channel

  constructor(private readonly sampleRate: number) {
    this.smoothing = 1 - Math.exp(-1 / (SMOOTHING * sampleRate));
  }

  /** Jumps to the current knob positions without gliding (the start of an export). */
  snap(): void {
    this.current = this.amount;
    this.currentResonance = this.resonance;
  }

  /** Filters two planes in place. */
  process(planes: readonly Float32Array[], frames: number): void {
    const target = this.amount;
    const targetResonance = this.resonance;
    if (target === 0 && Math.abs(this.current) < 1e-4) {
      // Neutral: nothing to do. The memory starts from silence when the knob moves again.
      this.current = 0;
      this.currentResonance = targetResonance;
      this.state.fill(0);
      return;
    }
    const left = planes[0]!;
    const right = planes[1]!;
    const state = this.state;
    const smoothing = this.smoothing;
    let amount = this.current;
    let resonance = this.currentResonance;
    for (let i = 0; i < frames; i++) {
      amount += (target - amount) * smoothing;
      resonance += (targetResonance - resonance) * smoothing;
      const distance = Math.abs(amount);
      const cutoff = djFilterCutoff(amount);
      const q = Math.SQRT1_2 + resonance * MAX_EXTRA_Q * Math.min(1, distance / RESONANCE_ZONE);
      const g = Math.tan((Math.PI * Math.min(cutoff, 0.45 * this.sampleRate)) / this.sampleRate);
      const k = 1 / q;
      const a1 = 1 / (1 + g * (g + k));
      const a2 = g * a1;
      const a3 = g * a2;
      const wet = Math.min(1, distance / FADE_ZONE);
      const highPass = amount > 0;
      for (let c = 0; c < 2; c++) {
        const plane = c === 0 ? left : right;
        const x = plane[i]!;
        const ic1 = state[c * 2]!;
        const ic2 = state[c * 2 + 1]!;
        const v3 = x - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        state[c * 2] = 2 * v1 - ic1;
        state[c * 2 + 1] = 2 * v2 - ic2;
        const filtered = highPass ? x - k * v1 - v2 : v2;
        plane[i] = x + (filtered - x) * wet;
      }
    }
    this.current = amount;
    this.currentResonance = resonance;
  }
}
