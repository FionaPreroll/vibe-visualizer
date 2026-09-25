import { describe, expect, it } from 'vitest';
import { createTestSignal } from '../audio/test-signal';
import { hashFloat32 } from '../util/hash';
import { Analyzer } from './analyzer';
import { F, SPECTRUM_BANDS } from './features';

const RATE = 48000;

/** Runs the analyzer over stereo input in blocks and collects copies of all frames. */
function analyze(left: Float32Array, right: Float32Array, block: number): Float32Array[] {
  const analyzer = new Analyzer(RATE);
  const frames: Float32Array[] = [];
  for (let offset = 0; offset < left.length; offset += block) {
    const count = Math.min(block, left.length - offset);
    analyzer.process(left.subarray(offset), right.subarray(offset), count, () => {
      frames.push(analyzer.frame.slice());
    });
  }
  return frames;
}

describe('Analyzer', () => {
  it('emits one frame per hop', () => {
    const silence = new Float32Array(RATE);
    expect(analyze(silence, silence, 128)).toHaveLength(Math.floor(RATE / 512));
  });

  it('finds a 1 kHz tone in the right spectrum band and in the mid band', () => {
    const tone = Float32Array.from({ length: RATE }, (_, i) =>
      Math.sin((2 * Math.PI * 1000 * i) / RATE),
    );
    const last = analyze(tone, tone, 128).at(-1)!;
    const spectrum = Array.from(last.subarray(F.spectrum, F.spectrum + SPECTRUM_BANDS));
    const loudest = spectrum.indexOf(Math.max(...spectrum));
    const center = 30 * (16000 / 30) ** ((loudest + 0.5) / SPECTRUM_BANDS);
    expect(center).toBeGreaterThan(900);
    expect(center).toBeLessThan(1100);
    expect(last[F.bands + 3]).toBeGreaterThan(0.9); // mid
    expect(last[F.bands + 0]).toBeLessThan(0.1); // sub
  });

  it('detects kick, snare, hi-hat and beat of the 120 BPM test signal', () => {
    const [left, right] = createTestSignal(10, RATE) as [Float32Array, Float32Array];
    const frames = analyze(left, right, 128);
    const count = (offset: number) => frames.filter((f) => f[offset] === 1).length;
    expect(count(F.kickHit)).toBe(20);
    expect(count(F.snareHit)).toBe(10);
    expect(count(F.hatHit)).toBe(40);
    expect(count(F.beatHit)).toBeGreaterThanOrEqual(17); // 20 beats, the first ones unconfirmed
    const last = frames.at(-1)!;
    expect(last[F.bpm]).toBeCloseTo(120, 0);
    expect(last[F.beatConfidence]).toBeGreaterThan(0.5);
  });

  it('stays silent on silence', () => {
    const silence = new Float32Array(RATE * 3);
    const last = analyze(silence, silence, 128).at(-1)!;
    // Everything but the tempo and the beat position (which only mean something with confidence).
    last[F.bpm] = 0;
    last[F.beatPhase] = 0;
    expect(Math.max(...last)).toBe(0);
  });

  it('is independent of the block size', () => {
    const [left, right] = createTestSignal(3, RATE) as [Float32Array, Float32Array];
    const small = analyze(left, right, 128);
    const large = analyze(left, right, 4096);
    expect(hashFloat32(...large)).toBe(hashFloat32(...small));
  });
});
