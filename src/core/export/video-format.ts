/**
 * Video formats for the export (EX-03) and the stage (VE-09): aspect ratios, platform presets,
 * custom sizes and frame rates, bitrates by quality, the H.264 level a format needs, and the
 * estimated file size. Pure functions; the encoder support is checked at export time.
 */

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export const ASPECT_RATIOS: readonly {
  id: AspectRatio;
  /** Width divided by height. */
  ratio: number;
  hint: string;
}[] = [
  { id: '16:9', ratio: 16 / 9, hint: 'YouTube' },
  { id: '9:16', ratio: 9 / 16, hint: 'TikTok, Shorts, Reels' },
  { id: '1:1', ratio: 1, hint: 'Square' },
  { id: '4:5', ratio: 4 / 5, hint: 'Instagram feed' },
  { id: '21:9', ratio: 21 / 9, hint: 'Cinema' },
];

export const FRAME_RATES = [24, 25, 30, 50, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

/** Resolutions by their shorter side. */
export const RESOLUTIONS = [720, 1080, 1440, 2160] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type Quality = 'standard' | 'high' | 'maximum';
export const QUALITIES: readonly { id: Quality; label: string; factor: number }[] = [
  { id: 'standard', label: 'Standard', factor: 1 },
  { id: 'high', label: 'High', factor: 1.5 },
  { id: 'maximum', label: 'Maximum', factor: 2.5 },
];

export type PresetId = 'youtube-1080p60' | 'youtube-4k30' | 'tiktok';

export const EXPORT_PRESETS: readonly {
  id: PresetId;
  label: string;
  aspect: AspectRatio;
  resolution: Resolution;
  fps: FrameRate;
}[] = [
  { id: 'youtube-1080p60', label: 'YouTube 1080p60', aspect: '16:9', resolution: 1080, fps: 60 },
  { id: 'youtube-4k30', label: 'YouTube 4K30', aspect: '16:9', resolution: 2160, fps: 30 },
  { id: 'tiktok', label: 'TikTok / Shorts 1080×1920', aspect: '9:16', resolution: 1080, fps: 30 },
];

/** What the export dialog remembers. */
export interface ExportOptions {
  preset: PresetId | 'custom';
  /** Custom format; its aspect ratio is the stage's. */
  resolution: Resolution;
  fps: FrameRate;
  quality: Quality;
  /** Whole track, or the in/out range when both markers are set (TR-09). */
  range: 'track' | 'marks';
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  preset: 'youtube-1080p60',
  resolution: 1080,
  fps: 60,
  quality: 'standard',
  range: 'marks',
};

/** A concrete video format. */
export interface VideoFormat {
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: FrameRate;
  /** Bits per second. */
  videoBitrate: number;
  audioBitrate: number;
}

export const AUDIO_BITRATE = 320_000;

export function aspectRatio(aspect: AspectRatio): number {
  return ASPECT_RATIOS.find((entry) => entry.id === aspect)!.ratio;
}

/** Frame size for `aspect` whose shorter side is `resolution`, rounded to even numbers. */
export function frameSize(aspect: AspectRatio, resolution: number): [number, number] {
  const ratio = aspectRatio(aspect);
  const even = (value: number) => Math.max(2, 2 * Math.round(value / 2));
  return ratio >= 1
    ? [even(resolution * ratio), even(resolution)]
    : [even(resolution), even(resolution / ratio)];
}

/**
 * YouTube's recommended upload bitrates for 16:9 (SDR), in Mbps, by the shorter side, for up to
 * 30 and for 50/60 frames per second.
 */
const RECOMMENDED_MBPS: Record<Resolution, [number, number]> = {
  720: [5, 7.5],
  1080: [8, 12],
  1440: [16, 24],
  2160: [40, 60],
};

/** Video bitrate for a format: the recommendation scaled by its pixel count and the quality. */
export function videoBitrate(
  width: number,
  height: number,
  fps: FrameRate,
  quality: Quality,
): number {
  const short = Math.min(width, height);
  const resolution =
    RESOLUTIONS.find((value) => value >= short) ?? RESOLUTIONS[RESOLUTIONS.length - 1]!;
  const [mbps30, mbps60] = RECOMMENDED_MBPS[resolution];
  const base = fps > 30 ? mbps60 : mbps30;
  // Relative to the 16:9 frame with the same shorter side.
  const [refWidth, refHeight] = frameSize('16:9', resolution);
  const pixels = (width * height) / (refWidth * refHeight);
  const factor = QUALITIES.find((entry) => entry.id === quality)!.factor;
  return Math.round(base * pixels * factor * 1e6);
}

/** The format an export with `options` produces, on a stage with aspect ratio `aspect`. */
export function resolveFormat(options: ExportOptions, aspect: AspectRatio): VideoFormat {
  const preset = EXPORT_PRESETS.find((entry) => entry.id === options.preset);
  const formatAspect = preset?.aspect ?? aspect;
  const fps = preset?.fps ?? options.fps;
  const [width, height] = frameSize(formatAspect, preset?.resolution ?? options.resolution);
  return {
    aspect: formatAspect,
    width,
    height,
    fps,
    videoBitrate: videoBitrate(width, height, fps, options.quality),
    audioBitrate: AUDIO_BITRATE,
  };
}

/**
 * The options to show for a stage with aspect ratio `aspect`: a preset only fits its own
 * aspect ratio, so another one falls back to a fitting preset or to the custom format.
 */
export function fitOptions(options: ExportOptions, aspect: AspectRatio): ExportOptions {
  const preset = EXPORT_PRESETS.find((entry) => entry.id === options.preset);
  if (!preset || preset.aspect === aspect) return options;
  const fitting = EXPORT_PRESETS.find((entry) => entry.aspect === aspect);
  return { ...options, preset: fitting?.id ?? 'custom' };
}

/** Estimated file size in bytes. */
export function estimateBytes(format: VideoFormat, seconds: number): number {
  return ((format.videoBitrate + format.audioBitrate) * seconds) / 8;
}

/**
 * H.264 High profile codec string with the lowest level that allows the frame size, macroblock
 * rate and bitrate (ITU-T H.264 table A-1; High profile allows 1.25 × the listed bitrate).
 * 1080p60 needs level 4.2, which encoders do not pick by themselves.
 */
export function avcCodecString(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = macroblocks * fps;
  const kbps = bitrate / 1000;
  const levels: [number, number, number, number][] = [
    // level_idc, max macroblocks per second, max frame size in macroblocks, max kbit/s (Main)
    [30, 40500, 1620, 10000],
    [31, 108000, 3600, 14000],
    [32, 216000, 5120, 20000],
    [40, 245760, 8192, 20000],
    [41, 245760, 8192, 50000],
    [42, 522240, 8704, 50000],
    [50, 589824, 22080, 135000],
    [51, 983040, 36864, 240000],
    [52, 2073600, 36864, 240000],
    [60, 4177920, 139264, 240000],
    [61, 8355840, 139264, 480000],
    [62, 16711680, 139264, 800000],
  ];
  const level =
    levels.find(
      ([, maxRate, maxFrame, maxKbps]) =>
        rate <= maxRate && macroblocks <= maxFrame && kbps <= maxKbps * 1.25,
    )?.[0] ?? 62;
  return `avc1.6400${level.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Valid export options from whatever is stored. */
export function sanitizeExportOptions(value: unknown): ExportOptions {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const pick = <T>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(candidate as T) ? (candidate as T) : fallback;
  return {
    preset: pick(
      input['preset'],
      [...EXPORT_PRESETS.map((entry) => entry.id), 'custom'] as const,
      DEFAULT_EXPORT_OPTIONS.preset,
    ),
    resolution: pick(input['resolution'], RESOLUTIONS, DEFAULT_EXPORT_OPTIONS.resolution),
    fps: pick(input['fps'], FRAME_RATES, DEFAULT_EXPORT_OPTIONS.fps),
    quality: pick(
      input['quality'],
      QUALITIES.map((entry) => entry.id),
      DEFAULT_EXPORT_OPTIONS.quality,
    ),
    range: pick(input['range'], ['track', 'marks'] as const, DEFAULT_EXPORT_OPTIONS.range),
  };
}

export function isAspectRatio(value: unknown): value is AspectRatio {
  return ASPECT_RATIOS.some((entry) => entry.id === value);
}
