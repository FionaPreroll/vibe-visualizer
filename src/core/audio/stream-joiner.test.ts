import { describe, expect, it } from 'vitest';
import { fadeGain, StreamJoiner } from './stream-joiner';

const X = 8;

/** A file of `length` frames whose frame i is `value(i)` on both channels. */
function file(length: number, value: (i: number) => number): Float32Array {
  return Float32Array.from({ length }, (_, i) => value(i));
}

/**
 * Joins `files` (from a frame, to a limit or their end) in blocks of `block` frames, as the
 * media worker and the export do; returns the left channel of the stream.
 */
function join(
  files: { data: Float32Array; from: number; limit: number | null }[],
  block: number,
): number[] {
  const joiner = new StreamJoiner(X);
  const out: number[] = [];
  files.forEach(({ data, from, limit }, index) => {
    joiner.begin(from, index === 0);
    const end = limit ?? data.length;
    for (let position = from; position < end; position += block) {
      const count = Math.min(block, end - position);
      const planes = [
        data.slice(position, position + count),
        data.slice(position, position + count),
      ];
      const keep = joiner.take(planes, position, limit);
      out.push(...planes[0]!.subarray(0, keep));
    }
    if (index + 1 < files.length) joiner.next();
  });
  out.push(...joiner.end()[0]!);
  return out;
}

describe('stream joiner (PL-05, TR-09)', () => {
  it('joins file ends as they are, without a gap', () => {
    const a = file(20, () => 1);
    const b = file(30, () => 2);
    const out = join(
      [
        { data: a, from: 0, limit: null },
        { data: b, from: 0, limit: null },
      ],
      7,
    );
    expect(out).toEqual([...a, ...b]);
  });

  it('crosses an out marker into the next file, and fades in a start at an in marker', () => {
    const a = file(40, () => 1);
    const b = file(50, (i) => 2 + i);
    // A stops at its out marker (frame 30); B starts at its in marker (frame 10).
    const out = join(
      [
        { data: a, from: 0, limit: 30 },
        { data: b, from: 10, limit: null },
      ],
      6,
    );
    expect(out).toHaveLength(30 - X + 40);
    expect(out.slice(0, 30 - X).every((value) => value === 1)).toBe(true);
    for (let i = 0; i < X; i++) {
      const gain = fadeGain(i, X);
      expect(out[30 - X + i]).toBeCloseTo((2 + 10 + i) * gain + Math.sqrt(1 - gain * gain), 5);
    }
    expect(out.at(-1)).toBe(2 + 49);

    // Nothing held back: the start in the middle fades in.
    const faded = join(
      [
        { data: a, from: 0, limit: null },
        { data: b, from: 10, limit: null },
      ],
      6,
    );
    expect(faded[40]).toBeCloseTo(12 * fadeGain(0, X), 5);
    expect(faded[40 + X]).toBe(12 + X);
  });

  it('fades out what was held back at the end of the stream', () => {
    const out = join([{ data: file(30, () => 1), from: 0, limit: 20 }], 4);
    expect(out).toHaveLength(20);
    expect(out[20 - X - 1]).toBe(1);
    expect(out[20 - X]).toBeCloseTo(fadeGain(X - 1, X), 5);
    expect(out[19]).toBeCloseTo(fadeGain(0, X), 5);
  });

  it('gives the same stream however the files are decoded in blocks', () => {
    const files = [
      { data: file(97, (i) => Math.sin(i)), from: 3, limit: 80 },
      { data: file(61, (i) => Math.cos(i)), from: 5, limit: 50 },
      { data: file(44, (i) => i / 44), from: 0, limit: null },
    ];
    const reference = join(files, 1);
    for (const block of [2, 5, 16, 128]) expect(join(files, block)).toEqual(reference);
  });
});
