import { describe, expect, it } from 'vitest';
import { summarise, WAVEFORM_RATE, WaveformBuilder } from './waveform';

const RATE = 48000;

function tone(frequency: number, seconds: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE),
  );
}

function build(signal: Float32Array, block = 1000) {
  const builder = new WaveformBuilder(RATE, 1);
  for (let i = 0; i < signal.length; i += block) {
    const part = signal.subarray(i, i + block);
    builder.add(part, part, part.length);
  }
  return builder.finish();
}

describe('waveform', () => {
  it('has a bucket every 5 ms, whatever the block size, and grows past its estimate', () => {
    const signal = tone(440, 3, 0.5);
    const waveform = build(signal, 777);
    expect(waveform.rate).toBe(WAVEFORM_RATE);
    expect(waveform.length).toBe(3 * WAVEFORM_RATE);
    expect(build(signal, 4096).data).toEqual(waveform.data);
  });

  it('shows the peak level and which band the energy is in', () => {
    const out = new Float32Array(4);
    // A full-scale bass tone: peak and lows high, highs low.
    summarise(build(tone(60, 1, 1)), 0.2, 0.8, out);
    expect(out[0]).toBeGreaterThan(0.99);
    expect(out[1]).toBeGreaterThan(0.9);
    expect(out[3]).toBeLessThan(0.15);
    // A quiet high tone: a lower peak (on the square-root scale), and mostly highs.
    summarise(build(tone(9000, 1, 0.25)), 0.2, 0.8, out);
    expect(out[0]).toBeCloseTo(0.5, 1);
    expect(out[3]).toBeGreaterThan(out[1]! + 0.2);
    expect(out[3]).toBeGreaterThan(out[2]!);
  });

  it('reports nothing where it has no buckets yet', () => {
    const out = new Float32Array(4);
    expect(summarise(build(tone(440, 1, 0.5)), 2, 3, out)).toBe(false);
  });
});
