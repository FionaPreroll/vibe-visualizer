import { F } from '../analysis/features';
import type { TrackLoudness } from '../analysis/track-loudness';
import { LIMITER_LOOKAHEAD } from '../audio/dsp/limiter';
import {
  DEFAULT_SOUND,
  isClean,
  SOUND_PRESETS,
  type SoundSettings,
} from '../audio/dsp/sound-settings';
import { CROSSFADE_SECONDS } from '../audio/stream-joiner';
import type { TrackColors } from '../render/cover-palette';
import type { KaleidoSettings } from '../render/kaleido-settings';
import { clockText, type OverlaySettings, type OverlayTrack } from '../render/overlay-settings';
import type { AutoPresets } from '../render/preset-director';
import type { LogoSpectrumSettings } from '../render/visual-settings';
import type { VideoFormat } from './video-format';

/**
 * An export job and its plan. A video plays one track or several (EX-05), each a part of its
 * file, joined as the player joins the queue. The export runs in two passes: the audio pass
 * decodes the parts, plays them through the sound chain (tempo and effects, EX-02), analyses
 * them and encodes the sound; the video pass renders frame n at time n / fps from the stored
 * analysis and encodes it in segments (EX-01, EX-15). A manifest in the Origin Private File
 * System records what is done, so an interrupted export can resume.
 *
 * Times are counted in output frames (48 kHz) from the start of the processed stream, which
 * begins at `sourceStart` in the first file. The stream joins the parts; its own frames (stream
 * frames, before the tempo) count from there too. With a tempo change, output frame o plays
 * stream frame o × rate; the effects delay what is heard by the limiter's look-ahead.
 */

/** The engine rate: the export hears exactly what the live engine would play. */
export const EXPORT_RATE = 48000;
/** The analysis starts this long before the range, so tempo and levels are settled (output seconds). */
export const ANALYSIS_PRE_ROLL = 10;
/** Frames rendered (not encoded) before the range, so trails and motion are already running. */
export const RENDER_PRE_ROLL = 3;
/** Longest video segment; an interruption loses at most one (seconds). */
export const SEGMENT_SECONDS = 300;

/**
 * Segment length for an export of `seconds`: at most five minutes, and at least three segments
 * (of at least 2 s), so that short clips can resume part-way too.
 */
export function segmentSecondsFor(seconds: number): number {
  return Math.min(SEGMENT_SECONDS, Math.max(2, seconds / 3));
}
/** Analysis values stored per frame: everything but the waveform, which no scene uses. */
export const FEATURE_FIELDS = F.waveform;
/** Name of the finished file in browser storage, when it is downloaded at the end. */
export const OUTPUT_FILE = 'output';
export const CANCELLED = 'The export was cancelled.';

/**
 * The visuals of the video: a mode, its settings (at the start), the automatic preset
 * switching (PR-02) with the presets that take part if it is on, reduce flashing (VE-06), and
 * the track overlay (LS-18, LS-19).
 */
export type ExportVisuals = (
  | {
      mode: 'logoSpectrum';
      settings: LogoSpectrumSettings;
      auto?: ExportSwitching<LogoSpectrumSettings>;
      /** The Kaleidoscope behind, when a look of the video shows it (VE-08). */
      layer?: KaleidoSettings;
    }
  | { mode: 'kaleidoscope'; settings: KaleidoSettings; auto?: ExportSwitching<KaleidoSettings> }
) & {
  reduceFlashing?: boolean;
  /** The track overlay over the video (LS-18, LS-19); it names each part. */
  overlay?: OverlaySettings;
  /**
   * The Logo Spectrum shows each part's cover art as its logo (LS-15); not given (a job of
   * before VE-12): when the job has covers.
   */
  coverLogo?: boolean;
  /** The colours come from each part's cover art (VE-12). */
  coverColors?: boolean;
};

export interface ExportSwitching<S> {
  config: AutoPresets;
  presets: S[];
}

