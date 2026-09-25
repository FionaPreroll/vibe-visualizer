import { exposeWorker } from '../../core/util/worker-rpc';
import { KaleidoFeedbackScene, syntheticFeatures } from './kaleido-scene';

export interface LiveResult {
  frames: number;
  averageFps: number;
  onePercentLowFps: number;
  averageCpuMs: number;
  floatTargets: boolean;
  glErrors: number;
  contextLost: boolean;
}

export interface OfflineResult {
  frames: number;
  fps: number;
  elapsedMs: number;
  floatTargets: boolean;
  glErrors: number;
  contextLost: boolean;
}

function createContext(canvas: OffscreenCanvas) {
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', () => (contextLost = true));
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available in this worker');
  return { gl, isLost: () => contextLost };
}

function countErrors(gl: WebGL2RenderingContext): number {
  let errors = 0;
  while (gl.getError() !== gl.NO_ERROR && errors < 100) errors++;
  return errors;
}

/** Renders into the page's canvas for `seconds`, paced by requestAnimationFrame. */
function live(
  args: { canvas: OffscreenCanvas; width: number; height: number; seconds: number },
  progress: (fps: number) => void,
): Promise<LiveResult> {
  args.canvas.width = args.width;
  args.canvas.height = args.height;
  const { gl, isLost } = createContext(args.canvas);
  const scene = new KaleidoFeedbackScene(gl, args.width, args.height);
  const intervals: number[] = [];
  let cpuMs = 0;
  let first = -1;
  let last = 0;
  let lastProgress = 0;

  return new Promise((resolve) => {
    const frame = (now: number) => {
      if (first < 0) {
        first = now;
        last = now;
      }
      const time = (now - first) / 1000;
      const dt = (now - last) / 1000;
      if (now > last) intervals.push(now - last);
      last = now;

      const cpuStart = performance.now();
      scene.render(time, dt, syntheticFeatures(time));
      cpuMs += performance.now() - cpuStart;

      if (now - lastProgress > 1000 && intervals.length > 10) {
        lastProgress = now;
        const recent = intervals.slice(-30);
        progress(1000 / (recent.reduce((a, b) => a + b, 0) / recent.length));
      }
      if (time < args.seconds && !isLost()) {
        requestAnimationFrame(frame);
        return;
      }
      const sorted = [...intervals].sort((a, b) => b - a);
      const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 100)));
      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      resolve({
        frames: intervals.length,
        averageFps: 1000 / mean(intervals),
        onePercentLowFps: 1000 / mean(worst),
        averageCpuMs: cpuMs / (intervals.length + 1),
        floatTargets: scene.floatTargets,
        glErrors: countErrors(gl),
        contextLost: isLost(),
      });
    };
    requestAnimationFrame(frame);
  });
}

/** Renders `frames` frames off screen as fast as possible, like an export would. */
function offline(args: {
  width: number;
  height: number;
  frames: number;
  fps: number;
}): OfflineResult {
  const canvas = new OffscreenCanvas(args.width, args.height);
  const { gl, isLost } = createContext(canvas);
  const scene = new KaleidoFeedbackScene(gl, args.width, args.height);
  let glErrors = 0;
  const start = performance.now();
  for (let i = 0; i < args.frames && !isLost(); i++) {
    const time = i / args.fps;
    scene.render(time, 1 / args.fps, syntheticFeatures(time));
    // Grabbing a VideoFrame waits for the GPU, like handing the frame to an encoder.
    const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1e6) });
    frame.close();
    if (i % 30 === 0) glErrors += countErrors(gl);
  }
  const elapsedMs = performance.now() - start;
  glErrors += countErrors(gl);
  const result: OfflineResult = {
    frames: args.frames,
    fps: args.frames / (elapsedMs / 1000),
    elapsedMs,
    floatTargets: scene.floatTargets,
    glErrors,
    contextLost: isLost(),
  };
  scene.dispose();
  return result;
}

exposeWorker({ live, offline });
