import type { SoundSettings } from '../audio/dsp/sound-settings';
import { shownArtist, shownTitle, trackRange, type Track } from '../state/app-state';
import {
  partChapters,
  partLayout,
  partsSeconds,
  type Chapter,
  type ExportPart,
} from './export-job';
import type { ExportOptions } from './video-format';

/**
 * The part of `entry` a video plays: all of it, or the play range between its markers, as the
 * player plays it from the queue (TR-09). `lastModified` is its file's: with its name and size,
 * an interrupted export knows the file again.
 */
export function exportPart(entry: Track, useMarks: boolean, lastModified: number): ExportPart {
  const duration = entry.duration ?? 0;
  const range = trackRange(entry, useMarks) ?? { start: 0, end: duration };
  return {
    source: {
      name: entry.fileName,
      size: entry.size,
      lastModified,
      title: shownTitle(entry),
      artist: shownArtist(entry),
    },
    range,
    cut: range.end < duration,
    colors: entry.colors,
  };
}

/** What an export of the queue makes with the options chosen (#56). */
export interface ExportPlan {
  /** The track a video of one track plays: the current one, or else the first one ready. */
  track: Track | null;
  /** Whether that track has a marker. */
  marked: boolean;
  /** The tracks a video of several can play, in the order of the queue. */
  ready: Track[];
  /** What the video plays: the range chosen, where it is possible. */
  range: ExportOptions['range'];
  /** The tracks it plays. */
  chosen: Track[];
  /** The part of each of them. */
  parts: ExportPart[];
  /** A video of each track (EX-09), rather than one of them all. */
  perTrack: boolean;
  /** Only the sound, as a WAV file (EX-11): no video, so any visual mode will do. */
  soundOnly: boolean;
  /** Length of the video (of all of them, for a video of each): the parts at the tempo. */
  seconds: number;
  /** Where the tracks start in the video (EX-14). */
  chapters: Chapter[];
}

/**
 * What an export makes of the queue with `options` (fitted to the stage's aspect ratio):
 * one track, the part between its markers, or tracks of the queue (EX-05) without those
 * `skipped`, as one video or a video of each (EX-09); `lastModified` gives a track's file's.
 */
export function exportPlan(
  queue: { tracks: readonly Track[]; currentId: string | null },
  options: ExportOptions,
  skipped: ReadonlySet<string>,
  sound: SoundSettings,
  lastModified: (id: string) => number,
): ExportPlan {
  const { tracks, currentId } = queue;
  const track =
    tracks.find((entry) => entry.id === currentId && entry.status === 'ready') ??
    tracks.find((entry) => entry.status === 'ready') ??
    null;
  const marked = track !== null && (track.marks.in !== null || track.marks.out !== null);
  const ready = tracks.filter((entry) => entry.status === 'ready' && entry.duration !== null);
  const range =
    options.range === 'tracks' && ready.length > 1
      ? 'tracks'
      : options.range !== 'track' && marked
        ? 'marks'
        : 'track';
  const chosen =
    range === 'tracks' ? ready.filter((entry) => !skipped.has(entry.id)) : track ? [track] : [];
  const parts = chosen.map((entry) => exportPart(entry, range !== 'track', lastModified(entry.id)));
  const perTrack = range === 'tracks' && options.perTrack;
  const seconds = perTrack
    ? parts.reduce((sum, part) => sum + partsSeconds([part], sound), 0)
    : parts.length > 0
      ? partsSeconds(parts, sound)
      : 0;
  const chapters =
    range === 'tracks' && !perTrack && parts.length > 1
      ? partChapters(parts, { partStarts: partLayout(parts).starts }, sound)
      : [];
  return {
    track,
    marked,
    ready,
    range,
    chosen,
    parts,
    perTrack,
    soundOnly: options.content === 'sound',
    seconds,
    chapters,
  };
}