export interface ExportCodecs {
  video: 'avc' | 'vp9';
  /** Full codec string for H.264 (the level); null lets the encoder choose. */
  videoCodecString: string | null;
  audio: 'aac' | 'opus';
  container: 'mp4' | 'webm';
  /** Where AAC comes from: the browser, or the bundled WebAssembly encoder. */
  aacEncoder: 'native' | 'wasm' | null;
}

export interface ExportSource {
  name: string;
  size: number;
  lastModified: number;
  title: string;
  artist: string | null;
}

/** A track of the video: the part of its file that plays (EX-05). */
export interface ExportPart {
  source: ExportSource;
  /** Seconds in the file. */
  range: { start: number; end: number };
  /** The part stops at an out marker, before the end of its file: it crosses into what follows. */
  cut: boolean;
  /** How loud its file gets, if it has been analysed: the analysis's auto-gain stays above it. */
  loudness?: TrackLoudness | null;
  /** The colours the user gave its track (VE-12); not given: its cover's, as found. */
  colors?: TrackColors | null;
}

export interface ExportTiming {
  /** Video frames in the output. */
  frames: number;
  /** Frames rendered before the range (not encoded). */
  preRollFrames: number;
  /** Source frame (48 kHz, from the start of the file) where the processed stream starts. */
  sourceStart: number;
  /** Output frame at which the first analysed frame is heard (the effects' delay). */
  analysisStart: number;
  /** Output frame of the first encoded sample (the range start). */
  audioStart: number;
  /** Audio samples in the output: exactly the length of the video. */
  audioFrames: number;
  /** Analysis frames stored (hop by hop, from analysisStart). */
  analysisFrames: number;
  hop: number;
  segmentFrames: number;
  segments: number;
  /**
   * Stream frame at which each part's range starts (the first after its pre-roll): planned from
   * the parts' lengths, then as the audio pass found it.
   */
  partStarts: number[];
}

export interface ExportManifest {
  version: 3;
  /** Increases with every write (the manifest is written to two files in turn). */
  sequence: number;
  id: string;
  createdAt: string;
  /** The tracks of the video in order, one for a single track (EX-05). */
  parts: ExportPart[];
  format: VideoFormat;
  codecs: ExportCodecs;
  visuals: ExportVisuals;
  /** Tempo and effects of the audio (EX-02). */
  sound: SoundSettings;
  /** Seconds the picture and the sound fade in at the start and out at the end (EX-16). */
  fade: number;
  /**
   * Image files of the Logo Spectrum mode, stored with the job (their MIME types), and the cover
   * art of each part, shown as the logo (LS-15) or giving the colours (VE-12).
   */
  images: { background: string | null; logo: string | null; covers: (string | null)[] };
  timing: ExportTiming;
  destination: 'file' | 'download';
  fileName: string;
  /**
   * A video of a batch that is downloaded (EX-09) goes to this file among the batch's videos in
   * browser storage, not to the job's own output file.
   */
  output?: string | null;
  progress: {
    audioDone: boolean;
    segmentsDone: number;
    finished: boolean;
    /** Size of the finished file in bytes. */
    bytes: number | null;
  };
  resumeCount: number;
  /** Only the sound, as a WAV file (EX-11): no video pass. */
  soundOnly?: boolean;
}

/** The image files an export job keeps for the Logo Spectrum: its background and logo. */
export const JOB_IMAGES = ['background', 'logo'] as const;
export type JobImage = (typeof JOB_IMAGES)[number];

/** The file of a part's cover art in the job (the first has the name of a single track's). */
export function coverFile(index: number): string {
  return index === 0 ? 'image-cover' : `image-cover-${index}`;
}

/** The file of a part's beat grid in the job (the first has the name of a single track's). */
export function gridFile(index: number): string {
  return index === 0 ? 'beat-grid.bin' : `beat-grid-${index}.bin`;
}

/** Length of the video for `range` (source seconds) played at the tempo of `sound`. */
export function exportSeconds(range: { start: number; end: number }, sound: SoundSettings): number {
  return (range.end - range.start) / sound.rate;
}

