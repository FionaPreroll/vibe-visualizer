import { afterEach, describe, expect, it } from 'vitest';
import { ASPECT_RATIOS } from '../core/export/video-format';
import { miniPlayerSize, supportsMiniPlayer } from './mini-player';

describe('the mini player (DS-06)', () => {
  afterEach(() => {
    delete (globalThis as { documentPictureInPicture?: unknown }).documentPictureInPicture;
  });

  it('asks for a window of 480 × 270 at 16:9, and as much room at the other ratios', () => {
    expect(miniPlayerSize('16:9')).toEqual({ width: 480, height: 270 });
    expect(miniPlayerSize('9:16')).toEqual({ width: 270, height: 480 });
    expect(miniPlayerSize('1:1')).toEqual({ width: 360, height: 360 });
    for (const { id, ratio } of ASPECT_RATIOS) {
      const { width, height } = miniPlayerSize(id);
      expect(width / height, id).toBeCloseTo(ratio, 1);
      expect(Math.abs(width * height - 480 * 270) / (480 * 270), id).toBeLessThan(0.01);
      expect([width % 2, height % 2], id).toEqual([0, 0]);
    }
  });

  it('is offered where the browser has picture-in-picture windows for pages', () => {
    expect(supportsMiniPlayer()).toBe(false);
    (globalThis as { documentPictureInPicture?: unknown }).documentPictureInPicture = {};
    expect(supportsMiniPlayer()).toBe(true);
  });
});
