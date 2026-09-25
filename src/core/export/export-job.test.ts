import { describe, expect, it } from 'vitest';
import { FeatureSampler } from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import {
  analysisFrameTime,
  EXPORT_RATE,
  exportFileName,
  FEATURE_FIELDS,
  frameTime,
  planTiming,
} from './export-job';
import { FeatureFeed } from './feature-feed';

describe('export plan', () => {
  it('plans a whole track without pre-roll', () => {
    const timing = planTiming({ start: 0, end: 10 }, 60, 512, 4);
    expect(timing).toMatchObject({
      frames: 600,
      preRollFrames: 0,
      analysisStart: 0,
      audioStart: 0,
      audioFrames: 480000,
      segmentFrames: 240,
      segments: 3,
    });
    // Analysis reaches one hop past the end.
    expect(analysisFrameTime(timing, timing.analysisFrames - 1)).toBeGreaterThanOrEqual(
      480000 + 512,
    );
  });

  it('starts analysis and rendering before a clip', () => {
    const timing = planTiming({ start: 60, end: 90 }, 30, 512);
    expect(timing.analysisStart).toBe(50 * EXPORT_RATE);
    expect(timing.preRollFrames).toBe(90);
    expect(timing.audioFrames).toBe(30 * EXPORT_RATE);
    expect(frameTime(timing, 30, 0)).toBe(60 * EXPORT_RATE);
    expect(frameTime(timing, 30, -timing.preRollFrames)).toBe(57 * EXPORT_RATE);
    // Close to the start of the file, the pre-rolls are shorter.
    const early = planTiming({ start: 1, end: 5 }, 25, 512);
    expect(early.analysisStart).toBe(0);
    expect(early.preRollFrames).toBe(25);
  });

  it('splits exports into segments of up to five minutes, at least three', () => {
    expect(planTiming({ start: 0, end: 3 * 3600 }, 60, 512).segments).toBe(36);
    expect(planTiming({ start: 0, end: 60 }, 30, 512).segmentFrames).toBe(600);
    expect(planTiming({ start: 0, end: 60 }, 30, 512).segments).toBe(3);
    expect(planTiming({ start: 0, end: 4 }, 30, 512).segments).toBe(2);
  });

  it('makes the audio exactly as long as the video', () => {
    const timing = planTiming({ start: 0, end: 10.004 }, 30, 512);
    expect(timing.frames).toBe(300);
    expect(timing.audioFrames).toBe(480000);
  });

  it('names files after the track and the range', () => {
    expect(exportFileName({ title: 'Mix', artist: null }, { start: 3600, end: 7322 }, 'mp4')).toBe(
      'Mix (1h00m00s-2h02m02s).mp4',
    );
    expect(exportFileName({ title: 'Song', artist: 'AC/DC' }, null, 'mp4')).toBe(
      'AC_DC - Song.mp4',
    );
    expect(exportFileName({ title: 'Song', artist: null }, { start: 30, end: 61.5 }, 'webm')).toBe(
      'Song (0m30s-1m01s).webm',
    );
  });
});

describe('feature feed', () => {
  it('replays stored analysis with every hit seen once, also after resuming', async () => {
    const timing = planTiming({ start: 20, end: 30 }, 60, 512);
    // A kick every 50 analysis frames; the frame index is stored as the energy.
    const records = new Float32Array(timing.analysisFrames * FEATURE_FIELDS);
    for (let i = 0; i < timing.analysisFrames; i++) {
      records[i * FEATURE_FIELDS + F.energy] = i;
      if (i % 50 === 0) records[i * FEATURE_FIELDS + F.kickHit] = 1;
    }
    const source = async (index: number, count: number) =>
      records.slice(index * FEATURE_FIELDS, (index + count) * FEATURE_FIELDS);

    const run = async (from: number, to: number, resume: boolean) => {
      const feed = new FeatureFeed(source, timing);
      const sampler = new FeatureSampler(feed.reader);
      if (resume) {
        feed.seek(frameTime(timing, 60, from - 1));
        sampler.resetTo(frameTime(timing, 60, from - 1));
      }
      const out = new Float32Array(F.size);
      const kicks: number[] = [];
      const energy: number[] = [];
      for (let n = from; n < to; n++) {
        const at = frameTime(timing, 60, n);
        await feed.ensure(at);
        sampler.sample(at, out);
        if (out[F.kickHit] === 1) kicks.push(n);
        energy.push(out[F.energy]!);
      }
      return { kicks, energy };
    };

    const whole = await run(-timing.preRollFrames, timing.frames, false);
    const expected = Math.floor((timing.analysisFrames - 1) / 50) + 1;
    // Kicks before the first pre-roll frame are not shown; all later ones exactly once.
    const firstShown = frameTime(timing, 60, -timing.preRollFrames);
    const hidden = Array.from({ length: expected }, (_, k) => k * 50).filter(
      (i) => analysisFrameTime(timing, i) <= firstShown - 512,
    ).length;
    expect(whole.kicks.length).toBeGreaterThanOrEqual(expected - hidden - 2);
    expect(new Set(whole.kicks).size).toBe(whole.kicks.length);

    // Resuming at frame 300 gives exactly the same values from there on.
    const resumed = await run(300, timing.frames, true);
    const offset = 300 + timing.preRollFrames;
    expect(resumed.kicks).toEqual(whole.kicks.filter((n) => n >= 300));
    expect(resumed.energy).toEqual(whole.energy.slice(offset));
  });
});
