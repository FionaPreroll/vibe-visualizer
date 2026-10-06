import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAVEFORM_RATE, WAVEFORM_STRIDE, type Waveform } from '../core/analysis/waveform';
import type { WaveformStyle } from '../core/state/app-state';
import {
  drawWaveform,
  STRIP_MARGIN,
  WaveformStrip,
  type StripCanvas,
  type WaveformView,
} from './waveform-draw';

/** A path that keeps its rectangles (the "bands" style fills one path per colour). */
class Path {
  readonly rects: [number, number, number, number][] = [];
  rect(x: number, y: number, width: number, height: number): void {
    this.rects.push([x, y, width, height]);
  }
}

/**
 * A canvas that keeps, per pixel column, what was drawn there: each fill with its colour and
 * rectangle, in order. Copies between canvases at whole pixels carry the columns over; the
 * others (shifted by a fraction of a pixel) and the fills that only darken what is there are
 * kept as they were asked for.
 */
class Columns {
  readonly columns: (string | null)[];
  fillStyle = '';
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  /** Copies drawn into this canvas. */
  readonly copies: { sx: number; width: number; dx: number }[] = [];
  /** Fills that change what is there instead of drawing over it. */
  readonly shades: { x: number; width: number; operation: string; style: string }[] = [];
  /** Waveform columns drawn into this canvas (one per column and layer). */
  drawn = 0;
  private offset = 0;
  private readonly saved: { offset: number; operation: string; style: string }[] = [];

  constructor(width: number) {
    this.columns = Array.from({ length: width }, () => null);
  }
  save(): void {
    const { offset, globalCompositeOperation: operation, fillStyle: style } = this;
    this.saved.push({ offset, operation, style });
  }
  restore(): void {
    const state = this.saved.pop()!;
    this.offset = state.offset;
    this.globalCompositeOperation = state.operation;
    this.fillStyle = state.style;
  }
  translate(x: number): void {
    this.offset += x;
  }
  clearRect(x: number, _y: number, width: number): void {
    for (let i = x + this.offset; i < x + this.offset + width; i++) {
      if (i in this.columns) this.columns[i] = null;
    }
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    if (this.globalCompositeOperation !== 'source-over') {
      this.shades.push({
        x,
        width,
        operation: this.globalCompositeOperation,
        style: this.fillStyle,
      });
      return;
    }
    for (let i = x; i < x + width; i++) this.paint(i, y, height);
  }
  fill(path: Path): void {
    for (const [x, y, , height] of path.rects) this.paint(x, y, height);
  }
  drawImage(source: Columns, sx: number, _sy: number, width: number, _sh: number, dx: number) {
    this.copies.push({ sx, width, dx });
    if (!Number.isInteger(dx)) return;
    for (let i = 0; i < width; i++) {
      const at = dx + this.offset + i;
      if (at in this.columns) this.columns[at] = source.columns[sx + i] ?? null;
    }
  }
  private paint(x: number, y: number, height: number): void {
    const at = x + this.offset;
    if (!(at in this.columns)) return;
    const fill = `${this.fillStyle} ${y.toFixed(3)} ${height.toFixed(3)}`;
    this.columns[at] = this.columns[at] ? `${this.columns[at]} | ${fill}` : fill;
    this.drawn++;
  }
}

const asContext = (canvas: Columns) => canvas as unknown as CanvasRenderingContext2D;

/** The canvases a strip makes, through the factory it is given. */
function factory() {
  const made: Columns[] = [];
  const create = (width: number): StripCanvas => {
    const canvas = new Columns(width);
    made.push(canvas);
    return { canvas: canvas as unknown as CanvasImageSource, context: asContext(canvas) };
  };
  /** Waveform columns drawn into the strips so far. */
  const drawn = () => made.reduce((sum, canvas) => sum + canvas.drawn, 0);
  return { made, create, drawn };
}

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

/** The view from `from` on, all of it played unless said otherwise. */
function view(from: number, available = 10, played = Infinity): WaveformView {
  return { from, to: from + SPAN, played, available };
}

function direct(wave: Waveform, shown: WaveformView, style: WaveformStyle): (string | null)[] {
  const canvas = new Columns(WIDTH);
  drawWaveform(asContext(canvas), wave, shown, WIDTH, HEIGHT, style);
  return canvas.columns;
}

function viaStrip(
  strip: WaveformStrip,
  wave: Waveform,
  shown: WaveformView,
  style: WaveformStyle = 'rgb',
): Columns {
  const canvas = new Columns(WIDTH);
  strip.draw(asContext(canvas), wave, shown, WIDTH, HEIGHT, style);
  return canvas;
}

