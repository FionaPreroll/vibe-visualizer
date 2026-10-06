import { reportProblem } from './problems';

/** Called once per animation frame, with the frame's time (as requestAnimationFrame gives it). */
export type FrameCallback = (now: number) => void;

/**
 * The live parts of the UI (the playhead, the detail waveform, the meters, the analysis) share
 * one animation frame loop instead of each running its own. It runs while one of them listens,
 * and stops when the last goes. A part that throws is reported and stops; the others go on.
 */
const callbacks = new Set<FrameCallback>();
let request = 0;

function frame(now: number): void {
  request = requestAnimationFrame(frame);
  for (const callback of callbacks) {
    try {
      callback(now);
    } catch (error) {
      callbacks.delete(callback);
      reportProblem(error, 'The display');
    }
  }
  if (callbacks.size === 0) stop();
}

function stop(): void {
  cancelAnimationFrame(request);
  request = 0;
}

/** Calls `callback` on every animation frame from the next one on; returns what stops it. */
export function onFrame(callback: FrameCallback): () => void {
  callbacks.add(callback);
  if (request === 0) request = requestAnimationFrame(frame);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && request !== 0) stop();
  };
}
