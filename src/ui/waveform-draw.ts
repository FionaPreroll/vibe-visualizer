import { summarise, WAVEFORM_STRIDE, type Waveform } from '../core/analysis/waveform';
import type { WaveformStyle } from '../core/state/app-state';

/**
 * Draws a waveform (TR-03, TR-08) into a 2D canvas: one column per pixel, mirrored around the
 * middle, in one of two styles (TR-10). "bands": the lows, mids and highs as layers, blue,
 * orange and white, each band scaled to its own loud parts in the track, so the kicks stand out
 * in blue (as Rekordbox's "3Band"). "rgb": one shape as high as the peak, coloured by the bands
 * (lows red, mids green, highs blue). What has been played is drawn brighter.
 */

/** Colours of the eight hot cues (TR-04). */
export const CUE_COLOURS = [
  '#ff4d5e',
  '#ff9f43',
  '#ffd84d',
  '#5ee07a',
  '#4dd8e0',
  '#4d8dff',
  '#a66bff',
  '#ff6bcb',
] as const;

export interface WaveformView {
  /** Seconds at the left and right edge. */
  from: number;
  to: number;
  /** Seconds played so far: drawn brighter up to here. */
  played: number;
  /** Seconds analysed so far (the rest is not drawn). */
  available: number;
}

const bands = new Float32Array(4);

/**
 * How bright the "bands" style draws what lies ahead of the playhead: the colours of its layers
 * times this, opaque, so the layers do not blend.
 */
const AHEAD_SHADE = 0.53;

/**
 * The layers of the "bands" style, lows first: colour, colour ahead of the playhead and largest
 * half-height.
 */
const LAYERS = (
  [
    [[47, 107, 255], 1],
    [[255, 154, 31], 0.68],
    [[244, 244, 255], 0.36],
  ] as const
).map(([rgb, height]) => ({
  colour: `rgb(${rgb.join(',')})`,
  ahead: `rgb(${rgb.map((value) => Math.round(value * AHEAD_SHADE)).join(',')})`,
  height,
}));
/** Steepens the layers, so quiet parts of a band stay small. */
const LAYER_CURVE = 1.4;
/** Opacity of the "rgb" style ahead of the playhead. */
const AHEAD = 0.45;

/** Per waveform: the level each band reaches in the loud parts of the track. */
const bandLevels = new WeakMap<Waveform, Float32Array>();

/** The 98th percentile of each band's buckets (0…1), from their histograms. */
function loudLevels(waveform: Waveform): Float32Array {
  let levels = bandLevels.get(waveform);
  if (levels) return levels;
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const data = waveform.data;
  for (let b = 0; b < waveform.length; b++) {
    const at = b * WAVEFORM_STRIDE;
    for (let band = 0; band < 3; band++) histograms[band]![data[at + 1 + band]!]!++;
  }
  levels = new Float32Array(3);
  for (let band = 0; band < 3; band++) {
    const histogram = histograms[band]!;
    let count = 0;
    let value = 255;
    for (; value > 0; value--) {
      count += histogram[value]!;
      if (count > waveform.length * 0.02) break;
    }
    levels[band] = Math.max(0.05, value / 255);
  }
  bandLevels.set(waveform, levels);
  return levels;
}

