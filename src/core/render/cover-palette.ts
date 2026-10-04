import { GRADIENT_STOPS } from './kaleido-settings';
import { mixColor } from './settings-morph';
import { MAX_LAYERS } from './visual-settings';

/**
 * Colours of the track (VE-12): the main colours of the cover of the track heard, or colours the
 * user gave the track, become the colour layers of the Logo Spectrum and the gradient of the
 * Kaleidoscope, instead of the look's palette. They are found the same way from the same picture,
 * so a video and its resume get the same colours.
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

/** A colour of a palette by its hue (radians) and chroma (OKLab); its place sets its lightness. */
export interface Tone {
  h: number;
  C: number;
}

/**
 * The colours the user gave a file for the visuals (VE-12), kept with it: where they come from
 * (its cover art, colours of one's own, or none: the look's palette), and how colourful they are.
 */
export interface TrackColors {
  source: TrackColorSource;
  /** One to {@link MAX_OWN_COLORS} colours of one's own (source 'own'), the main one first. */
  own: string[];
  /** How colourful: 1 as found or picked, 0 grey, up to 2. */
  vivid: number;
}

export type TrackColorSource = 'cover' | 'own' | 'look';
export const TRACK_COLOR_SOURCES: readonly TrackColorSource[] = ['cover', 'own', 'look'];
/** What a file has until the user changes it: the colours of its cover art, as found. */
export const DEFAULT_TRACK_COLORS: TrackColors = { source: 'cover', own: [], vivid: 1 };
export const MAX_OWN_COLORS = 3;
export const VIVID_RANGE = { min: 0, max: 2 } as const;
const COLOR = /^#[0-9a-f]{6}$/i;

/** Track colours as stored, checked; null for the defaults or anything else. */
export function sanitizeTrackColors(value: unknown): TrackColors | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { source?: unknown; own?: unknown; vivid?: unknown };
  const own = Array.isArray(input.own)
    ? input.own
        .filter((color): color is string => typeof color === 'string' && COLOR.test(color))
        .slice(0, MAX_OWN_COLORS)
        .map((color) => color.toLowerCase())
    : [];
  const wanted = (TRACK_COLOR_SOURCES as unknown[]).includes(input.source)
    ? (input.source as TrackColorSource)
    : 'cover';
  // Own colours without any: those of the cover.
  const source = wanted === 'own' && own.length === 0 ? 'cover' : wanted;
  const vivid =
    typeof input.vivid === 'number' && Number.isFinite(input.vivid)
      ? Math.min(VIVID_RANGE.max, Math.max(VIVID_RANGE.min, input.vivid))
      : 1;
  const colors = { source, own, vivid };
  return sameTrackColors(colors, DEFAULT_TRACK_COLORS) ? null : colors;
}

/** Whether two track colours show the same (own colours count only where they are used). */
export function sameTrackColors(a: TrackColors | null, b: TrackColors | null): boolean {
  const x = a ?? DEFAULT_TRACK_COLORS;
  const y = b ?? DEFAULT_TRACK_COLORS;
  return (
    x.source === y.source &&
    x.vivid === y.vivid &&
    (x.source !== 'own' || x.own.join() === y.own.join())
  );
}

/** The side of the copy of the cover its colours are found in (px): fine enough for thin lines. */
const SAMPLE_SIZE = 128;
/** At most this many colours are found in a cover. */
const CLUSTERS = 8;
/** Colours with less chroma (OKLab) count as grey. */
const GREY_CHROMA = 0.04;
/** Colours whose hues are closer than this (radians) count as one. */
const SAME_HUE = (25 / 180) * Math.PI;

interface Cluster {
  /** Its share of the cover's pixels. */
  weight: number;
  /** Its colour as its purest pixels have it: mixed ones (thin lines, edges) count less. */
  tone: Tone;
}

const distance = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (lab: Lab) => Math.hypot(lab[1], lab[2]);

/**
 * The main colours among the colourful pixels: k-means in OKLab, begun from the cells of a coarse
 * grid that are fullest, colourful ones counting more, and that lie apart. There is no chance in
 * it, so the same pixels give the same colours. `total`: all pixels of the cover, greys too.
 */