/** Frames of the crossfade where a part stops at an out marker. */
const CROSSFADE_FRAMES = Math.max(1, Math.round(CROSSFADE_SECONDS * EXPORT_RATE));

/**
 * Where each part's range starts in the joined music, counted from the start of the first
 * part's range (48 kHz frames), and the length of it all: a part that stops at an out marker
 * crosses its last frames into what follows, as in the player.
 */
export function partLayout(parts: readonly ExportPart[]): { starts: number[]; length: number } {
  const starts: number[] = [];
  let at = 0;
  parts.forEach((part, index) => {
    starts.push(at);
    at += Math.max(0, Math.round((part.range.end - part.range.start) * EXPORT_RATE));
    if (part.cut && index + 1 < parts.length) at -= CROSSFADE_FRAMES;
  });
  return { starts, length: at };
}

/** Seconds of video for `parts` played at the tempo of `sound`. */
export function partsSeconds(parts: readonly ExportPart[], sound: SoundSettings): number {
  return partLayout(parts).length / EXPORT_RATE / sound.rate;
}

/**
 * Plans frames, pre-rolls and segments for a video of `parts` at `fps`: as for one range of
 * the first file that is as long as all of them, and where each part starts.
 */
export function planParts(
  parts: readonly ExportPart[],
  fps: number,
  hop: number,
  sound: SoundSettings = DEFAULT_SOUND,
  segmentSeconds?: number,
): ExportTiming {
  const { starts, length } = partLayout(parts);
  const first = parts[0]!.range.start;
  const range = { start: first, end: first + length / EXPORT_RATE };
  const timing = planTiming(range, fps, hop, sound, segmentSeconds);
  // The stream starts with the pre-roll before the first range.
  const lead = Math.round(first * EXPORT_RATE) - timing.sourceStart;
  return { ...timing, partStarts: starts.map((start) => start + lead) };
}

/**
 * The part heard at video frame `n`, the second of its file heard then, and how long the part
 * has been heard (seconds of the video; for the first part, since the stream began).
 */
export function partAt(
  manifest: Pick<ExportManifest, 'parts' | 'timing' | 'sound'>,
  fps: number,
  n: number,
): { index: number; seconds: number; since: number } {
  const { parts, timing, sound } = manifest;
  // What is heard left the sound chain the effects' delay earlier.
  const stream = (frameTime(timing, fps, n) - timing.analysisStart) * sound.rate;
  const starts = timing.partStarts;
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1]! <= stream) index++;
  // The first part plays from where the stream starts, the others from their range.
  const from =
    index === 0 ? timing.sourceStart : Math.round(parts[index]!.range.start * EXPORT_RATE);
  const offset = index === 0 ? stream : stream - starts[index]!;
  return {
    index,
    seconds: (from + offset) / EXPORT_RATE,
    since: offset / EXPORT_RATE / sound.rate,
  };
}

/** The track overlay's view of `part` (LS-18): its names and its range. */
export function partTrack(part: ExportPart): OverlayTrack {
  return { title: part.source.title, artist: part.source.artist, ...part.range };
}

/** A chapter of a video of several tracks (EX-14). */
export interface Chapter {
  /** Where it starts in the video. */
  seconds: number;
  title: string;
}

/** The chapters of a video: where each part starts in it, named after its track (EX-14). */
export function partChapters(
  parts: readonly ExportPart[],
  timing: Pick<ExportTiming, 'partStarts'>,
  sound: SoundSettings,
): Chapter[] {
  const lead = timing.partStarts[0] ?? 0;
  return parts.map((part, index) => ({
    seconds: ((timing.partStarts[index] ?? lead) - lead) / EXPORT_RATE / sound.rate,
    title: part.source.artist ? `${part.source.artist} – ${part.source.title}` : part.source.title,
  }));
}

/**
 * The chapters as YouTube reads them from a description: "0:00 Artist – Title" per line, at the
 * nearest second.
 */
