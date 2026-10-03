import { GRADIENT_STOPS } from './kaleido-settings';
import { mixColor } from './settings-morph';
import { MAX_LAYERS } from './visual-settings';

/**
 * Colours from the cover art (VE-12): the main colours of the cover of the track heard become
 * the colour layers of the Logo Spectrum and the gradient of the Kaleidoscope, instead of the
 * look's palette. They are found the same way from the same picture, so a video and its resume
 * get the same colours.
 */

export interface CoverPalette {
  /** The colour layers of the Logo Spectrum, from the one next to the top layer to the back. */
  layers: string[];
  /** The gradient of the Kaleidoscope, dark to bright. */
  gradient: string[];
}

/**
 * The cover colours to show: the palette of the file heard (`to`), blending in from the one
 * heard before (`from`) while `blend` goes from 0 to 1; null in either: the look's own colours.
 */
export interface CoverColors {
  from: CoverPalette | null;
  to: CoverPalette | null;
  blend: number;
}

/** How long the colours take to go from one track's cover to the next one's (s). */
export const COVER_BLEND_SECONDS = 1.2;
/** The side of the small copy of the cover its colours are found in (px). */
const SAMPLE_SIZE = 40;
/** At most this many colours are found in a cover. */
const CLUSTERS = 6;
/** Colours with less chroma (OKLab) count as grey. */
const GREY_CHROMA = 0.04;

