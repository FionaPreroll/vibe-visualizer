import { describe, expect, it } from 'vitest';
import {
  clockText,
  DEFAULT_OVERLAY,
  overlayAlpha,
  overlayProgress,
  overlayTime,
  sanitizeOverlay,
  type OverlayTrack,
} from './overlay-settings';

const track: OverlayTrack = { title: 'Song', artist: 'Artist', start: 30, end: 230 };

describe('track overlay (LS-18, LS-19)', () => {
  it('keeps valid settings and drops the rest', () => {
    expect(sanitizeOverlay(null)).toEqual(DEFAULT_OVERLAY);
    expect(
      sanitizeOverlay({
        on: true,
        font: 'serif',
        position: 'top-right',
        color: '#FFAA00',
        size: 9,
        fade: -1,
        hold: 12,
        progress: 'yes',
        time: true,
        extra: 1,
      }),
    ).toEqual({
      ...DEFAULT_OVERLAY,
      on: true,
      font: 'serif',
      position: 'top-right',
      color: '#FFAA00',
      size: 2,
      fade: 0,
      hold: 12,
      time: true,
    });
    expect(sanitizeOverlay({ font: 'comic', position: 'middle', color: 'red' })).toEqual(
      DEFAULT_OVERLAY,
    );
  });

  it('fades in at the start of the part and out before its end', () => {
    const settings = { ...DEFAULT_OVERLAY, on: true, fade: 2 };
    expect(overlayAlpha(settings, track, 10)).toBe(0);
    expect(overlayAlpha(settings, track, 30)).toBe(0);
    expect(overlayAlpha(settings, track, 31)).toBeCloseTo(0.5);
    expect(overlayAlpha(settings, track, 32)).toBe(1);
    // Kept for the whole track.
    expect(overlayAlpha(settings, track, 200)).toBe(1);
    expect(overlayAlpha(settings, track, 229)).toBeCloseTo(0.5);
    expect(overlayAlpha(settings, track, 230)).toBe(0);
    // Without a fade, it is there at once.
    expect(overlayAlpha({ ...settings, fade: 0 }, track, 30.01)).toBe(1);
  });

  it('fades out after the time it stays, counted at the tempo', () => {
    const settings = { ...DEFAULT_OVERLAY, on: true, fade: 1, hold: 10 };
    expect(overlayAlpha(settings, track, 40)).toBe(1);
    expect(overlayAlpha(settings, track, 41.5)).toBeCloseTo(0.5);
    expect(overlayAlpha(settings, track, 42)).toBe(0);
    // At 1.25 × the tempo, 12 s of the file pass in under 10 s.
    expect(overlayAlpha(settings, track, 42, 1.25)).toBe(1);
  });

  it('shows the progress and the time of the part as it is heard', () => {
    expect(overlayProgress(track, 130)).toBeCloseTo(0.5);
    expect(overlayProgress(track, 0)).toBe(0);
    expect(overlayProgress(track, 999)).toBe(1);
    expect(overlayTime(track, 113)).toBe('1:23 / 3:20');
    expect(overlayTime(track, 113, 2)).toBe('0:41 / 1:40');
    expect(clockText(7)).toBe('0:07');
    expect(clockText(187.9)).toBe('3:07');
    expect(clockText(3723)).toBe('1:02:03');
    expect(clockText(-3)).toBe('0:00');
  });
});