export function chapterText(chapters: readonly Chapter[]): string {
  return chapters
    .map((chapter) => `${clockText(Math.round(chapter.seconds))} ${chapter.title}`)
    .join('\n');
}

/** Shortest chapter YouTube shows, and the fewest chapters (seconds, count). */
export const CHAPTER_MIN_SECONDS = 10;
export const CHAPTER_MIN_COUNT = 3;

/** Why YouTube would not show these chapters of a video of `seconds`; null when it would. */
export function chapterProblem(chapters: readonly Chapter[], seconds: number): string | null {
  if (chapters.length < CHAPTER_MIN_COUNT) {
    return `YouTube shows chapters only for ${CHAPTER_MIN_COUNT} tracks or more.`;
  }
  const short = chapters.find((chapter, index) => {
    const end = chapters[index + 1]?.seconds ?? seconds;
    return end - chapter.seconds < CHAPTER_MIN_SECONDS;
  });
  return short
    ? `YouTube shows chapters only if each is at least ${CHAPTER_MIN_SECONDS} s long; “${short.title}” is shorter.`
    : null;
}

/**
 * How much of the picture and the sound shows `seconds` into a video of `total` seconds that
 * fades in and out over `fade` seconds (0…1).
 */
export function fadeAt(fade: number, seconds: number, total: number): number {
  if (fade <= 0) return 1;
  const t = Math.min(1, Math.max(0, Math.min(seconds, total - seconds) / fade));
  return t * t * (3 - 2 * t);
}

/** Plans frames, pre-rolls and segments for `range` (source seconds) at `fps`. */
export function planTiming(
  range: { start: number; end: number },
  fps: number,
  hop: number,
  sound: SoundSettings = DEFAULT_SOUND,
  segmentSeconds = segmentSecondsFor(exportSeconds(range, sound)),
): ExportTiming {
  const rate = sound.rate;
  const frames = Math.max(1, Math.round(exportSeconds(range, sound) * fps));
  // The stream starts ANALYSIS_PRE_ROLL output seconds before the range (or at the file start).
  const sourceStart = Math.round(Math.max(0, range.start - ANALYSIS_PRE_ROLL * rate) * EXPORT_RATE);
  const analysisStart = LIMITER_LOOKAHEAD;
  const lead = (range.start * EXPORT_RATE - sourceStart) / rate;
  const audioStart = Math.round(lead) + analysisStart;
  const audioFrames = Math.round((frames / fps) * EXPORT_RATE);
  const preRollFrames = Math.round(Math.min(RENDER_PRE_ROLL, lead / EXPORT_RATE) * fps);
  const segmentFrames = Math.max(1, Math.round(segmentSeconds * fps));
  // Analysis up to one hop past the last frame, so its values can be interpolated.
  const analysisFrames = Math.ceil((audioStart + audioFrames - analysisStart) / hop) + 1;
  return {
    frames,
    preRollFrames,
    sourceStart,
    analysisStart,
    audioStart,
    audioFrames,
    analysisFrames,
    hop,
    segmentFrames,
    segments: Math.ceil(frames / segmentFrames),
    partStarts: [Math.round(range.start * EXPORT_RATE) - sourceStart],
  };
}

/** A manifest of version 2: one track (`source`, `range`), perhaps its cover. */
interface ManifestV2 extends Omit<ExportManifest, 'version' | 'parts' | 'fade' | 'images'> {
  version: 2;
  source: ExportSource;
  range: { start: number; end: number };
  images: { background: string | null; logo: string | null; cover?: string | null };
}

/**
 * A manifest of this version, from a stored one. Exports started before tempo and effects
 * (version 1) counted from the start of the file and played the sound unchanged; those of one
 * track (version 2) had its source and range instead of parts, and played it to its end.
 */