type Lab = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLab of an sRGB colour (0…1 per channel). */
export function oklab(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/**
 * '#rrggbb' of lightness `L`, chroma `C` and hue `h` (radians) in OKLab; with less chroma where
 * sRGB has no such colour.
 */
export function lchHex(L: number, C: number, h: number): string {
  const lab = (chroma: number): Lab => [L, chroma * Math.cos(h), chroma * Math.sin(h)];
  let rgb = linearRgb(lab(C));
  if (!inGamut(rgb)) {
    let low = 0;
    let high = C;
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      if (inGamut(linearRgb(lab(mid)))) low = mid;
      else high = mid;
    }
    rgb = linearRgb(lab(low));
  }
  return `#${rgb
    .map((c) =>
      Math.round(toGamma(Math.min(1, Math.max(0, c))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

interface Cluster {
  lab: Lab;
  /** Its share of the cover's pixels. */
  weight: number;
}

const distance = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The main colours of the pixels: k-means in OKLab, begun from the fullest cells of a coarse
 * grid that lie apart (no chance in it, so the same pixels give the same colours).
 */
function clusters(pixels: Lab[]): Cluster[] {
  const cells = new Map<number, { sum: Lab; count: number }>();
  for (const lab of pixels) {
    const cell =
      Math.min(5, Math.floor(lab[0] * 6)) * 64 +
      Math.min(7, Math.max(0, Math.floor((lab[1] + 0.3) * (8 / 0.6)))) * 8 +
      Math.min(7, Math.max(0, Math.floor((lab[2] + 0.3) * (8 / 0.6))));
    const entry = cells.get(cell) ?? { sum: [0, 0, 0], count: 0 };
    for (let c = 0; c < 3; c++) entry.sum[c]! += lab[c]!;
    entry.count++;
    cells.set(cell, entry);
  }
  const fullest = [...cells.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
    .map(([, { sum, count }]) => sum.map((value) => value / count) as Lab);
  const centres: Lab[] = [];
  for (const lab of fullest) {
    if (centres.length === CLUSTERS) break;
    if (centres.every((centre) => distance(centre, lab) >= 0.12)) centres.push(lab);
  }
  let counts: number[] = [];
  for (let round = 0; round < 8; round++) {
    const sums = centres.map((): Lab => [0, 0, 0]);
    counts = centres.map(() => 0);
    for (const lab of pixels) {
      let nearest = 0;
      for (let k = 1; k < centres.length; k++) {
        if (distance(lab, centres[k]!) < distance(lab, centres[nearest]!)) nearest = k;
      }
      for (let c = 0; c < 3; c++) sums[nearest]![c]! += lab[c]!;
      counts[nearest]!++;
    }
    for (let k = 0; k < centres.length; k++) {
      if (counts[k]! > 0) centres[k] = sums[k]!.map((value) => value / counts[k]!) as Lab;
    }
  }
  return centres
    .map((lab, k) => ({ lab, weight: counts[k]! / pixels.length }))
    .filter((cluster) => cluster.weight > 0);
}

const chroma = (lab: Lab) => Math.hypot(lab[1], lab[2]);
const hue = (lab: Lab) => Math.atan2(lab[2], lab[1]);

/**
 * The palette of a cover from its pixels (RGBA, 0…255): its most telling colours (the more
 * colourful, the more they count, so a small bright patch on grey still gives its colour),
 * brought to the lightness each place needs. A grey cover gives greys. Null: no pixel shows.
 */
export function paletteFromPixels(rgba: ArrayLike<number>): CoverPalette | null {
  const pixels: Lab[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    pixels.push(oklab(rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255));
  }
  if (pixels.length === 0) return null;
  const found = clusters(pixels);
  const accents = found
    .filter((cluster) => chroma(cluster.lab) >= GREY_CHROMA)
    .sort((a, b) => b.weight * (chroma(b.lab) + 0.05) - a.weight * (chroma(a.lab) + 0.05))
    .slice(0, 3)
    .map((cluster) => ({
      h: hue(cluster.lab),
      // Colourful enough to glow, as the built-in palettes do.
      C: Math.min(0.26, Math.max(0.08, chroma(cluster.lab) * 1.25)),
    }));
  // A grey cover: greys.
  const tones = accents.length > 0 ? accents : [{ h: 0, C: 0 }];
  const main = tones[0]!;
  const second = tones[1] ?? main;
  const gradient = [
    lchHex(0.12, Math.min(main.C, 0.04), main.h),
    lchHex(0.38, main.C * 0.6, main.h),
    lchHex(0.62, main.C, main.h),
    lchHex(0.8, second.C * 0.9, second.h),
    lchHex(0.95, Math.min(second.C, 0.035), second.h),
  ];
  // The layers take the colours in turn, darker towards the back.
  const layers = Array.from({ length: MAX_LAYERS }, (_, i) => {
    const tone = tones[i % tones.length]!;
    return lchHex(0.8 - (0.3 * i) / (MAX_LAYERS - 1), tone.C, tone.h);
  });
  if (gradient.length !== GRADIENT_STOPS) throw new Error('The cover gradient has the wrong size');
  return { layers, gradient };
}

/**
 * The palette of a cover (VE-12); null if it has no pixel to show, or the browser cannot read
 * it here (then the look keeps its colours).
 */
export function coverPalette(image: ImageBitmap): CoverPalette | null {
  try {
    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return paletteFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The colours to show: `look`'s own, or those of the covers as `colors` blends them; `pick`
 * takes the part of a cover's palette (its layers or its gradient).
 */
export function coverBlend(
  colors: CoverColors | null,
  look: readonly string[],
  pick: (palette: CoverPalette) => readonly string[],
): readonly string[] {
  if (!colors) return look;
  const from = colors.from ? pick(colors.from) : look;
  const to = colors.to ? pick(colors.to) : look;
  const t = smooth(Math.min(1, Math.max(0, colors.blend)));
  if (t >= 1 || from === to) return to;
  if (t <= 0) return from;
  return to.map((color, i) => mixColor(from[i % from.length]!, color, t));
}

/**
 * The cover colours of a frame of a video (VE-12): those of its part, blended in from the part
 * before over the first {@link COVER_BLEND_SECONDS} of it, as the preview blends them.
 */
export function partColors(
  palettes: readonly (CoverPalette | null)[],
  index: number,
  since: number,
): CoverColors {
  return {
    from: index > 0 ? (palettes[index - 1] ?? null) : (palettes[index] ?? null),
    to: palettes[index] ?? null,
    blend: Math.min(1, Math.max(0, since / COVER_BLEND_SECONDS)),
  };
}
