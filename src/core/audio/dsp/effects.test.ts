import { describe, expect, it } from 'vitest';
import { StereoDelay } from './delay';
import { DjFilter } from './dj-filter';
import { DspCore } from './dsp-core';
import { Limiter, LIMITER_CEILING, LIMITER_LOOKAHEAD } from './limiter';
import { FdnReverb } from './reverb';
import { DEFAULT_SOUND, SOUND_PRESETS, syncedDelaySeconds } from './sound-settings';
import {
  ArraySource,
  collect,
  decibels,
  maxStep,
  peak,
  RATE,
  rms,
  sine,
  stereo,
  toneLevel,
} from './test-support';

/** Runs an in-place effect over the whole input, block by block. */
function run(
  input: readonly Float32Array[],
  process: (block: Float32Array[], size: number, offset: number) => void,
): Float32Array[] {
  const frames = input[0]!.length;
  let offset = 0;
  return collect(frames, (block, size) => {
    block[0]!.set(input[0]!.subarray(offset, offset + size));
    block[1]!.set(input[1]!.subarray(offset, offset + size));
    process(block, size, offset);
    offset += size;
  });
}

function impulse(frames: number, at = 0, value = 1): Float32Array[] {
  const plane = new Float32Array(frames);
  plane[at] = value;
  return stereo(plane);
}

function noise(frames: number, amplitude = 0.3): Float32Array[] {
  let state = 12345;
  const plane = Float32Array.from({ length: frames }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return amplitude * ((state / 2 ** 32) * 2 - 1);
  });
  return [plane, plane.map((x, i) => x * (i % 2 ? 1 : -1))];
}

describe('DJ filter', () => {
  const level = (amount: number, frequency: number) => {
    const filter = new DjFilter(RATE);
    filter.amount = amount;
    filter.resonance = 0;
    filter.snap();
    const out = run(stereo(sine(frequency, RATE / 2)), (block, size) =>
      filter.process(block, size),
    );
    return decibels(toneLevel(out[0]!.subarray(RATE / 8), frequency) / 0.5);
  };

  it('is a low-pass to the left and a high-pass to the right', () => {
    expect(level(-1, 5000)).toBeLessThan(-40);
    expect(level(-1, 50)).toBeGreaterThan(-3.5);
    expect(level(1, 100)).toBeLessThan(-40);
    expect(level(1, 12000)).toBeGreaterThan(-3.5);
  });

  it('leaves the sound untouched in the middle', () => {
    const filter = new DjFilter(RATE);
    const input = noise(4096);
    const out = run(input, (block, size) => filter.process(block, size));
    expect(out[0]).toEqual(input[0]);
  });

  it('sweeps from low-pass to high-pass without clicks', () => {
    const filter = new DjFilter(RATE);
    filter.resonance = 1;
    const out = run(stereo(sine(300, RATE * 2, 0.3)), (block, size, offset) => {
      filter.amount = Math.min(1, -1 + (2 * offset) / RATE);
      filter.process(block, size);
    });
    expect(out[0]!.every(Number.isFinite)).toBe(true);
    // A 300 Hz sine moves at most 0.012 per sample; resonance may raise it, but no jumps.
    expect(maxStep(out[0]!)).toBeLessThan(0.1);
  });
});

