import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND } from '../audio/dsp/sound-settings';
import { newTrack, type Marks } from '../state/app-state';
import { exportPart, exportPlan } from './export-plan';
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from './video-format';

/** A track of `seconds` that can play, or one still being probed (null). */
function track(id: string, seconds: number | null, marks: Marks = { in: null, out: null }) {
  return {
    ...newTrack(id, { name: `${id}.wav`, size: 1 }),
    status: seconds === null ? ('probing' as const) : ('ready' as const),
    duration: seconds,
    marks,
  };
}

const QUEUE = [track('a', null), track('b', 60, { in: 10, out: 40 }), track('c', 30)];

function plan(options: Partial<ExportOptions>, currentId: string | null = null, skipped = []) {
  return exportPlan(
    { tracks: QUEUE, currentId },
    { ...DEFAULT_EXPORT_OPTIONS, ...options },
    new Set(skipped),
    DEFAULT_SOUND,
    (id) => (id === 'b' ? 1234 : 0),
  );
}

describe('what an export makes of the queue', () => {
  it('plays one track, the current one or the first that can play, between its markers', () => {
    const marked = plan({ range: 'marks' });
    expect(marked.track?.id).toBe('b');
    expect(marked).toMatchObject({ marked: true, range: 'marks', perTrack: false });
    expect(marked.parts).toMatchObject([
      { range: { start: 10, end: 40 }, cut: true, source: { name: 'b.wav', lastModified: 1234 } },
    ]);
    expect(marked.seconds).toBeCloseTo(30, 1);
    expect(marked.chapters).toEqual([]);

    const whole = plan({ range: 'track' });
    expect(whole.parts).toMatchObject([{ range: { start: 0, end: 60 }, cut: false }]);
    expect(whole.seconds).toBeCloseTo(60, 1);

    // A track without markers plays whole, also when its markers were chosen.
    const current = plan({ range: 'marks' }, 'c');
    expect(current).toMatchObject({ marked: false, range: 'track' });
    expect(current.chosen.map((entry) => entry.id)).toEqual(['c']);
  });

  it('plays tracks of the queue as one video with chapters, or a video of each', () => {
    const all = plan({ range: 'tracks' });
    expect(all.ready.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(all.chosen.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(all.parts.map((part) => part.range)).toEqual([
      { start: 10, end: 40 },
      { start: 0, end: 30 },
    ]);
    expect(all.seconds).toBeCloseTo(60, 1);
    expect(all.chapters.map((chapter) => chapter.title)).toEqual(['b', 'c']);
    expect(all.chapters[1]!.seconds).toBeCloseTo(30, 1);

    const each = plan({ range: 'tracks', perTrack: true });
    expect(each.perTrack).toBe(true);
    expect(each.chapters).toEqual([]);
    expect(each.seconds).toBeCloseTo(60, 1);

    // Without those left out; one track left has no chapters.
    const one = exportPlan(
      { tracks: QUEUE, currentId: null },
      { ...DEFAULT_EXPORT_OPTIONS, range: 'tracks' },
      new Set(['b']),
      DEFAULT_SOUND,
      () => 0,
    );
    expect(one.chosen.map((entry) => entry.id)).toEqual(['c']);
    expect(one.chapters).toEqual([]);
  });

  it('plays one track when the queue has only one that can play', () => {
    const single = exportPlan(
      { tracks: [track('x', 20)], currentId: null },
      { ...DEFAULT_EXPORT_OPTIONS, range: 'tracks' },
      new Set(),
      DEFAULT_SOUND,
      () => 0,
    );
    expect(single.range).toBe('track');
    expect(single.chosen.map((entry) => entry.id)).toEqual(['x']);
  });

  it('lasts as long as the music at the tempo of the sound, and can be only the sound', () => {
    const faster = exportPlan(
      { tracks: QUEUE, currentId: 'c' },
      { ...DEFAULT_EXPORT_OPTIONS, content: 'sound' },
      new Set(),
      { ...DEFAULT_SOUND, rate: 1.25 },
      () => 0,
    );
    expect(faster.soundOnly).toBe(true);
    expect(faster.seconds).toBeCloseTo(24, 1);
    expect(plan({}).soundOnly).toBe(false);
  });

  it('names a part by the track, as the user named it', () => {
    const named = { ...track('d', 10), edit: { title: 'Sunrise', artist: 'The Testers' } };
    expect(exportPart(named, false, 7).source).toEqual({
      name: 'd.wav',
      size: 1,
      lastModified: 7,
      title: 'Sunrise',
      artist: 'The Testers',
    });
  });
});
