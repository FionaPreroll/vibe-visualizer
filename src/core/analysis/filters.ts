/**
 * Butterworth filters as cascades of biquads (RBJ cookbook, transposed direct form II).
 * Allocation-free per sample: safe to run in the AudioWorklet.
 */

/** Q values of the two sections of a 4th-order Butterworth filter. */
const BUTTERWORTH_4 = [0.5411961, 1.306563];

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(type: 'lowpass' | 'highpass', frequency: number, q: number, sampleRate: number) {
    const w = (2 * Math.PI * frequency) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const sign = type === 'lowpass' ? 1 : -1;
    this.b0 = (1 - sign * cos) / 2 / a0;
    this.b1 = (sign * (1 - sign * cos)) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** 4th-order Butterworth high-pass and/or low-pass (24 dB per octave each). */
export class BandFilter {
  private readonly sections: Biquad[] = [];

  constructor(sampleRate: number, highpass?: number, lowpass?: number) {
    for (const q of BUTTERWORTH_4) {
      if (highpass) this.sections.push(new Biquad('highpass', highpass, q, sampleRate));
      if (lowpass) this.sections.push(new Biquad('lowpass', lowpass, q, sampleRate));
    }
  }

  process(x: number): number {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) x = sections[i]!.process(x);
    return x;
  }

  reset(): void {
    for (const section of this.sections) section.reset();
  }
}
