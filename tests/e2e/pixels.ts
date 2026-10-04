import { expect, type Locator, type Page } from '@playwright/test';
import { createPng } from './png';

/** A part of a picture, in shares of its width and height from the top left. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionStats {
  /** The mean colour (0…255 per channel). */
  mean: [number, number, number];
  /** The share of near-white pixels (all channels above 200), as text is. */
  bright: number;
}

/** Decodes `png` (a screenshot or a frame) in the page and measures `regions` of it. */
export async function measure(page: Page, png: Buffer, regions: Region[]): Promise<RegionStats[]> {
  return page.evaluate(
    async ({ data, regions }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return regions.map((region) => {
        const x = Math.round(region.x * canvas.width);
        const y = Math.round(region.y * canvas.height);
        const width = Math.max(1, Math.round(region.width * canvas.width));
        const height = Math.max(1, Math.round(region.height * canvas.height));
        const pixels = context.getImageData(x, y, width, height).data;
        const sum = [0, 0, 0];
        let bright = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          for (let c = 0; c < 3; c++) sum[c]! += pixels[i + c]!;
          if (pixels[i]! > 200 && pixels[i + 1]! > 200 && pixels[i + 2]! > 200) bright++;
        }
        const count = pixels.length / 4;
        return {
          mean: sum.map((value) => value / count) as [number, number, number],
          bright: bright / count,
        };
      });
    },
    { data: png.toString('base64'), regions },
  );
}

/**
 * The frame of a video file at `seconds`, as a PNG, decoded by the page's video element; null
 * if this browser cannot play the file (an MP4 in a browser without H.264).
 */
export async function videoFrame(
  page: Page,
  data: Buffer,
  seconds: number,
): Promise<Buffer | null> {
  const url = await page.evaluate(
    async ({ bytes, seconds }) => {
      const binary = atob(bytes);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(new Blob([array]));
      const loaded = await new Promise<boolean>((resolve) => {
        video.onloadeddata = () => resolve(true);
        video.onerror = () => resolve(false);
      });
      if (!loaded) return null;
      video.currentTime = seconds;
      await new Promise((resolve) => (video.onseeked = resolve));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      URL.revokeObjectURL(video.src);
      return canvas.toDataURL('image/png');
    },
    { bytes: data.toString('base64'), seconds },
  );
  return url ? Buffer.from(url.split(',')[1]!, 'base64') : null;
}

/** A cover in four colours: yellow, green (top), red, dark blue (bottom). */
export const COVER = createPng(64, 64, (x, y) => [x < 32 ? 255 : 20, y < 32 ? 200 : 40, 60]);

/** Small squares in the four quarters of the logo, which sits in the middle of the stage. */
export function logoQuarters(box: { width: number; height: number }): Region[] {
  const short = Math.min(box.width, box.height);
  const at = (dx: number, dy: number): Region => ({
    x: 0.5 + (dx * short) / box.width - 0.005,
    y: 0.5 + (dy * short) / box.height - 0.005,
    width: 0.01,
    height: 0.01,
  });
  return [at(-0.06, -0.06), at(0.06, -0.06), at(-0.06, 0.06), at(0.06, 0.06)];
}

/** Whether the four quarters show the colours of {@link COVER}. */
export function showsCover(quarters: { mean: [number, number, number] }[]): boolean {
  const [yellow, green, red, dark] = quarters.map((quarter) => quarter.mean);
  return (
    yellow![0] > 170 &&
    yellow![1] > 130 &&
    green![0] < 110 &&
    green![1] > 130 &&
    red![0] > 170 &&
    red![1] < 110 &&
    dark![0] < 110 &&
    dark![1] < 110
  );
}

/**
 * Waits until the picture of `stage` changes: it moves. CI draws in software, at one or two
 * frames a second for the Kaleidoscope, so a fixed wait may see no new frame at all.
 */
export async function expectMotion(stage: Locator, timeout = 10_000): Promise<void> {
  const first = await stage.screenshot();
  await expect.poll(async () => first.equals(await stage.screenshot()), { timeout }).toBe(false);
}
