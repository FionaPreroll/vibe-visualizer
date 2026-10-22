import { describe, expect, it } from 'vitest';
import { PositionSmoother } from './position-smoother';

/** A small, repeatable jitter in -1…1. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Playback as the browser has it: the audio callback comes every `period` seconds (a little
 * early or late) and publishes the position at the end of what it rendered, `ahead` seconds
 * ahead of the steady clock; the screen shows a frame every 1/60 s. Returns, per frame after
 * the first second, the position read as it is and the smooth one, against the time of the
 * frame.
 */
function play(rate: number, period = 0.01, ahead = 0.02) {
  const smoother = new PositionSmoother();
  const start = 12;
  const frames: { at: number; raw: number; smooth: number }[] = [];
  for (let frame = 0; frame < 300; frame++) {
    // The steady clock at the frame (the audio clock runs with it here).
    const at = frame / 60 + 0.002 * jitter(frame);
    // The last callback before it, and what it published.
    const callback = Math.floor(at / period);
    const callbackAt = callback * period + 0.001 * jitter(callback + 1000);
    const last = callbackAt <= at ? callback : callback - 1;
    const renderTime = (last + 1) * period + ahead;
    const raw = start + renderTime * rate;
    frames.push({ at, raw, smooth: smoother.at(raw, rate, renderTime, at) });
  }
  return frames.slice(60);
}

/** Spread (standard deviation, ms) of how far each frame's position is off from its time. */
function stutter(frames: { at: number; value: number }[], rate: number): number {
  const offs = frames.map(({ at, value }) => value - at * rate);
  const mean = offs.reduce((sum, value) => sum + value, 0) / offs.length;
  return Math.sqrt(offs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / offs.length) * 1000;
}

describe('the position shown (smooth between the audio callbacks)', () => {
  for (const rate of [1, 0.92, 1.08]) {
    it(`moves on evenly from frame to frame, at the speed ${rate}`, () => {
      const frames = play(rate);
      const raw = stutter(
        frames.map(({ at, raw }) => ({ at, value: raw })),
        rate,
      );
      const smooth = stutter(
        frames.map(({ at, smooth }) => ({ at, value: smooth })),
        rate,
      );
      // Read as it is, it is off by milliseconds from frame to frame; smoothed, by a fraction.
      expect(raw).toBeGreaterThan(2);
      expect(smooth).toBeLessThan(0.5);
    });
  }

  it('is the published position on average, so cues stay at the playhead', () => {
    const frames = play(1);
    const mean = frames.reduce((sum, { raw, smooth }) => sum + (smooth - raw), 0) / frames.length;
    expect(Math.abs(mean) * 1000).toBeLessThan(1);
  });

  it('is the published position while the music stands still', () => {
    const smoother = new PositionSmoother();
    expect(smoother.at(30, 0, 5.02, 5)).toBe(30);
    expect(smoother.at(30, 0, 5.03, 5.01)).toBe(30);
  });

  it('follows a jump in the position at once', () => {
    const smoother = new PositionSmoother();
    for (let frame = 0; frame < 30; frame++)
      smoother.at(10 + frame / 60, 1, frame / 60 + 0.02, frame / 60);
    // A seek to 100 s: the next published position is shown, give or take the lead.
    const shown = smoother.at(100, 1, 0.52, 0.5);
    expect(Math.abs(shown - 100)).toBeLessThan(0.005);
  });

  it('starts the lead anew when the audio clock jumps against the steady one', () => {
    const smoother = new PositionSmoother();
    for (let frame = 0; frame < 30; frame++)
      smoother.at(10 + frame / 60, 1, frame / 60 + 0.02, frame / 60);
    // The audio clock is half a second behind now (the context was suspended): no slow drift.
    const shown = smoother.at(10.5, 1, 0.52, 0);
    expect(shown).toBeCloseTo(10.5, 6);
  });
});

describe('the position shown, with clocks that drift apart', () => {
  it('keeps to the music for minutes while the audio clock runs 50 ppm fast', () => {
    const smoother = new PositionSmoother();
    const offs: number[] = [];
    // Ten minutes: unfollowed, the drift would come to 30 ms.
    for (let frame = 0; frame < 36_000; frame++) {
      const clock = frame / 60 + 0.001 * jitter(frame);
      const audio = clock * (1 + 50e-6);
      const renderTime = Math.floor(audio / 0.01 + 1) * 0.01 + 0.02;
      const shown = smoother.at(renderTime, 1, renderTime, clock);
      if (frame >= 60) offs.push((shown - audio) * 1000);
    }
    expect(Math.max(...offs) - Math.min(...offs)).toBeLessThan(5);
  });
});