function clusters(pixels: Lab[], total: number): Cluster[] {
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
  const seeds = [...cells.entries()]
    .map(([cell, { sum, count }]) => {
      const lab = sum.map((value) => value / count) as Lab;
      return { cell, lab, score: count * (1 + 10 * chroma(lab)) };
    })
    .sort((a, b) => b.score - a.score || a.cell - b.cell);
  const centres: Lab[] = [];
  for (const { lab } of seeds) {
    if (centres.length === CLUSTERS) break;
    if (centres.every((centre) => distance(centre, lab) >= 0.12)) centres.push(lab);
  }
  const members = new Int32Array(pixels.length);
  for (let round = 0; round < 8; round++) {
    const sums = centres.map((): Lab => [0, 0, 0]);
    const counts = centres.map(() => 0);
    pixels.forEach((lab, i) => {
      let nearest = 0;
      for (let k = 1; k < centres.length; k++) {
        if (distance(lab, centres[k]!) < distance(lab, centres[nearest]!)) nearest = k;
      }
      members[i] = nearest;
      for (let c = 0; c < 3; c++) sums[nearest]![c]! += lab[c]!;
      counts[nearest]!++;
    });
    for (let k = 0; k < centres.length; k++) {
      if (counts[k]! > 0) centres[k] = sums[k]!.map((value) => value / counts[k]!) as Lab;
    }
  }
  // Each cluster's hue and chroma, its pixels weighted by their chroma squared: lines and edges
  // mixed with the ground count less than the pure colour.
  const tones = centres.map(() => ({ a: 0, b: 0, chroma: 0, weight: 0, count: 0 }));
  pixels.forEach((lab, i) => {
    const tone = tones[members[i]!]!;
    const c = chroma(lab);
    const w = c * c;
    tone.a += lab[1] * w;
    tone.b += lab[2] * w;
    tone.chroma += c * w;
    tone.weight += w;
    tone.count++;
  });
  return tones
    .filter((tone) => tone.count > 0)
    .map((tone) => ({
      weight: tone.count / total,
      tone: { h: Math.atan2(tone.b, tone.a), C: tone.chroma / tone.weight },
    }));
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

/**
 * The colours of a cover from its pixels (RGBA, 0…255): up to three of different hues, the most
 * telling first (the more colourful, the more they count, so a small bright logo on a plain
 * cover still gives its colour), colourful enough to glow. A grey cover gives a grey; null: no
 * pixel shows.
 */
export function coverTones(rgba: ArrayLike<number>): Tone[] | null {
  // Greys give no colour: only the colourful pixels are clustered.
  const pixels: Lab[] = [];
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    total++;
    const lab = oklab(rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255);
    if (chroma(lab) >= GREY_CHROMA) pixels.push(lab);
  }
  if (total === 0) return null;
  const tones: Tone[] = [];
  const found = clusters(pixels, total).sort(
    (a, b) => b.weight * (b.tone.C + 0.05) - a.weight * (a.tone.C + 0.05),
  );
  for (const { tone } of found) {
    if (tones.some((other) => hueDistance(other.h, tone.h) < SAME_HUE)) continue;
    tones.push({ h: tone.h, C: Math.min(0.26, Math.max(0.08, tone.C * 1.25)) });
    if (tones.length === 3) break;
  }
  return tones.length > 0 ? tones : [{ h: 0, C: 0 }];
}

/** The tones of colours of one's own ('#rrggbb'): their hues and chroma, as picked. */
export function tonesOf(colors: readonly string[]): Tone[] {
  return colors.map((color) => {
    const value = Number.parseInt(color.slice(1), 16);
    const [, a, b] = oklab(
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
    );
    return { h: Math.atan2(b, a), C: Math.hypot(a, b) };
  });
}

/** A tone as a colour to show and pick ('#rrggbb'), at the lightness of a palette's middle. */
export function toneColor(tone: Tone): string {
  return lchHex(0.68, tone.C, tone.h);
}

/** The most chroma sRGB has for lightness `L` and hue `h` (OKLab). */
function maxChroma(L: number, h: number): number {
  let low = 0;
  let high = 0.4;
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2;
    if (inGamut(linearRgb([L, mid * Math.cos(h), mid * Math.sin(h)]))) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * The lightness at which hue `h` can be most colourful in sRGB: dark for blue (about 0.45), light
 * for yellow (above 0.9).
 */
export function cuspLightness(h: number): number {
  let best = 0.5;
  let most = -1;
  for (let L = 0.3; L <= 0.98; L += 0.02) {
    const chroma = maxChroma(L, h);
    if (chroma > most) {
      most = chroma;
      best = L;
    }
  }
  return best;
}

/**
 * The palette of tones (the main one first), `vivid` times as colourful. Each tone sits at a
 * lightness where its hue can glow: the gradient goes dark to bright with the first two tones,
 * the one that can be the brighter towards the bright end; the layers take the tones in turn,
 * the main one in front, darker towards the back.
 */
export function paletteFromTones(tones: readonly Tone[], vivid = 1): CoverPalette {
  const scaled = (tones.length > 0 ? tones : [{ h: 0, C: 0 }]).map((tone) => ({
    h: tone.h,
    C: tone.C * vivid,
    cusp: cuspLightness(tone.h),
  }));
  const [low, high] = [scaled[0]!, scaled[1] ?? scaled[0]!].sort((a, b) => a.cusp - b.cusp) as [
    (typeof scaled)[number],
    (typeof scaled)[number],
  ];
  const middle = Math.min(0.66, Math.max(0.42, low.cusp));
  const bright = Math.min(0.86, Math.max(middle + 0.12, high.cusp));
  const gradient = [
    lchHex(0.1, Math.min(low.C, 0.04), low.h),
    lchHex(middle * 0.6, low.C * 0.7, low.h),
    lchHex(middle, low.C, low.h),
    lchHex(bright, high.C, high.h),
    lchHex(0.95, Math.min(high.C, 0.035), high.h),
  ];
  const layers = Array.from({ length: MAX_LAYERS }, (_, i) => {
    const tone = scaled[i % scaled.length]!;
    const front = Math.min(0.85, Math.max(0.55, tone.cusp));
    return lchHex(front - (0.25 * i) / (MAX_LAYERS - 1), tone.C, tone.h);
  });
  if (gradient.length !== GRADIENT_STOPS) throw new Error('The cover gradient has the wrong size');
  return { layers, gradient };
}

/**
 * The palette of a track (VE-12): from its own colours, or from the tones of its cover art
 * (`cover`; null: it has none), as its colours ask; null: the look's own palette.
 */
export function trackPalette(
  colors: TrackColors | null,
  cover: Tone[] | null,
): CoverPalette | null {
  const { source, own, vivid } = colors ?? DEFAULT_TRACK_COLORS;
  if (source === 'look') return null;
  const tones = source === 'own' && own.length > 0 ? tonesOf(own) : cover;
  return tones ? paletteFromTones(tones, vivid) : null;
}

/**
 * The tones of a cover image (VE-12); null if it has no pixel to show, or the browser cannot
 * read it here (then the look keeps its colours).
 */
export function coverTonesOf(image: ImageBitmap): Tone[] | null {
  try {
    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    // A filtered copy: thin lines keep part of their colour instead of falling between pixels.
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return coverTones(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
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
