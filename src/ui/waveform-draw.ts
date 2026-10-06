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
 * The layers of the "bands" style, lows first: colour, colour ahead of the playhead (darker, but
 * opaque, so the layers do not blend) and largest half-height.
 */
const LAYERS = [
  { colour: 'rgb(47,107,255)', ahead: 'rgb(25,56,135)', height: 1 },
  { colour: 'rgb(255,154,31)', ahead: 'rgb(135,82,18)', height: 0.68 },
  { colour: 'rgb(244,244,255)', ahead: 'rgb(128,128,136)', height: 0.36 },
] as const;
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

/** Pixel columns per tile of {@link WaveformTiles}. */
export const TILE_COLUMNS = 256;

/** A canvas for a tile, and its context. */
export interface TileCanvas {
  canvas: CanvasImageSource;
  context: Context2D;
}

/** Makes the canvas of a tile (an OffscreenCanvas; tests give their own). */
export type TileFactory = (width: number, height: number) => TileCanvas | null;

const offscreenTile: TileFactory = (width, height) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
};

/**
 * Draws a waveform as {@link drawWaveform} does, for a view that moves with the music (the
 * detail waveform, TR-08). The waveform is drawn once into tiles of {@link TILE_COLUMNS} pixel
 * columns, brighter (played) and darker (ahead), and each frame copies the parts of the tiles
 * in view. Column `c` of the waveform always covers the seconds from `c` to `c + 1` times the
 * seconds per column, so the view moves in whole pixels, and a tile is drawn only when it comes
 * into view (and again, played, when the playhead reaches it). The tiles are drawn anew when the
 * waveform (while analysed), the zoom, the height or the style changes.
 */
export class WaveformTiles {
  /** By tile index and version, oldest use first. */
  private readonly tiles = new Map<string, TileCanvas>();
  private waveform: Waveform | null = null;
  private available = 0;
  private secondsPerColumn = 0;
  private height = 0;
  private style: WaveformStyle = 'bands';

  constructor(private readonly createTile: TileFactory = offscreenTile) {}

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
    // that, the zoom is the same, and so are the tiles.
    if (Math.abs(secondsPerColumn - this.secondsPerColumn) <= this.secondsPerColumn * 1e-9) {
      secondsPerColumn = this.secondsPerColumn;
    }
    if (
      waveform !== this.waveform ||
      view.available !== this.available ||
      secondsPerColumn !== this.secondsPerColumn ||
      height !== this.height ||
      style !== this.style
    ) {
      this.tiles.clear();
      this.waveform = waveform;
      this.available = view.available;
      this.secondsPerColumn = secondsPerColumn;
      this.height = height;
      this.style = style;
    }
    // Column `base + x` of the waveform shows at x; those that start before `played` as played.
    const base = Math.round(view.from / secondsPerColumn);
    const split = Math.max(0, Math.min(width, Math.ceil(view.played / secondsPerColumn) - base));
    const columns = Math.ceil(view.available / secondsPerColumn);
    const first = Math.max(0, Math.floor(base / TILE_COLUMNS));
    const last = Math.min(
      Math.floor((base + width - 1) / TILE_COLUMNS),
      Math.floor((columns - 1) / TILE_COLUMNS),
    );
    // Room for the tiles of two views, played and ahead.
    const limit = 4 * (Math.ceil(width / TILE_COLUMNS) + 2);
    for (let tile = first; tile <= last; tile++) {
      const left = tile * TILE_COLUMNS - base;
      this.copy(
        context,
        tile,
        true,
        left,
        Math.max(0, left),
        Math.min(split, left + TILE_COLUMNS),
        limit,
      );
      this.copy(
        context,
        tile,
        false,
        left,
        Math.max(split, left),
        Math.min(width, left + TILE_COLUMNS),
        limit,
      );
    }
  }

  /** Copies the columns `start` to `end` of the view from `tile`, whose first column is at `left`. */
  private copy(
    context: Context2D,
    tile: number,
    played: boolean,
    left: number,
    start: number,
    end: number,
    limit: number,
  ): void {
    if (end <= start) return;
    const image = this.tile(tile, played, limit);
    if (!image) return;
    const width = end - start;
    context.drawImage(
      image.canvas,
      start - left,
      0,
      width,
      this.height,
      start,
      0,
      width,
      this.height,
    );
  }

  /** Tile `index` in its played or its ahead version, drawn if it is not kept. */
  private tile(index: number, played: boolean, limit: number): TileCanvas | null {
    const id = `${index}:${played ? 'played' : 'ahead'}`;
    const kept = this.tiles.get(id);
    if (kept) {
      this.tiles.delete(id);
      this.tiles.set(id, kept);
      return kept;
    }
    const tile = this.createTile(TILE_COLUMNS, this.height);
    if (!tile || !this.waveform) return null;
    const from = index * TILE_COLUMNS * this.secondsPerColumn;
    const view = {
      from,
      to: (index + 1) * TILE_COLUMNS * this.secondsPerColumn,
      played: played ? Infinity : -Infinity,
      available: this.available,
    };
    drawWaveform(tile.context, this.waveform, view, TILE_COLUMNS, this.height, this.style);
    this.tiles.set(id, tile);
    for (const old of this.tiles.keys()) {
      if (this.tiles.size <= limit) break;
      this.tiles.delete(old);
    }
    return tile;
  }
}
