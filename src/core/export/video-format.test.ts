import { describe, expect, it } from 'vitest';
import {
  avcCodecString,
  DEFAULT_EXPORT_OPTIONS,
  estimateBytes,
  fitOptions,
  frameSize,
  resolveFormat,
  sanitizeExportOptions,
  videoBitrate,
} from './video-format';

describe('video formats', () => {
  it('sizes every aspect ratio by its shorter side, in even pixels', () => {
    expect(frameSize('16:9', 1080)).toEqual([1920, 1080]);
    expect(frameSize('9:16', 1080)).toEqual([1080, 1920]);
    expect(frameSize('1:1', 1080)).toEqual([1080, 1080]);
    expect(frameSize('4:5', 1080)).toEqual([1080, 1350]);
    expect(frameSize('21:9', 1080)).toEqual([2520, 1080]);
    expect(frameSize('16:9', 2160)).toEqual([3840, 2160]);
    expect(frameSize('16:9', 720)).toEqual([1280, 720]);
  });

  it('resolves the platform presets (EX-03)', () => {
    const youtube = resolveFormat(DEFAULT_EXPORT_OPTIONS, '16:9');
    expect(youtube).toMatchObject({ aspect: '16:9', width: 1920, height: 1080, fps: 60 });
    expect(youtube.videoBitrate).toBe(12e6);
    const uhd = resolveFormat({ ...DEFAULT_EXPORT_OPTIONS, preset: 'youtube-4k30' }, '16:9');
    expect(uhd).toMatchObject({ width: 3840, height: 2160, fps: 30, videoBitrate: 40e6 });
    // A preset brings its own aspect ratio.
    const tiktok = resolveFormat({ ...DEFAULT_EXPORT_OPTIONS, preset: 'tiktok' }, '16:9');
    expect(tiktok).toMatchObject({ aspect: '9:16', width: 1080, height: 1920, fps: 30 });
  });

  it('builds custom formats from the stage aspect ratio', () => {
    const options = {
      ...DEFAULT_EXPORT_OPTIONS,
      preset: 'custom' as const,
      resolution: 1080 as const,
      fps: 25 as const,
    };
    expect(resolveFormat(options, '4:5')).toMatchObject({ width: 1080, height: 1350, fps: 25 });
  });

  it('scales bitrates with pixels, frame rate class and quality', () => {
    expect(videoBitrate(1920, 1080, 30, 'standard')).toBe(8e6);
    expect(videoBitrate(1920, 1080, 60, 'high')).toBe(18e6);
    // A square frame has 56 % of the pixels of 16:9.
    expect(videoBitrate(1080, 1080, 30, 'standard')).toBe(4.5e6);
    expect(videoBitrate(1080, 1920, 30, 'standard')).toBe(8e6);
  });

  it('estimates the file size from both bitrates', () => {
    const format = resolveFormat(DEFAULT_EXPORT_OPTIONS, '16:9');
    // One minute of 12 Mbps video and 320 kbps audio: about 92 MB.
    expect(estimateBytes(format, 60)).toBeCloseTo(92.4e6, -5);
  });

  it('picks the H.264 level each format needs', () => {
    expect(avcCodecString(1920, 1080, 60, 12e6)).toBe('avc1.64002A');
    expect(avcCodecString(3840, 2160, 30, 40e6)).toBe('avc1.640033');
    expect(avcCodecString(1080, 1920, 30, 8e6)).toBe('avc1.640028');
    expect(avcCodecString(1280, 720, 30, 5e6)).toBe('avc1.64001F');
    expect(avcCodecString(3840, 2160, 60, 60e6)).toBe('avc1.640034');
    // Bitrate alone can raise the level: 1080p30 at 30 Mbps exceeds level 4.0.
    expect(avcCodecString(1920, 1080, 30, 30e6)).toBe('avc1.640029');
  });

  it('keeps presets only where they fit the stage', () => {
    expect(fitOptions(DEFAULT_EXPORT_OPTIONS, '16:9').preset).toBe('youtube-1080p60');
    expect(fitOptions(DEFAULT_EXPORT_OPTIONS, '9:16').preset).toBe('tiktok');
    expect(fitOptions(DEFAULT_EXPORT_OPTIONS, '1:1').preset).toBe('custom');
  });

  it('sanitizes stored options', () => {
    expect(sanitizeExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(
      sanitizeExportOptions({ preset: 'tiktok', fps: 31, resolution: 2160, quality: 'best' }),
    ).toEqual({ ...DEFAULT_EXPORT_OPTIONS, preset: 'tiktok', resolution: 2160 });
  });
});