export function upgradeManifest(stored: unknown): ExportManifest | null {
  let manifest = stored as ExportManifest | ManifestV2 | { version: 1; timing: ExportTiming };
  if (!manifest || typeof manifest !== 'object') return null;
  if (manifest.version === 1) {
    const timing = manifest.timing;
    manifest = {
      ...(manifest as unknown as ManifestV2),
      version: 2,
      sound: DEFAULT_SOUND,
      timing: {
        ...timing,
        sourceStart: timing.analysisStart,
        analysisStart: 0,
        audioStart: timing.audioStart - timing.analysisStart,
      },
    };
  }
  if (manifest.version === 2) {
    const { source, range, images, timing, visuals, ...rest } = manifest;
    // The overlay of a single track named it by itself.
    const overlay = visuals.overlay as { settings?: OverlaySettings } | OverlaySettings | undefined;
    const settings = overlay && 'settings' in overlay ? overlay.settings : overlay;
    manifest = {
      ...rest,
      version: 3,
      parts: [{ source, range, cut: false }],
      fade: 0,
      visuals: { ...visuals, overlay: settings as OverlaySettings | undefined },
      images: { background: images.background, logo: images.logo, covers: [images.cover ?? null] },
      timing: {
        ...timing,
        partStarts: [Math.round(range.start * EXPORT_RATE) - timing.sourceStart],
      },
    };
  }
  return manifest.version === 3 ? manifest : null;
}

/** The output frame heard at video frame `n` (negative n: the pre-roll). */
export function frameTime(timing: ExportTiming, fps: number, n: number): number {
  return timing.audioStart + (n / fps) * EXPORT_RATE;
}

/** Output frame at which analysis frame `index` is heard (hops count from analysisStart). */
export function analysisFrameTime(timing: ExportTiming, index: number): number {
  return timing.analysisStart + (index + 1) * timing.hop;
}

/**
 * A file name for the video: "Artist - Title (0m30s-1m00s).mp4", with the sound preset if one
 * is used ("… (Slowed + Reverb).mp4"), without characters that file systems reject (colons
 * among them). The range uses a plain hyphen: some systems fall back to "download" for other
 * characters in suggested names.
 */
export function exportFileName(
  source: Pick<ExportSource, 'title' | 'artist'>,
  range: { start: number; end: number } | null,
  extension: string,
  sound: SoundSettings = DEFAULT_SOUND,
): string {
  const clock = (seconds: number) => {
    const whole = Math.floor(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const ss = `${String(whole % 60).padStart(2, '0')}s`;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}m${ss}` : `${m}m${ss}`;
  };
  const base = source.artist ? `${source.artist} - ${source.title}` : source.title;
  const part = range ? ` (${clock(range.start)}-${clock(range.end)})` : '';
  const preset = isClean(sound)
    ? undefined
    : SOUND_PRESETS.find((entry) =>
        (Object.keys(sound) as (keyof SoundSettings)[]).every(
          (key) => entry.settings[key] === sound[key],
        ),
      );
  const edit = preset ? ` (${preset.name})` : '';
  const clean = Array.from(`${base}${part}${edit}`, (char) =>
    char < ' ' || '\\/:*?"<>|'.includes(char) ? '_' : char,
  )
    .join('')
    .trim()
    .slice(0, 150);
  return `${clean || 'Video'}.${extension}`;
}

/**
 * The file name for a video of `parts`: that of its track for one (with its range if it is not
 * all of it), "Artist - Title and 2 more" after the first for several (EX-05).
 */
export function videoFileName(
  parts: readonly ExportPart[],
  extension: string,
  sound: SoundSettings = DEFAULT_SOUND,
): string {
  const first = parts[0]!;
  if (parts.length === 1) {
    const whole = first.range.start <= 0 && !first.cut;
    return exportFileName(first.source, whole ? null : first.range, extension, sound);
  }
  const title = `${first.source.title} and ${parts.length - 1} more`;
  return exportFileName({ title, artist: first.source.artist }, null, extension, sound);
}

/** Whether an export's file is only the sound (EX-11), a WAV. */
export function isSoundFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.wav');
}

/** `name`, or "name (2).ext" and so on, whichever is not in `taken` yet (EX-09). */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let number = 2; taken.has(candidate); number++) {
    candidate = `${base} (${number})${extension}`;
  }
  return candidate;
}
