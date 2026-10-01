import { F } from '../analysis/features';
import { LIMITER_LOOKAHEAD } from '../audio/dsp/limiter';
import {
  DEFAULT_SOUND,
  isClean,
  SOUND_PRESETS,
  type SoundSettings,
} from '../audio/dsp/sound-settings';
import type { KaleidoSettings } from '../render/kaleido-settings';
import type { AutoPresets } from '../render/preset-director';
import type { LogoSpectrumSettings } from '../render/visual-settings';
import type { VideoFormat } from './video-format';

/**
 * An export job and its plan. The export runs in two passes: the audio pass decodes the range,
 * plays it through the sound chain (tempo and effects, EX-02), analyses it and encodes it; the
 * video pass renders frame n at time n / fps from the stored analysis and encodes it in segments
 * (EX-01, EX-15). A manifest in the Origin Private File System records what is done, so an
 * interrupted export can resume.
 *
 * Times are counted in output frames (48 kHz) from the start of the processed stream, which
 * begins at `sourceStart` in the file. With a tempo change, output frame o plays source frame
 * sourceStart + o × rate; the effects delay what is heard by the limiter's look-ahead.
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
 * The visuals of the video: a mode, its settings (at the start), and the automatic preset
 * switching (PR-02) with the presets that take part, if it is on.
 */
export type ExportVisuals =
  | {
      mode: 'logoSpectrum';
      settings: LogoSpectrumSettings;
      auto?: ExportSwitching<LogoSpectrumSettings>;
    }
  | { mode: 'kaleidoscope'; settings: KaleidoSettings; auto?: ExportSwitching<KaleidoSettings> };

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
}

export interface ExportManifest {
  version: 2;
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
  /** Tempo and effects of the audio (EX-02). */
  sound: SoundSettings;
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

/** Length of the video for `range` (source seconds) played at the tempo of `sound`. */
export function exportSeconds(range: { start: number; end: number }, sound: SoundSettings): number {
  return (range.end - range.start) / sound.rate;
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
  };
}

/**
 * A manifest of this version, from a stored one: exports started before tempo and effects
 * (version 1) counted from the start of the file and played the sound unchanged.
 */
export function upgradeManifest(stored: unknown): ExportManifest | null {
  const manifest = stored as ExportManifest | { version: 1; timing: ExportTiming } | null;
  if (!manifest || typeof manifest !== 'object') return null;
  if (manifest.version === 2) return manifest;
  if (manifest.version !== 1) return null;
  const timing = manifest.timing;
  return {
    ...(manifest as unknown as ExportManifest),
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
