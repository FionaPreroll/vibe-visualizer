import { describe, expect, it } from 'vitest';
import {
  createFeatureTimeline,
  FeatureSampler,
  FeatureTimelineReader,
  FeatureTimelineWriter,
} from './feature-timeline';
import { F } from './features';

function frameWith(energy: number, kickHit = 0): Float32Array {
  const frame = new Float32Array(F.size);
  frame[F.energy] = energy;
  frame[F.kickHit] = kickHit;
  return frame;
}

describe('feature timeline', () => {
  it('interpolates between the two nearest frames and keeps hits discrete', () => {
    const sab = createFeatureTimeline(16);
    const writer = new FeatureTimelineWriter(sab);
    const reader = new FeatureTimelineReader(sab);
    writer.write(1000, 1.0, frameWith(0.2, 1));
    writer.write(1512, 1.5, frameWith(0.6));

    const out = new Float32Array(F.size);
    expect(reader.sample(1256, out)).toBe(1.0);
    expect(out[F.energy]).toBeCloseTo(0.4);
    expect(out[F.kickHit]).toBe(1);
    expect(reader.sample(999, out)).toBeNull();
    expect(reader.sample(5000, out)).toBe(1.5);
    expect(out[F.energy]).toBeCloseTo(0.6);
  });

  it('wraps around its capacity', () => {
    const sab = createFeatureTimeline(16);
    const writer = new FeatureTimelineWriter(sab);
    const reader = new FeatureTimelineReader(sab);
    for (let i = 0; i < 100; i++) writer.write(i * 512, i, frameWith(i / 100));
    const out = new Float32Array(F.size);
    expect(reader.sample(99 * 512, out)).toBe(99);
    expect(out[F.energy]).toBeCloseTo(0.99);
    expect(reader.latestEngineFrame()).toBe(99 * 512);
  });

  it('interpolates the beat phase across the wrap to the next beat', () => {
    const sab = createFeatureTimeline(16);
    const writer = new FeatureTimelineWriter(sab);
    const reader = new FeatureTimelineReader(sab);
    const before = new Float32Array(F.size);
    before[F.beatPhase] = 0.9;
    const after = new Float32Array(F.size);
    after[F.beatPhase] = 0.1;
    after[F.beatHit] = 1;
    writer.write(0, 0, before);
    writer.write(512, 0, after);
    const out = new Float32Array(F.size);
    reader.sample(128, out);
    expect(out[F.beatPhase]).toBeCloseTo(0.95);
    reader.sample(384, out);
    expect(out[F.beatPhase]).toBeCloseTo(0.05);
    // Events stay with their own frame.
    expect(out[F.beatHit]).toBe(0);
  });

  it('collects hits that a slow renderer would skip', () => {
    const sab = createFeatureTimeline(16);
    const writer = new FeatureTimelineWriter(sab);
    const reader = new FeatureTimelineReader(sab);
    writer.write(0, 0, frameWith(0));
    writer.write(512, 0, frameWith(0, 1));
    writer.write(1024, 0, frameWith(0));
    const out = new Float32Array(F.size);
    reader.collectHits(0, 1024, out);
    expect(out[F.kickHit]).toBe(1);
    reader.collectHits(512, 1024, out);
    expect(out[F.kickHit]).toBe(0);
    // A clock that steps back reports nothing (the hits up to 1024 were already collected).
    out[F.kickHit] = 1;
    reader.collectHits(1024, 600, out);
    expect(out[F.kickHit]).toBe(0);
  });

  it('samples display times with every hit exactly once', () => {
    const sab = createFeatureTimeline(16);
    const writer = new FeatureTimelineWriter(sab);
    const sampler = new FeatureSampler(new FeatureTimelineReader(sab));
    for (let i = 0; i < 8; i++) writer.write(i * 512, 0, frameWith(0.5, i === 3 ? 1 : 0));
    const out = new Float32Array(F.size);
    expect(sampler.sample(null, out)).toBe(false);
    expect(sampler.sample(700, out)).toBe(true);
    expect(out[F.kickHit]).toBe(0);
    // The hit at 1536 lies between two displays.
    sampler.sample(2000, out);
    expect(out[F.kickHit]).toBe(1);
    sampler.sample(1900, out);
    expect(out[F.kickHit]).toBe(0);
    sampler.sample(2600, out);
    expect(out[F.kickHit]).toBe(0);
    // Resuming just before the hit reports it again, as a continuous run would.
    sampler.resetTo(1500);
    sampler.sample(1600, out);
    expect(out[F.kickHit]).toBe(1);
  });
});
