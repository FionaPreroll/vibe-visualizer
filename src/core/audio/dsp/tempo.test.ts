import { describe, expect, it } from 'vitest';
import { SignalsmithStretch } from '../stretch/signalsmith-stretch';
import { TempoStage } from './tempo';
import {
  ArraySource,
  collect,
  decibels,
  maxStep,
  RATE,
  rms,
  sine,
  stereo,
  toneLevel,
} from './test-support';

function vinyl(rate: number): TempoStage {
  const stage = new TempoStage(null);
  stage.rate = rate;
  stage.reset();
  return stage;
}

function keyLock(rate: number): TempoStage {
  const stage = new TempoStage(new SignalsmithStretch(2, RATE));
  stage.mode = 'keylock';
  stage.rate = rate;
  stage.reset();
  return stage;
}

describe('tempo stage, vinyl', () => {
  it('passes the source through unchanged at the original speed', () => {
    const input = stereo(sine(440, RATE));
    const stage = vinyl(1);
    const source = new ArraySource(input);
    const out = collect(RATE / 2, (block, size) => stage.process(source, block, size));
    // Apart from the fade-in at the start of the stream, a bit-exact copy.
    expect(Array.from(out[0]!.subarray(256, 4096))).toEqual(
      Array.from(input[0]!.subarray(256, 4096)),
    );
    expect(stage.sourcePosition).toBe(RATE / 2);
  });

  it('lowers the pitch at half speed and advances the source by half', () => {
    const stage = vinyl(0.5);
    const source = new ArraySource(stereo(sine(1000, RATE)));
    const out = collect(RATE, (block, size) => stage.process(source, block, size));
    const part = out[0]!.subarray(4800);
    expect(toneLevel(part, 500)).toBeCloseTo(0.5, 2);
    expect(toneLevel(part, 1000)).toBeLessThan(0.001);
    expect(stage.sourcePosition).toBeCloseTo(RATE / 2, 6);
  });

  it('filters out what would alias when faster', () => {
    // 20 kHz played 1.5× faster would be 30 kHz, above the Nyquist frequency: it must vanish
    // instead of folding back to 18 kHz. 8 kHz becomes 12 kHz and stays.
    const stage = vinyl(1.5);
    const source = new ArraySource(stereo(sine(20000, RATE)));
    const out = collect(RATE / 2, (block, size) => stage.process(source, block, size));
    expect(decibels(rms(out[0]!, 4800) / rms(sine(20000, 4800)))).toBeLessThan(-60);

    const kept = vinyl(1.5);
    const tone = new ArraySource(stereo(sine(8000, RATE)));
    const result = collect(RATE / 2, (block, size) => kept.process(tone, block, size));
    expect(toneLevel(result[0]!.subarray(4800), 12000)).toBeCloseTo(0.5, 2);
  });

  it('glides to a new speed without clicks', () => {
    const stage = vinyl(1);
    const source = new ArraySource(stereo(sine(200, RATE * 2)));
    let blocks = 0;
    const out = collect(RATE, (block, size) => {
      if (++blocks === 100) stage.rate = 1.5;
      stage.process(source, block, size);
    });
    // A 200…300 Hz sine at 0.5 moves at most ~0.02 per sample.
    expect(maxStep(out[0]!, 512)).toBeLessThan(0.025);
  });

  it('waits for a slow source and then continues seamlessly', () => {
    const stage = vinyl(1);
    const input = stereo(sine(300, RATE));
    const source = new ArraySource(input, 0);
    collect(1280, (block, size) => stage.process(source, block, size));
    expect(stage.sourcePosition).toBe(0);
    expect(stage.underrun).toBe(false); // not started yet: no underrun
    source.limit = 2000;
    collect(2048, (block, size) => stage.process(source, block, size));
    expect(stage.underrun).toBe(true);
    source.limit = Infinity;
    const out = collect(1024, (block, size) => stage.process(source, block, size));
    expect(stage.underrun).toBe(false);
    expect(out[0]![500]).toBeCloseTo(input[0]![Math.round(stage.sourcePosition) - 1024 + 500]!, 6);
  });

  it('plays silence after the end of the source', () => {
    const stage = vinyl(0.9);
    const source = new ArraySource(stereo(sine(300, 4800)));
    const out = collect(RATE / 4, (block, size) => stage.process(source, block, size));
    expect(rms(out[0]!, 7000)).toBe(0);
    expect(out[0]!.every(Number.isFinite)).toBe(true);
  });
});

describe('tempo stage, key lock', () => {
  it('keeps the pitch and consumes the source at the new speed', () => {
    const stage = keyLock(1.25);
    const source = new ArraySource(stereo(sine(1000, RATE * 2)));
    const out = collect(RATE, (block, size) => stage.process(source, block, size));
    const part = out[0]!.subarray(RATE / 4);
    expect(toneLevel(part, 1000)).toBeGreaterThan(0.4);
    expect(toneLevel(part, 1250)).toBeLessThan(0.02);
    expect(stage.sourcePosition).toBeGreaterThan(RATE * 1.25 - 64);
    expect(stage.sourcePosition).toBeLessThan(RATE * 1.25 + 64);
  });

  it('starts right at the beginning of the stream', () => {
    // A burst at 100 ms must come out at 100 ms: no latency, no leading silence.
    const input = new Float32Array(RATE);
    input.set(sine(1000, 2400), 4800);
    const stage = keyLock(1);
    const source = new ArraySource(stereo(input));
    const out = collect(RATE / 2, (block, size) => stage.process(source, block, size));
    const before = rms(out[0]!, 0, 4000);
    const burst = rms(out[0]!, 5000, 7000);
    expect(burst).toBeGreaterThan(0.25);
    expect(before).toBeLessThan(burst / 30);
  });

  it('switches modes at the same position, with a short dip instead of a click', () => {
    const stage = keyLock(1);
    stage.mode = 'vinyl';
    stage.reset();
    const input = stereo(sine(250, RATE * 3));
    const source = new ArraySource(input);
    collect(RATE / 2, (block, size) => stage.process(source, block, size));
    const before = stage.sourcePosition;
    stage.mode = 'keylock';
    const out = collect(RATE / 2, (block, size) => stage.process(source, block, size));
    // The position runs on at the same speed through the switch.
    expect(stage.sourcePosition - before).toBeGreaterThan(RATE / 2 - 64);
    expect(stage.sourcePosition - before).toBeLessThan(RATE / 2 + 64);
    expect(maxStep(out[0]!)).toBeLessThan(0.05);
    expect(rms(out[0]!, RATE / 4)).toBeGreaterThan(0.3);

    stage.mode = 'vinyl';
    const back = collect(RATE / 2, (block, size) => stage.process(source, block, size));
    expect(maxStep(back[0]!)).toBeLessThan(0.05);
    // Vinyl again: in phase with the source at the reported position.
    const at = stage.sourcePosition;
    const next = collect(128, (block, size) => stage.process(source, block, size));
    expect(next[0]![10]).toBeCloseTo(input[0]![Math.round(at) + 10]!, 2);
  });

  it('gives identical output for identical input', () => {
    const run = () => {
      const stage = keyLock(0.85);
      const source = new ArraySource(stereo(sine(440, RATE)));
      return collect(RATE / 2, (block, size) => stage.process(source, block, size))[0]!;
    };
    expect(run()).toEqual(run());
  });
});
