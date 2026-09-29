import { summarise, type Waveform } from '../core/analysis/waveform';

/**
 * Draws a waveform (TR-03, TR-08) into a 2D canvas: one column per pixel, mirrored around the
 * middle, its height from the peak and its colour from the bands (lows red, mids green, highs
 * blue, as on DJ software). What has been played is drawn brighter.
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

export function drawWaveform(
  context: CanvasRenderingContext2D,
  waveform: Waveform | null,
  view: WaveformView,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  if (!waveform || width <= 0 || view.to <= view.from) return;
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
    const alpha = from < view.played ? 1 : 0.45;
    context.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
    const half = Math.max(0.5, peak * middle);
    context.fillRect(x, middle - half, 1, 2 * half);
  }
}
