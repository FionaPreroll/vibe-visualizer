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

export function drawWaveform(
  context: CanvasRenderingContext2D,
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
  context: CanvasRenderingContext2D,
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
