import { describe, expect, it } from 'vitest';
import {
  decodeAnalysis,
  encodeAnalysis,
  sameGrid,
  type TrackAnalysisResult,
} from './analysis-cache';
import { fingerprint } from './fingerprint';

describe('track analysis cache', () => {
  it('stores and reads back a result', () => {
    const result: TrackAnalysisResult = {
      fingerprint: 'f00d',
      duration: 12.5,
      waveform: {
        rate: 200,
        length: 3,
        data: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
      },
      grid: {
        beats: Float64Array.of(0.5, 1.001, 1.5),
        confidence: Float32Array.of(0.25, 1, 0.5),
        beatInBar: Uint8Array.of(3, 0, 1),
      },
      tempo: null,
      range: 'auto',
    };
    const read = decodeAnalysis(encodeAnalysis(result), 'f00d');
    expect(read).toEqual(result);
    // With a tempo the user gave (TMP-06), and in a tempo range (AN-12).
    const corrected = { ...result, tempo: 174 };
    expect(decodeAnalysis(encodeAnalysis(corrected), 'f00d')?.tempo).toBe(174);
    const fast = { ...result, range: 'fast' as const };
    expect(decodeAnalysis(encodeAnalysis(fast), 'f00d')?.range).toBe('fast');
  });

  it('knows which requests give the same grid', () => {
    expect(sameGrid({ tempo: null, range: 'auto' }, { tempo: null, range: 'auto' })).toBe(true);
    expect(sameGrid({ tempo: null, range: 'auto' }, { tempo: null, range: 'fast' })).toBe(false);
    // A tempo from the user decides; the range does not matter then.
    expect(sameGrid({ tempo: 174, range: 'auto' }, { tempo: 174.004, range: 'fast' })).toBe(true);
    expect(sameGrid({ tempo: 174, range: 'fast' }, { tempo: null, range: 'fast' })).toBe(false);
  });

  it('ignores anything that is not a current analysis', () => {
    expect(decodeAnalysis(new ArrayBuffer(8), 'x')).toBeNull();
    expect(decodeAnalysis(new ArrayBuffer(64), 'x')).toBeNull();
  });
});

describe('fingerprint', () => {
  const bytes = (size: number, seed: number) =>
    Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed * 7) & 255);

  it('is the same for the same content and differs for other content', async () => {
    const small = bytes(1000, 1);
    expect(await fingerprint(new Blob([small]))).toBe(await fingerprint(new Blob([small.slice()])));
    expect(await fingerprint(new Blob([small]))).not.toBe(
      await fingerprint(new Blob([bytes(1000, 2)])),
    );
    // Large files are sampled: a change in the middle counts, and so does the size.
    const large = bytes(3_000_000, 1);
    const changed = large.slice();
    changed[1_500_000] = changed[1_500_000]! ^ 1;
    const id = await fingerprint(new Blob([large]));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await fingerprint(new Blob([changed]))).not.toBe(id);
    expect(await fingerprint(new Blob([large.subarray(0, 2_999_999)]))).not.toBe(id);
  });
});
