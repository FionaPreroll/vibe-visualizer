import { describe, expect, it } from 'vitest';
import { FeatureSampler } from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { LIMITER_LOOKAHEAD } from '../audio/dsp/limiter';
import { DEFAULT_SOUND, SOUND_PRESETS } from '../audio/dsp/sound-settings';
import {
  analysisFrameTime,
  chapterProblem,
  chapterText,
  EXPORT_RATE,
  exportFileName,
  exportSeconds,
  fadeAt,
  FEATURE_FIELDS,
  frameTime,
  isSoundFile,
  partAt,
  partChapters,
  partLayout,
  planParts,
  planTiming,
  uniqueName,
  upgradeManifest,
  videoFileName,
  type ExportManifest,
  type ExportPart,
} from './export-job';
import { FeatureFeed } from './feature-feed';

describe('export plan', () => {
  it('plans a whole track without pre-roll', () => {
    const timing = planTiming({ start: 0, end: 10 }, 60, 512, DEFAULT_SOUND, 4);
    expect(timing).toMatchObject({
      frames: 600,
      preRollFrames: 0,
      sourceStart: 0,
      // What is heard comes after the limiter's look-ahead.
      analysisStart: LIMITER_LOOKAHEAD,
      audioStart: LIMITER_LOOKAHEAD,
      audioFrames: 480000,
      segmentFrames: 240,
      segments: 3,
    });
    // Analysis reaches one hop past the end.
    expect(analysisFrameTime(timing, timing.analysisFrames - 1)).toBeGreaterThanOrEqual(
      timing.audioStart + 480000 + 512,
    );
  });

  it('starts analysis and rendering before a clip', () => {
    const timing = planTiming({ start: 60, end: 90 }, 30, 512);
    expect(timing.sourceStart).toBe(50 * EXPORT_RATE);
    expect(timing.preRollFrames).toBe(90);
    expect(timing.audioFrames).toBe(30 * EXPORT_RATE);
    expect(frameTime(timing, 30, 0)).toBe(10 * EXPORT_RATE + LIMITER_LOOKAHEAD);
    expect(frameTime(timing, 30, -timing.preRollFrames)).toBe(7 * EXPORT_RATE + LIMITER_LOOKAHEAD);
    // Close to the start of the file, the pre-rolls are shorter.
    const early = planTiming({ start: 1, end: 5 }, 25, 512);
    expect(early.sourceStart).toBe(0);
    expect(early.preRollFrames).toBe(25);
  });

  it('plans in output time when the tempo changes', () => {
    const sound = { ...DEFAULT_SOUND, rate: 0.8 };
    expect(exportSeconds({ start: 60, end: 90 }, sound)).toBeCloseTo(37.5, 9);
    const timing = planTiming({ start: 60, end: 90 }, 30, 512, sound);
    expect(timing.frames).toBe(1125);
    expect(timing.audioFrames).toBe(37.5 * EXPORT_RATE);
    // Ten output seconds of pre-roll are eight seconds of the file at 80 %.
    expect(timing.sourceStart).toBe(52 * EXPORT_RATE);
    expect(timing.audioStart).toBe(10 * EXPORT_RATE + LIMITER_LOOKAHEAD);
  });

  it('continues exports that were started before tempo and effects', () => {
    const timing = planTiming({ start: 60, end: 90 }, 30, 512);
    const old = {
      version: 1,
      timing: { ...timing, analysisStart: 50 * EXPORT_RATE, audioStart: 60 * EXPORT_RATE },
    };
    const source = { name: 'a.mp3', size: 1, lastModified: 0, title: 'A', artist: null };
    const upgraded = upgradeManifest({
      ...old,
      source,
      range: { start: 60, end: 90 },
      images: { background: null, logo: null },
      visuals: { mode: 'kaleidoscope' },
    })!;
    expect(upgraded.version).toBe(3);
    expect(upgraded.sound).toEqual(DEFAULT_SOUND);
    expect(upgraded.timing).toMatchObject({
      sourceStart: 50 * EXPORT_RATE,
      analysisStart: 0,
      audioStart: 10 * EXPORT_RATE,
    });
    expect(upgraded.parts).toEqual([{ source, range: { start: 60, end: 90 }, cut: false }]);
    expect(upgradeManifest({ version: 4 })).toBeNull();
    const current = { version: 3 } as unknown as ExportManifest;
    expect(upgradeManifest(current)).toBe(current);
  });

  it('upgrades the export of one track to its single part, with its overlay and cover', () => {
    const timing = planTiming({ start: 60, end: 90 }, 30, 512);
    const source = { name: 'a.mp3', size: 1, lastModified: 0, title: 'A', artist: 'B' };
    const overlay = { on: true };
    const upgraded = upgradeManifest({
      version: 2,
      source,
      range: { start: 60, end: 90 },
      timing,
      fade: undefined,
      images: { background: 'image/png', logo: null, cover: 'image/jpeg' },
      visuals: { mode: 'logoSpectrum', overlay: { settings: overlay, track: {} } },
    })!;
    expect(upgraded.parts[0]!.source).toEqual(source);
    expect(upgraded.fade).toBe(0);
    expect(upgraded.images).toEqual({
      background: 'image/png',
      logo: null,
      covers: ['image/jpeg'],
    });
    expect(upgraded.visuals.overlay).toEqual(overlay);
    expect(upgraded.timing.partStarts).toEqual([10 * EXPORT_RATE]);
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
    // A sound preset is named; other edits are not.
    const slowed = SOUND_PRESETS.find((preset) => preset.name === 'Slowed + Reverb')!.settings;
    expect(exportFileName({ title: 'Song', artist: null }, null, 'mp4', slowed)).toBe(
      'Song (Slowed + Reverb).mp4',
    );
    expect(
      exportFileName({ title: 'Song', artist: null }, null, 'mp4', { ...slowed, rate: 0.9 }),
    ).toBe('Song.mp4');
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

/** A part of a file of `seconds`, from `start` to `end`. */
function part(title: string, start: number, end: number, cut = false): ExportPart {
  const source = { name: `${title}.wav`, size: 1, lastModified: 0, title, artist: 'DJ' };
  return { source, range: { start, end }, cut };
}

describe('videos of several tracks (EX-05, EX-14, EX-16)', () => {
  it('joins the parts as the player does: a part cut at its out marker crosses into the next', () => {
    const parts = [part('A', 0, 10), part('B', 5, 25, true), part('C', 0, 30)];
    const { starts, length } = partLayout(parts);
    // B stops at its out marker: its last 10 ms cross into C.
    expect(starts).toEqual([0, 10 * EXPORT_RATE, 30 * EXPORT_RATE - 480]);
    expect(length).toBe(60 * EXPORT_RATE - 480);
    // The last part's cut fades out within it: nothing follows.
    expect(partLayout([part('A', 0, 10, true)]).length).toBe(10 * EXPORT_RATE);
  });

  it('plans the video as one range of all parts, after the pre-roll of the first', () => {
    const parts = [part('A', 20, 30), part('B', 0, 15)];
    const timing = planParts(parts, 30, 512);
    expect(timing.frames).toBe(25 * 30);
    // Ten seconds of pre-roll before A's range.
    expect(timing.sourceStart).toBe(10 * EXPORT_RATE);
    expect(timing.partStarts).toEqual([10 * EXPORT_RATE, 20 * EXPORT_RATE]);
    expect(planParts([part('A', 60, 90)], 30, 512)).toEqual(
      planTiming({ start: 60, end: 90 }, 30, 512),
    );
  });

  it('knows the part heard at each frame and the second of its file', () => {
    const sound = { ...DEFAULT_SOUND, rate: 1.25 };
    const parts = [part('A', 20, 30), part('B', 5, 15)];
    const manifest = { parts, timing: planParts(parts, 25, 512, sound), sound };
    expect(partAt(manifest, 25, 0)).toMatchObject({ index: 0, seconds: 20 });
    // At 1.25 ×, the first part's ten seconds take eight.
    expect(partAt(manifest, 25, 4 * 25)).toMatchObject({ index: 0, seconds: 25 });
    const b = partAt(manifest, 25, 9 * 25);
    expect(b.index).toBe(1);
    expect(b.seconds).toBeCloseTo(5 + 1.25, 6);
    // B began a second of the video before (its 1.25 s at 1.25 ×).
    expect(b.since).toBeCloseTo(1, 6);
    // The pre-roll comes from before the first range.
    expect(partAt(manifest, 25, -25).seconds).toBeCloseTo(18.75, 6);
  });

  it('lists the chapters for YouTube and says when YouTube would not show them', () => {
    const parts = [part('Intro', 0, 50), part('Main', 0, 125), part('Outro', 0, 3605)];
    const timing = planParts(parts, 30, 512);
    const chapters = partChapters(parts, timing, DEFAULT_SOUND);
    expect(chapterText(chapters)).toBe('0:00 DJ – Intro\n0:50 DJ – Main\n2:55 DJ – Outro');
    // A start a few frames early (as decoded) still names its second.
    expect(chapterText([{ seconds: 49.9996, title: 'Main' }])).toBe('0:50 Main');
    expect(chapterProblem(chapters, 3780)).toBeNull();
    expect(chapterProblem(chapters.slice(0, 2), 175)).toMatch(/3 tracks or more/);
    const shortParts = [part('A', 0, 30), part('B', 0, 5), part('C', 0, 30)];
    const short = partChapters(shortParts, planParts(shortParts, 30, 512), DEFAULT_SOUND);
    expect(chapterProblem(short, 65)).toMatch(/“DJ – B” is shorter/);
    // At the tempo, the chapters move with the music.
    const faster = partChapters(
      parts,
      planParts(parts, 30, 512, { ...DEFAULT_SOUND, rate: 1.25 }),
      {
        ...DEFAULT_SOUND,
        rate: 1.25,
      },
    );
    expect(faster[1]!.seconds).toBeCloseTo(40, 6);
  });

  it('names the video after its first track', () => {
    expect(videoFileName([part('A', 0, 10)], 'mp4')).toBe('DJ - A.mp4');
    expect(videoFileName([part('A', 0, 10, true)], 'mp4')).toBe('DJ - A (0m00s-0m10s).mp4');
    expect(videoFileName([part('A', 5, 10)], 'mp4')).toBe('DJ - A (0m05s-0m10s).mp4');
    expect(videoFileName([part('A', 5, 10), part('B', 0, 9), part('C', 0, 9)], 'webm')).toBe(
      'DJ - A and 2 more.webm',
    );
  });

  it('gives the videos of a batch names of their own (EX-09)', () => {
    expect(isSoundFile('Clicks (Sped up).wav')).toBe(true);
    expect(isSoundFile('Clicks.mp4')).toBe(false);
    expect(uniqueName('A.mp4', new Set())).toBe('A.mp4');
    expect(uniqueName('A.mp4', new Set(['A.mp4']))).toBe('A (2).mp4');
    expect(uniqueName('A.mp4', new Set(['A.mp4', 'A (2).mp4']))).toBe('A (3).mp4');
    expect(uniqueName('.hidden', new Set(['.hidden']))).toBe('.hidden (2)');
  });

  it('fades the start and the end in and out', () => {
    expect(fadeAt(0, 0, 60)).toBe(1);
    expect(fadeAt(2, 0, 60)).toBe(0);
    expect(fadeAt(2, 1, 60)).toBeCloseTo(0.5);
    expect(fadeAt(2, 30, 60)).toBe(1);
    expect(fadeAt(2, 59, 60)).toBeCloseTo(0.5);
    expect(fadeAt(2, 60, 60)).toBe(0);
  });
});