/** A 2D context, of a canvas on the page or of an OffscreenCanvas. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawWaveform(
  context: Context2D,
  waveform: Waveform | null,
  view: WaveformView,
  width: number,
  height: number,
  style: WaveformStyle = 'rgb',
): void {
  context.clearRect(0, 0, width, height);
  if (!waveform || width <= 0 || view.to <= view.from) return;
  if (style === 'bands') return drawBands(context, waveform, view, width, height);
  const secondsPerPixel = (view.to - view.from) / width;
  const middle = height / 2;
  for (let x = 0; x < width; x++) {
    const from = view.from + x * secondsPerPixel;
    const to = from + secondsPerPixel;
    if (from < 0 || from >= view.available) continue;
    if (!summarise(waveform, from, Math.max(to, from + 1 / waveform.rate), bands)) continue;
    const peak = bands[0]!;
    const brightest = Math.max(bands[1]!, bands[2]!, bands[3]!, 1e-3);
    const red = Math.round(255 * Math.min(1, (bands[1]! / brightest) * 0.9 + 0.1));
    const green = Math.round(255 * Math.min(1, (bands[2]! / brightest) * 0.85 + 0.1));
    const blue = Math.round(255 * Math.min(1, (bands[3]! / brightest) * 0.9 + 0.15));
    const alpha = from < view.played ? 1 : AHEAD;
    context.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
    const half = Math.max(0.5, peak * middle);
    context.fillRect(x, middle - half, 1, 2 * half);
  }
}

/** The "bands" style: each band a layer, drawn as one path per colour and brightness. */
function drawBands(
  context: Context2D,
  waveform: Waveform,
  view: WaveformView,
  width: number,
  height: number,
): void {
  const loud = loudLevels(waveform);
  const secondsPerPixel = (view.to - view.from) / width;
  const middle = height / 2;
  // Played and ahead for each layer.
  const paths = Array.from({ length: 6 }, () => new Path2D());
  for (let x = 0; x < width; x++) {
    const from = view.from + x * secondsPerPixel;
    const to = from + secondsPerPixel;
    if (from < 0 || from >= view.available) continue;
    if (!summarise(waveform, from, Math.max(to, from + 1 / waveform.rate), bands)) continue;
    const ahead = from < view.played ? 0 : 3;
    for (let band = 0; band < 3; band++) {
      const level = Math.min(1, bands[band + 1]! / loud[band]!) ** LAYER_CURVE;
      const half = level * LAYERS[band]!.height * middle;
      if (half >= 0.25) paths[band + ahead]!.rect(x, middle - half, 1, 2 * half);
    }
  }
  for (let band = 0; band < 3; band++) {
    context.fillStyle = LAYERS[band]!.colour;
    context.fill(paths[band]!);
    context.fillStyle = LAYERS[band]!.ahead;
    context.fill(paths[band + 3]!);
  }
}

/** A canvas the strip of a {@link WaveformStrip} is drawn into, and its context. */
export interface StripCanvas {
  canvas: CanvasImageSource;
  context: Context2D;
}

/** Makes a canvas for a strip: one of the page, never shown (tests give their own). */
export type CanvasFactory = (width: number, height: number) => StripCanvas | null;

const pageCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
};

/** Pixel columns a strip reaches beyond the view on either side. */
export const STRIP_MARGIN = 256;

/** What a strip lays over the part ahead of the playhead, per style (see {@link AHEAD_SHADE}). */
const AHEAD_FILL: Record<WaveformStyle, { operation: GlobalCompositeOperation; style: string }> = {
  // Darker colours, over what is drawn only.
  bands: { operation: 'source-atop', style: `rgba(0,0,0,${1 - AHEAD_SHADE})` },
  // Fainter ones: what is drawn loses opacity.
  rgb: { operation: 'destination-out', style: `rgba(0,0,0,${1 - AHEAD})` },
};

/**
 * Draws a waveform as {@link drawWaveform} does, for a view that moves with the music (the
 * detail waveform, TR-08), without drawing it anew in every frame.
 *
 * The waveform is drawn once, as played, into a strip of pixel columns a little wider than the
 * view: column `c` of the waveform always shows the seconds from `c` to `c + 1` times the
 * seconds per column. Each frame copies the part of the strip in view in one go, shifted by the
 * fraction of a column the view lies between two columns, so the waveform glides rather than
 * stepping by whole pixels; then the part ahead of the playhead is darkened (bands) or made
 * fainter (RGB), as drawWaveform draws it.
 *
 * Two canvases are made once and used in turn: when the view nears the end of the strip, the
 * columns still in reach are copied into the other one, and only the new columns are drawn. So a
 * frame of playback makes no canvas and draws no column, and the strip moves on every
 * {@link STRIP_MARGIN} columns or so. It is drawn anew when the waveform changes (while it is
 * analysed), and when the zoom, the size or the style does.
 */
