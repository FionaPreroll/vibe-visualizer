import { describe, expect, it } from 'vitest';
import { createPrng } from '../util/prng';
import { Resampler } from './resampler';

function sine(frequency: number, rate: number, frames: number, offset = 0): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, i) => Math.sin((2 * Math.PI * frequency * (i + offset)) / rate) * 0.8,
  );
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Feeds a mono signal in the given chunk sizes and returns the full output. */
function run(resampler: Resampler, input: Float32Array, chunks: number[]): Float32Array {
  const parts: Float32Array[] = [];
  let offset = 0;
  for (const size of chunks) {
    const frames = Math.min(size, input.length - offset);
    if (frames <= 0) break;
    parts.push(resampler.push([input.subarray(offset, offset + frames)], frames)[0]!);
    offset += frames;
  }
  parts.push(resampler.flush()[0]!);
  return concat(parts);
}

describe('Resampler', () => {
  const input = sine(1000, 44100, 44100);

  it('converts 44.1 kHz to 48 kHz with the right length', () => {
    const output = run(new Resampler(1, 44100, 48000), input, [input.length]);
    expect(output.length).toBeGreaterThanOrEqual(48000);
    expect(output.length).toBeLessThanOrEqual(48001);
  });

  it('keeps a 1 kHz sine accurate (after the start transient)', () => {
    const output = run(new Resampler(1, 44100, 48000), input, [input.length]);
    const expected = sine(1000, 48000, output.length);
    let maxError = 0;
    for (let i = 100; i < output.length - 100; i++) {
      maxError = Math.max(maxError, Math.abs(output[i]! - expected[i]!));
    }
    expect(maxError).toBeLessThan(1e-3);
  });

  it('is bit-identical for any chunking', () => {
    const random = createPrng(3);
    const chunks = Array.from({ length: 400 }, () => 1 + Math.floor(random() * 700));
    const oneShot = run(new Resampler(1, 44100, 48000), input, [input.length]);
    const chunked = run(new Resampler(1, 44100, 48000), input, chunks);
    expect(chunked.length).toBe(oneShot.length);
    expect(chunked).toEqual(oneShot);
  });

  it('starts exactly at a seek position', () => {
    const resampler = new Resampler(1, 44100, 48000);
    const target = 30_001; // output frame
    const inputFrame = resampler.reset(target);
    const rest = input.subarray(inputFrame);
    const output = resampler.push([rest], rest.length)[0]!;
    const expected = sine(1000, 48000, 2000, target);
    for (let i = 0; i < 2000; i++) expect(Math.abs(output[i]! - expected[i]!)).toBeLessThan(1e-3);
  });

  it('downsamples 96 kHz to 48 kHz without aliasing a 30 kHz tone', () => {
    const tone = sine(30_000, 96000, 96000);
    const output = run(new Resampler(1, 96000, 48000), tone, [tone.length]);
    let peak = 0;
    for (let i = 200; i < output.length - 200; i++) peak = Math.max(peak, Math.abs(output[i]!));
    expect(peak).toBeLessThan(0.001);
  });
});
