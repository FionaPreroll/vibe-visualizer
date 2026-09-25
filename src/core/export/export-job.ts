import { F } from '../analysis/features';
import type { KaleidoSettings } from '../render/kaleido-settings';
import type { LogoSpectrumSettings } from '../render/visual-settings';
import type { VideoFormat } from './video-format';

/**
 * An export job and its plan. The export runs in two passes: the audio pass decodes the range,
 * analyses it and encodes the audio; the video pass renders frame n at time n / fps from the
 * stored analysis and encodes it in segments (EX-01, EX-15). A manifest in the Origin Private
 * File System records what is done, so an interrupted export can resume.
 */

/** The engine rate: the export hears exactly what the live engine would play. */
export const EXPORT_RATE = 48000;
/** The analysis starts this long before the range, so tempo and levels are settled (seconds). */
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

export type ExportVisuals =
  | { mode: 'logoSpectrum'; settings: LogoSpectrumSettings }
  | { mode: 'kaleidoscope'; settings: KaleidoSettings };

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

export interface ExportTiming {
  /** Video frames in the output. */
  frames: number;
  /** Frames rendered before the range (not encoded). */
  preRollFrames: number;
  /** Engine frame (48 kHz, from the start of the file) where the analysis starts. */
  analysisStart: number;
  /** Engine frame of the first output sample (the range start). */
  audioStart: number;
  /** Audio samples in the output: exactly the length of the video. */
  audioFrames: number;
  /** Analysis frames stored (hop by hop, from analysisStart). */
  analysisFrames: number;
  hop: number;
  segmentFrames: number;
  segments: number;
}

export interface ExportManifest {
  version: 1;
  /** Increases with every write (the manifest is written to two files in turn). */
  sequence: number;
  id: string;
  createdAt: string;
  source: ExportSource;
  /** Seconds in the source file. */
  range: { start: number; end: number };
  format: VideoFormat;
  codecs: ExportCodecs;
  visuals: ExportVisuals;
  /** Image files of the Logo Spectrum mode, stored with the job (their MIME types). */
  images: { background: string | null; logo: string | null };
  timing: ExportTiming;
  destination: 'file' | 'download';
  fileName: string;
  progress: {
    audioDone: boolean;
    segmentsDone: number;
    finished: boolean;
    /** Size of the finished file in bytes. */
    bytes: number | null;
  };
  resumeCount: number;
}

/** Plans frames, pre-rolls and segments for `range` (seconds) at `fps`. */
export function planTiming(
  range: { start: number; end: number },
  fps: number,
  hop: number,
  segmentSeconds = segmentSecondsFor(range.end - range.start),
): ExportTiming {
  const frames = Math.max(1, Math.round((range.end - range.start) * fps));
  const audioStart = Math.round(range.start * EXPORT_RATE);
  const audioFrames = Math.round((frames / fps) * EXPORT_RATE);
  const analysisStart = Math.round(Math.max(0, range.start - ANALYSIS_PRE_ROLL) * EXPORT_RATE);
  const preRollFrames = Math.round(Math.min(RENDER_PRE_ROLL, range.start) * fps);
  const segmentFrames = Math.max(1, Math.round(segmentSeconds * fps));
  // Analysis up to one hop past the last frame, so its values can be interpolated.
  const analysisFrames = Math.ceil((audioStart + audioFrames - analysisStart) / hop) + 1;
  return {
    frames,
    preRollFrames,
    analysisStart,
    audioStart,
    audioFrames,
    analysisFrames,
    hop,
    segmentFrames,
    segments: Math.ceil(frames / segmentFrames),
  };
}

/** The engine frame heard at video frame `n` (negative n: the pre-roll). */
export function frameTime(timing: ExportTiming, fps: number, n: number): number {
  return timing.audioStart + (n / fps) * EXPORT_RATE;
}

/** Engine frame at which analysis frame `index` was complete (hops count from analysisStart). */
export function analysisFrameTime(timing: ExportTiming, index: number): number {
  return timing.analysisStart + (index + 1) * timing.hop;
}

/**
 * A file name for the video: "Artist - Title (0m30s-1m00s).mp4", without characters that file
 * systems reject (colons among them). The range uses a plain hyphen: some systems fall back to
 * "download" for other characters in suggested names.
 */
export function exportFileName(
  source: Pick<ExportSource, 'title' | 'artist'>,
  range: { start: number; end: number } | null,
  extension: string,
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
  const clean = Array.from(`${base}${part}`, (char) =>
    char < ' ' || '\\/:*?"<>|'.includes(char) ? '_' : char,
  )
    .join('')
    .trim()
    .slice(0, 150);
  return `${clean || 'Vibe Visualizer'}.${extension}`;
}
