import { describe, expect, it } from 'vitest';
import {
  coverBlend,
  lchHex,
  oklab,
  paletteFromPixels,
  partColors,
  type CoverPalette,
} from './cover-palette';
import { parseColor } from './visual-settings';

/** RGBA pixels: `share` of them in each colour, in order. */
function cover(...parts: { color: [number, number, number]; share: number }[]): Uint8ClampedArray {
  const count = 1600;
  const pixels = new Uint8ClampedArray(count * 4);
  let i = 0;
  for (const { color, share } of parts) {
    for (let n = 0; n < Math.round(share * count) && i < count; n++, i++) {
      pixels.set([...color, 255], i * 4);
    }
  }
  return pixels;
}

/** Lightness, chroma and hue (degrees) of a '#rrggbb' colour in OKLab. */
function lch(color: string): { L: number; C: number; h: number } {
  const [L, a, b] = oklab(...parseColor(color));
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const hueOf = (color: [number, number, number]) =>
  lch(`#${color.map((c) => c.toString(16).padStart(2, '0')).join('')}`).h;
const near = (a: number, b: number, within: number) =>
  Math.abs(((a - b + 540) % 360) - 180) <= within;

const BLUE: [number, number, number] = [20, 40, 200];
const ORANGE: [number, number, number] = [255, 140, 20];

describe('colours from the cover art (VE-12)', () => {
  it('turns OKLab back into the same sRGB colour', () => {
    for (const color of ['#ff8c14', '#1428c8', '#808080', '#000000', '#ffffff']) {
      const { L, C, h } = lch(color);
      expect(lchHex(L, C, (h * Math.PI) / 180)).toBe(color);
    }
    // Beyond sRGB, the chroma gives way: the colour stays in range, with its lightness.
    const vivid = lchHex(0.9, 0.4, 2);
    expect(vivid).toMatch(/^#[0-9a-f]{6}$/);
    expect(lch(vivid).L).toBeCloseTo(0.9, 1);
  });

  it('builds a gradient, dark to bright, and layers from the main colours of a cover', () => {
    const palette = paletteFromPixels(
      cover({ color: BLUE, share: 0.7 }, { color: ORANGE, share: 0.3 }),
    )!;
    expect(palette.gradient).toHaveLength(5);
    expect(palette.layers).toHaveLength(8);
    const stops = palette.gradient.map(lch);
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.L).toBeGreaterThan(stops[i - 1]!.L);
    expect(stops[0]!.L).toBeLessThan(0.2);
    expect(stops[4]!.L).toBeGreaterThan(0.9);
    // The middle is the cover's blue, then its orange.
    expect(near(stops[2]!.h, hueOf(BLUE), 15)).toBe(true);
    expect(near(stops[3]!.h, hueOf(ORANGE), 15)).toBe(true);
    // The layers take both in turn, colourful, darker towards the back.
    const layers = palette.layers.map(lch);
    expect(near(layers[0]!.h, hueOf(BLUE), 15)).toBe(true);
    expect(near(layers[1]!.h, hueOf(ORANGE), 15)).toBe(true);
    expect(layers[7]!.L).toBeLessThan(layers[0]!.L);
    for (const layer of layers) expect(layer.C).toBeGreaterThan(0.07);
  });

  it('finds a small bright patch on grey, and gives a grey cover greys', () => {
    const red: [number, number, number] = [230, 30, 40];
    const patch = paletteFromPixels(
      cover(
        { color: [40, 40, 40], share: 0.6 },
        { color: [200, 200, 200], share: 0.34 },
        {
          color: red,
          share: 0.06,
        },
      ),
    )!;
    expect(near(lch(patch.gradient[2]!).h, hueOf(red), 15)).toBe(true);
    const grey = paletteFromPixels(
      cover({ color: [30, 30, 30], share: 0.5 }, { color: [220, 220, 220], share: 0.5 }),
    )!;
    for (const color of [...grey.gradient, ...grey.layers]) expect(lch(color).C).toBeLessThan(0.01);
  });

  it('gives the same colours for the same picture, and none without pixels', () => {
    const pixels = cover({ color: ORANGE, share: 0.5 }, { color: BLUE, share: 0.5 });
    expect(paletteFromPixels(pixels)).toEqual(paletteFromPixels(pixels.slice()));
    expect(paletteFromPixels(new Uint8ClampedArray(64))).toBeNull();
  });

  it("blends from one cover's colours to the next, or to the look's own", () => {
    const a: CoverPalette = { layers: ['#000000'], gradient: ['#ff0000'] };
    const b: CoverPalette = { layers: ['#ffffff'], gradient: ['#0000ff'] };
    const look = ['#00ff00'];
    const layers = (palette: CoverPalette) => palette.layers;
    expect(coverBlend(null, look, layers)).toBe(look);
    expect(coverBlend({ from: a, to: b, blend: 0 }, look, layers)).toEqual(['#000000']);
    expect(coverBlend({ from: a, to: b, blend: 0.5 }, look, layers)).toEqual(['#808080']);
    expect(coverBlend({ from: a, to: b, blend: 1 }, look, layers)).toEqual(['#ffffff']);
    expect(coverBlend({ from: a, to: null, blend: 1 }, look, layers)).toEqual(look);
    expect(coverBlend({ from: null, to: b, blend: 1 }, look, (p) => p.gradient)).toEqual([
      '#0000ff',
    ]);
    // In a video: from the part before over the first moments of a part.
    expect(partColors([a, b], 1, 0)).toEqual({ from: a, to: b, blend: 0 });
    expect(partColors([a, b], 1, 30)).toEqual({ from: a, to: b, blend: 1 });
    expect(partColors([a, null], 0, 0)).toEqual({ from: a, to: a, blend: 0 });
  });
});