export class WaveformStrip {
  /** The strip in use and the one it moves into, alternately. */
  private canvases: (StripCanvas | null)[] = [];
  private current = 0;
  /** The waveform column the strip's first column shows; null until it is drawn. */
  private first: number | null = null;
  private waveform: Waveform | null = null;
  private available = 0;
  private secondsPerColumn = 0;
  /** Size of the strip, in pixel columns and rows. */
  private width = 0;
  private height = 0;
  private style: WaveformStyle = 'bands';

  constructor(private readonly createCanvas: CanvasFactory = pageCanvas) {}

  draw(
    context: Context2D,
    waveform: Waveform | null,
    view: WaveformView,
    width: number,
    height: number,
    style: WaveformStyle,
  ): void {
    context.clearRect(0, 0, width, height);
    if (!waveform || width <= 0 || height <= 0 || view.to <= view.from) return;
    let secondsPerColumn = (view.to - view.from) / width;
    // The view's ends move with the playhead, and their difference by a rounding error: within
    // that, the zoom is the same, and so is the strip.
    if (Math.abs(secondsPerColumn - this.secondsPerColumn) <= this.secondsPerColumn * 1e-9) {
      secondsPerColumn = this.secondsPerColumn;
    }
    const stripWidth = width + 1 + 2 * STRIP_MARGIN;
    if (stripWidth !== this.width || height !== this.height) {
      this.canvases = [
        this.createCanvas(stripWidth, height),
        this.createCanvas(stripWidth, height),
      ];
      this.width = stripWidth;
      this.height = height;
      this.first = null;
    }
    if (
      waveform !== this.waveform ||
      view.available !== this.available ||
      secondsPerColumn !== this.secondsPerColumn ||
      style !== this.style
    ) {
      this.waveform = waveform;
      this.available = view.available;
      this.secondsPerColumn = secondsPerColumn;
      this.style = style;
      this.first = null;
    }
    // The view starts within waveform column `base`, `position - base` of a column into it.
    const position = view.from / secondsPerColumn;
    const base = Math.floor(position);
    const strip = this.reach(base, width + 1);
    if (!strip || this.first === null) return;
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(
      strip.canvas,
      base - this.first,
      0,
      width + 1,
      height,
      base - position,
      0,
      width + 1,
      height,
    );
    const split = Math.max(0, Math.min(width, (view.played - view.from) / secondsPerColumn));
    if (split < width) {
      const ahead = AHEAD_FILL[style];
      context.globalCompositeOperation = ahead.operation;
      context.fillStyle = ahead.style;
      context.fillRect(split, 0, width - split, height);
    }
    context.restore();
  }

  /**
   * The strip with the `count` waveform columns from `base` on: as it is, or moved on to them
   * (the columns it keeps copied, the others drawn).
   */
  private reach(base: number, count: number): StripCanvas | null {
    const strip = this.canvases[this.current] ?? null;
    const first = this.first;
    if (first !== null && base >= first && base + count <= first + this.width) return strip;
    const target = this.canvases[1 - this.current] ?? null;
    if (!strip || !target) return null;
    const next = base - STRIP_MARGIN;
    target.context.clearRect(0, 0, this.width, this.height);
    let keptFrom = next;
    let keptTo = next;
    if (first !== null) {
      const from = Math.max(next, first);
      const to = Math.min(next, first) + this.width;
      if (to > from) {
        const columns = to - from;
        target.context.drawImage(
          strip.canvas,
          from - first,
          0,
          columns,
          this.height,
          from - next,
          0,
          columns,
          this.height,
        );
        keptFrom = from;
        keptTo = to;
      }
    }
    this.drawColumns(target, next, next, keptFrom);
    this.drawColumns(target, next, keptTo, next + this.width);
    this.first = next;
    this.current = 1 - this.current;
    return target;
  }

  /** Draws the waveform columns `from` to `to` into `strip`, whose first column is `first`. */
  private drawColumns(strip: StripCanvas, first: number, from: number, to: number): void {
    if (to <= from || !this.waveform) return;
    const { context } = strip;
    context.save();
    context.translate(from - first, 0);
    const view = {
      from: from * this.secondsPerColumn,
      to: to * this.secondsPerColumn,
      played: Infinity,
      available: this.available,
    };
    drawWaveform(context, this.waveform, view, to - from, this.height, this.style);
    context.restore();
  }
}