describe('delay', () => {
  function delay(settings: Partial<StereoDelay['parameters']>): StereoDelay {
    const effect = new StereoDelay(RATE);
    Object.assign(effect.parameters, { on: true, tone: 0, ...settings });
    effect.snap();
    return effect;
  }

  it('repeats with the feedback', () => {
    const effect = delay({ seconds: 0.1, feedback: 0.5, mix: 0.5, pingPong: false });
    const out = run(impulse(RATE / 2), (block, size) => effect.process(block, size));
    expect(out[0]![0]).toBeCloseTo(1, 6);
    expect(out[0]![4800]).toBeCloseTo(1, 6);
    expect(out[0]![9600]).toBeCloseTo(0.5, 6);
    expect(out[0]![14400]).toBeCloseTo(0.25, 6);
    expect(peak(out[0]!, 1, 4800)).toBe(0);
  });

  it('bounces between the sides with ping-pong', () => {
    const effect = delay({ seconds: 0.1, feedback: 0.5, mix: 0.5, pingPong: true });
    const out = run(impulse(RATE / 2), (block, size) => effect.process(block, size));
    expect(out[0]![4800]).toBeCloseTo(1, 6);
    expect(out[1]![4800]).toBe(0);
    expect(out[1]![9600]).toBeCloseTo(0.5, 6);
    expect(out[0]![9600]).toBe(0);
    expect(out[0]![14400]).toBeCloseTo(0.25, 6);
  });

  it('lets the echoes ring out when switched off, then goes idle', () => {
    const effect = delay({ seconds: 0.1, feedback: 0.5, mix: 0.5, pingPong: false });
    const out = run(impulse(RATE * 2), (block, size, offset) => {
      if (offset === 1024) effect.parameters.on = false;
      effect.process(block, size);
    });
    expect(out[0]![4800]).toBeCloseTo(1, 6);
    expect(out[0]![9600]).toBeCloseTo(0.5, 6);
    expect(effect.active).toBe(false);
  });

  it('crossfades to a new delay time', () => {
    const effect = delay({ seconds: 0.3, feedback: 0.6, mix: 0.5 });
    const out = run(stereo(sine(220, RATE * 2, 0.3)), (block, size, offset) => {
      if (offset === RATE) effect.parameters.seconds = 0.2;
      effect.process(block, size);
    });
    // 220 Hz at up to ~1.2 (dry plus echoes) moves < 0.04 per sample; a hard switch would jump.
    expect(maxStep(out[0]!, 2)).toBeLessThan(0.06);
  });

  it('follows the beat: note values at a tempo', () => {
    expect(syncedDelaySeconds(120, '1/8', 'dotted')).toBeCloseTo(0.375, 9);
    expect(syncedDelaySeconds(120, '1/4', 'straight')).toBeCloseTo(0.5, 9);
    expect(syncedDelaySeconds(90, '1/16', 'triplet')).toBeCloseTo((60 / 90) * 0.25 * (2 / 3), 9);
  });
});

describe('reverb', () => {
  function reverb(decay: number, size = 0.6): FdnReverb {
    const effect = new FdnReverb(RATE);
    Object.assign(effect.parameters, { on: true, decay, size, preDelay: 0, damping: 0, mix: 1 });
    effect.snap();
    return effect;
  }

  it('decays by 60 dB over the decay time', () => {
    const effect = reverb(1);
    const out = run(impulse(RATE * 2, 0, 0.5), (block, size) => effect.process(block, size));
    // Energy from 0.2 to 0.3 s against 0.7 to 0.8 s: half the decay time → 30 dB.
    const early = rms(out[0]!, RATE * 0.2, RATE * 0.3);
    const late = rms(out[0]!, RATE * 0.7, RATE * 0.8);
    expect(decibels(early / late)).toBeGreaterThan(24);
    expect(decibels(early / late)).toBeLessThan(36);
  });

  it('keeps about the same level for short and long decays', () => {
    const levels = [0.5, 2.5, 10].map((decay) => {
      const effect = reverb(decay);
      const input = noise(RATE * 3);
      const out = run(input, (block, size) => effect.process(block, size));
      return decibels(rms(out[0]!, RATE * 2) / rms(input[0]!, RATE * 2));
    });
    for (const level of levels) {
      expect(level).toBeGreaterThan(-9);
      expect(level).toBeLessThan(6);
    }
  });

  it('is stereo', () => {
    const effect = reverb(2);
    const input = noise(RATE);
    input[1] = input[0]!.slice();
    const out = run(input, (block, size) => effect.process(block, size));
    let dot = 0;
    for (let i = RATE / 2; i < RATE; i++) dot += out[0]![i]! * out[1]![i]!;
    const correlation = dot / (rms(out[0]!, RATE / 2) * rms(out[1]!, RATE / 2) * (RATE / 2));
    expect(Math.abs(correlation)).toBeLessThan(0.5);
  });

  it('lets the tail ring out when switched off, then goes idle', () => {
    const effect = reverb(0.5);
    const out = run(noise(RATE * 5), (block, size, offset) => {
      if (offset >= RATE) {
        effect.parameters.on = false;
        block[0]!.fill(0);
        block[1]!.fill(0);
      }
      effect.process(block, size);
    });
    expect(rms(out[0]!, RATE + 2400, RATE + 7200)).toBeGreaterThan(0.01);
    expect(effect.active).toBe(false);
    expect(out[0]!.every(Number.isFinite)).toBe(true);
  });
});

