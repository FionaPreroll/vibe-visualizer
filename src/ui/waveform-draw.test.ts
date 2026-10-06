import { describe, expect, it } from 'vitest';
import { WAVEFORM_RATE, WAVEFORM_STRIDE, type Waveform } from '../core/analysis/waveform';
import {
  drawWaveform,
  TILE_COLUMNS,
  WaveformTiles,
  type TileCanvas,
  type WaveformView,
} from './waveform-draw';

/**
 * A canvas that keeps, per pixel column, what was drawn there: the fill and the rectangle. The
 * "rgb" style draws each column as one rectangle, so this shows what a real canvas would.
 */
class Columns {
  readonly columns: (string | null)[];
  fillStyle = '';
  constructor(width: number) {
    this.columns = Array.from({ length: width }, () => null);
  }
  clearRect(x: number, _y: number, width: number): void {
    for (let i = x; i < x + width; i++) if (i in this.columns) this.columns[i] = null;
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    for (let i = x; i < x + width; i++) {
      if (i in this.columns) this.columns[i] = `${this.fillStyle} ${y} ${height}`;
    }
  }
  drawImage(
    source: Columns,
    sx: number,
    _sy: number,
    width: number,
    _sh: number,
    dx: number,
  ): void {
    for (let i = 0; i < width; i++) this.columns[dx + i] = source.columns[sx + i] ?? null;
  }
}

function factory() {
  const made: Columns[] = [];
  const create = (width: number): TileCanvas => {
    const canvas = new Columns(width);
    made.push(canvas);
    return { canvas: canvas as unknown as CanvasImageSource, context: asContext(canvas) };
  };
  return { made, create };
}

const asContext = (canvas: Columns) => canvas as unknown as CanvasRenderingContext2D;

/** A waveform of `seconds`, with levels that change from bucket to bucket. */
function waveform(seconds: number): Waveform {
  const length = seconds * WAVEFORM_RATE;
  const data = new Uint8Array(length * WAVEFORM_STRIDE);
  for (let i = 0; i < data.length; i++) data[i] = (i * 97 + (i >> 3) * 31) % 256;
  return { rate: WAVEFORM_RATE, length, data };
}

/** 256 columns over 2 s: 1/128 s per column, which adds up exactly in floating point. */
const WIDTH = 256;
const SPAN = 2;
const HEIGHT = 40;

function view(from: number, available = 10): WaveformView {
  return { from, to: from + SPAN, played: from + SPAN / 2, available };
}

function direct(wave: Waveform, shown: WaveformView): (string | null)[] {
  const canvas = new Columns(WIDTH);
  drawWaveform(asContext(canvas), wave, shown, WIDTH, HEIGHT, 'rgb');
  return canvas.columns;
}

function tiled(tiles: WaveformTiles, wave: Waveform, shown: WaveformView): (string | null)[] {
  const canvas = new Columns(WIDTH);
  tiles.draw(asContext(canvas), wave, shown, WIDTH, HEIGHT, 'rgb');
  return canvas.columns;
}

describe('the detail waveform in tiles (TR-08)', () => {
  const wave = waveform(10);

  it('shows what drawing it directly shows, played and ahead, where a view starts on a column', () => {
    const { create } = factory();
    const tiles = new WaveformTiles(create);
    for (const column of [0, 1, 37, 255, 256, 300, 700]) {
      const shown = view(column / 128);
      expect(tiled(tiles, wave, shown), `from column ${column}`).toEqual(direct(wave, shown));
    }
  });

  it('shows nothing before the start and beyond what is analysed', () => {
    const { create } = factory();
    const tiles = new WaveformTiles(create);
    for (const shown of [view(-1), view(3, 3.5), view(9.5)]) {
      expect(tiled(tiles, wave, shown)).toEqual(direct(wave, shown));
    }
  });

  it('draws a tile when it comes into view, and once more when the playhead reaches it', () => {
    const { made, create } = factory();
    const tiles = new WaveformTiles(create);
    tiled(tiles, wave, view(0));
    // Played: the first tile, ahead: both (the view spans one tile and starts on one).
    expect(made).toHaveLength(2);
    // A few columns on: the second tile shows too, ahead.
    tiled(tiles, wave, view(5 / 128));
    expect(made).toHaveLength(3);
    tiled(tiles, wave, view(6 / 128));
    tiled(tiles, wave, view(7 / 128));
    expect(made).toHaveLength(3);
    // Half a view on, the playhead reaches the second tile: its played version is drawn.
    tiled(tiles, wave, view(1 + 1 / 128));
    expect(made).toHaveLength(4);
  });

  it('keeps its tiles while the ends of the view move by rounding errors', () => {
    const { made, create } = factory();
    const tiles = new WaveformTiles(create);
    const canvas = new Columns(WIDTH);
    for (let frame = 0; frame < 60; frame++) {
      // As the detail view has it: the playhead in the middle, the span around it.
      const at = 3.3 + frame * 0.0167;
      const shown = { from: at - 1.6, to: at + 1.6, played: at, available: 10 };
      tiles.draw(asContext(canvas), wave, shown, WIDTH, HEIGHT, 'rgb');
    }
    // About a second of play over 3.2 s across two tiles: a handful of tiles, not one a frame.
    expect(made.length).toBeLessThanOrEqual(6);
  });

  it('draws the tiles anew when the waveform grows or the zoom changes', () => {
    const { made, create } = factory();
    const tiles = new WaveformTiles(create);
    tiled(tiles, wave, view(0, 5));
    const before = made.length;
    tiled(tiles, wave, view(0, 6));
    expect(made.length).toBeGreaterThan(before);
    const zoomed = made.length;
    const canvas = new Columns(WIDTH);
    const shown = { from: 0, to: 4, played: 2, available: 10 };
    tiles.draw(asContext(canvas), wave, shown, WIDTH, HEIGHT, 'rgb');
    expect(made.length).toBeGreaterThan(zoomed);
  });

  it('keeps a bounded number of tiles while the view moves through the track', () => {
    const { made, create } = factory();
    const tiles = new WaveformTiles(create);
    for (let column = 0; column < 1280; column += 3) tiled(tiles, wave, view(column / 128));
    const kept = (tiles as unknown as { tiles: Map<string, unknown> }).tiles.size;
    expect(kept).toBeLessThanOrEqual(4 * (Math.ceil(WIDTH / TILE_COLUMNS) + 2));
    // Each tile of the 10 s is drawn ahead and played once, not once a frame.
    expect(made.length).toBeLessThanOrEqual(2 * Math.ceil((10 * 128) / TILE_COLUMNS) + 2);
  });
});