describe('the detail waveform from a strip (TR-08)', () => {
  const wave = waveform(10);
  beforeEach(() => vi.stubGlobal('Path2D', Path));
  afterEach(() => vi.unstubAllGlobals());

  for (const style of ['rgb', 'bands'] as const) {
    it(`shows what drawing it directly shows, where a view starts on a column (${style})`, () => {
      const strip = new WaveformStrip(factory().create);
      // Forwards in small and large steps, a jump, and back.
      for (const column of [0, 1, 37, 255, 256, 300, 700, 1100, 650, 20]) {
        const shown = view(column / 128);
        expect(viaStrip(strip, wave, shown, style).columns, `from column ${column}`).toEqual(
          direct(wave, shown, style),
        );
      }
    });
  }

  it('shows nothing before the start and beyond what is analysed', () => {
    for (const shown of [view(-1), view(3, 3.5), view(9.5)]) {
      const strip = new WaveformStrip(factory().create);
      expect(viaStrip(strip, wave, shown).columns).toEqual(direct(wave, shown, 'rgb'));
    }
  });

  it('glides: a view between two columns is copied shifted by the fraction', () => {
    const strip = new WaveformStrip(factory().create);
    const canvas = viaStrip(strip, wave, view(37.25 / 128));
    expect(canvas.copies).toHaveLength(1);
    const [copy] = canvas.copies;
    expect(copy!.dx).toBeCloseTo(-0.25, 9);
    // One column more than the view, so the shifted copy fills it.
    expect(copy!.width).toBe(WIDTH + 1);
    expect(canvas.imageSmoothingEnabled).toBe(true);
  });

  it('darkens the bands ahead of the playhead, and makes the RGB fainter there', () => {
    const strip = new WaveformStrip(factory().create);
    const bands = viaStrip(strip, wave, view(3, 10, 4), 'bands');
    expect(bands.shades).toEqual([
      { x: 128, width: 128, operation: 'source-atop', style: 'rgba(0,0,0,0.47)' },
    ]);
    const rgb = viaStrip(strip, wave, view(3, 10, 3.5), 'rgb');
    expect(rgb.shades).toEqual([
      { x: 64, width: 192, operation: 'destination-out', style: 'rgba(0,0,0,0.55)' },
    ]);
    // All played: nothing to darken.
    expect(viaStrip(strip, wave, view(3), 'rgb').shades).toEqual([]);
  });

  it('makes its two canvases once, and draws only the columns that come into view', () => {
    const { made, create, drawn } = factory();
    const strip = new WaveformStrip(create);
    // Ten seconds of playback at 60 frames a second, the playhead in the middle.
    for (let frame = 0; frame < 600; frame++) {
      const at = 2 + frame / 60;
      viaStrip(strip, wave, { from: at - 1, to: at + 1, played: at, available: 10 });
    }
    expect(made).toHaveLength(2);
    // The first strip, then the 1280 columns the view moved on, and a margin of each move.
    const first = WIDTH + 1 + 2 * STRIP_MARGIN;
    expect(drawn()).toBeGreaterThanOrEqual(first);
    expect(drawn()).toBeLessThanOrEqual(first + 1280 + STRIP_MARGIN);
  });

  it('keeps its strip while the ends of the view move by rounding errors', () => {
    const { create, drawn } = factory();
    const strip = new WaveformStrip(create);
    viaStrip(strip, wave, { from: 1.7, to: 4.9, played: 3.3, available: 10 });
    const first = drawn();
    for (let frame = 1; frame < 60; frame++) {
      // As the detail view has it: the span around the playhead.
      const at = 3.3 + frame * 0.0167;
      viaStrip(strip, wave, { from: at - 1.6, to: at + 1.6, played: at, available: 10 });
    }
    // A second of play moves the view by about 80 columns: within the margin, nothing is drawn.
    expect(drawn()).toBe(first);
  });

  it('draws the strip anew when the waveform grows, the zoom or the style changes', () => {
    const { create, drawn } = factory();
    const strip = new WaveformStrip(create);
    viaStrip(strip, wave, view(1, 5));
    let before = drawn();
    viaStrip(strip, wave, view(1, 6));
    expect(drawn()).toBeGreaterThan(before);
    before = drawn();
    const canvas = new Columns(WIDTH);
    strip.draw(
      asContext(canvas),
      wave,
      { from: 1, to: 5, played: 3, available: 6 },
      WIDTH,
      HEIGHT,
      'rgb',
    );
    expect(drawn()).toBeGreaterThan(before);
    before = drawn();
    strip.draw(
      asContext(canvas),
      wave,
      { from: 1, to: 5, played: 3, available: 6 },
      WIDTH,
      HEIGHT,
      'bands',
    );
    expect(drawn()).toBeGreaterThan(before);
  });

  it('makes new canvases when the view changes size', () => {
    const { made, create } = factory();
    const strip = new WaveformStrip(create);
    viaStrip(strip, wave, view(1));
    const canvas = new Columns(WIDTH * 2);
    strip.draw(
      asContext(canvas),
      wave,
      { from: 1, to: 3, played: 2, available: 10 },
      WIDTH * 2,
      HEIGHT,
      'rgb',
    );
    expect(made).toHaveLength(4);
    expect(made[2]!.columns).toHaveLength(WIDTH * 2 + 1 + 2 * STRIP_MARGIN);
  });
});