describe('limiter', () => {
  it('keeps loud peaks below the ceiling', () => {
    const limiter = new Limiter(RATE);
    const input = stereo(sine(100, RATE, 2));
    input[0]![RATE / 2] = 8;
    const out = run(input, (block, size) => limiter.process(block, size));
    expect(peak(out[0]!)).toBeLessThanOrEqual(LIMITER_CEILING);
    expect(peak(out[1]!)).toBeLessThanOrEqual(LIMITER_CEILING);
    expect(peak(out[0]!, RATE / 4, RATE / 2)).toBeGreaterThan(0.9);
  });

  it('only delays quiet sound', () => {
    const limiter = new Limiter(RATE);
    const input = noise(4096, 0.5);
    const out = run(input, (block, size) => limiter.process(block, size));
    expect(out[0]!.subarray(LIMITER_LOOKAHEAD)).toEqual(
      input[0]!.subarray(0, 4096 - LIMITER_LOOKAHEAD),
    );
  });

  it('turns the gain down before a peak and back up after it', () => {
    const limiter = new Limiter(RATE);
    const input = stereo(sine(50, RATE, 0.5));
    for (let i = 24000; i < 24480; i++) input[0]![i]! *= 4;
    const out = run(input, (block, size) => limiter.process(block, size));
    expect(maxStep(out[0]!)).toBeLessThan(0.1);
    expect(limiter.currentGain).toBeGreaterThan(0.99);
  });
});

describe('sound chain', () => {
  function render(settings = DEFAULT_SOUND, seconds = 1) {
    const dsp = new DspCore(RATE, null);
    dsp.setSettings(settings);
    dsp.snap();
    dsp.reset();
    const source = new ArraySource(noise(RATE * 2));
    return collect(RATE * seconds, (block, size) => {
      dsp.renderMusic(source, block, size);
      dsp.renderEffects(block, size);
    });
  }

  it('changes nothing with clean settings, apart from the limiter delay', () => {
    const out = render();
    const input = noise(RATE * 2);
    expect(out[0]!.subarray(1024)).toEqual(
      input[0]!.subarray(1024 - LIMITER_LOOKAHEAD, RATE - LIMITER_LOOKAHEAD),
    );
  });

  it('renders the presets deterministically and within the ceiling', () => {
    for (const preset of SOUND_PRESETS) {
      const first = render(preset.settings);
      expect(render(preset.settings)[0]).toEqual(first[0]);
      expect(peak(first[0]!)).toBeLessThanOrEqual(LIMITER_CEILING);
    }
  });

  it('reports the heard position behind the limiter', () => {
    const dsp = new DspCore(RATE, null);
    dsp.setSettings({ ...DEFAULT_SOUND, rate: 0.8 });
    dsp.reset();
    const source = new ArraySource(noise(RATE));
    collect(RATE / 2, (block, size) => dsp.renderMusic(source, block, size));
    expect(dsp.musicPosition).toBeCloseTo(RATE * 0.4, 6);
    expect(dsp.sourcePosition).toBeCloseTo(RATE * 0.4 - LIMITER_LOOKAHEAD * 0.8, 6);
  });
});
