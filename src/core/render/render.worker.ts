import { FeatureTimelineReader } from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { LogoSpectrumScene } from './logo-spectrum';
import type { RenderEvent, RenderRequest } from './render-protocol';

/**
 * Draws the visuals on an OffscreenCanvas, off the main thread (TECH-STACK: renderer). Each
 * frame it looks up the analysis frame for the moment you hear, from the shared feature
 * timeline and the audio clock sent by the main thread.
 */

/** The parts of the dedicated worker scope used here (the project compiles with the DOM lib). */
const scope = self as unknown as {
  postMessage(message: RenderEvent): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RenderRequest>) => void): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  close(): void;
};

let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let scene: LogoSpectrumScene | null = null;
let reader: FeatureTimelineReader | null = null;
let sampleRate = 48000;
let clock: { contextTime: number; performanceTime: number } | null = null;
let running = false;
let request = 0;
let lastTime = -1;
let startTime = -1;
let frames = 0;
let statsStart = 0;
let statsFrames = 0;
let lost = false;
const features = new Float32Array(F.size);

function post(event: RenderEvent): void {
  scope.postMessage(event);
}

function audibleFrame(now: number): number | null {
  if (!clock) return null;
  const epoch = performance.timeOrigin + now;
  return (clock.contextTime + (epoch - clock.performanceTime) / 1000) * sampleRate;
}

function frame(now: number): void {
  request = 0;
  if (!running || !scene || lost) return;
  if (startTime < 0) startTime = now;
  const dt = lastTime < 0 ? 1 / 60 : (now - lastTime) / 1000;
  lastTime = now;

  const at = audibleFrame(now);
  if (at === null || !reader || reader.sample(at, features) === null) features.fill(0);
  try {
    scene.render({ time: (now - startTime) / 1000, dt, features });
  } catch (error) {
    running = false;
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    return;
  }
  frames++;
  statsFrames++;
  if (now - statsStart >= 1000) {
    post({ type: 'stats', fps: (statsFrames * 1000) / (now - statsStart), frames });
    statsStart = now;
    statsFrames = 0;
  }
  request = scope.requestAnimationFrame(frame);
}

function setRunning(value: boolean): void {
  running = value;
  if (running && !request && scene) {
    lastTime = -1;
    statsStart = performance.now();
    statsFrames = 0;
    request = scope.requestAnimationFrame(frame);
  }
  if (!running && request) {
    scope.cancelAnimationFrame(request);
    request = 0;
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init': {
        canvas = message.canvas;
        sampleRate = message.sampleRate;
        reader = new FeatureTimelineReader(message.timeline);
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          lost = true;
          post({ type: 'error', message: 'The graphics context was lost.' });
        });
        gl = canvas.getContext('webgl2', {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
        });
        if (!gl) throw new Error('WebGL2 is not available.');
        scene = new LogoSpectrumScene(gl);
        scene.resize(canvas.width, canvas.height);
        post({ type: 'ready', floatTargets: scene.floatTargets });
        setRunning(running);
        break;
      }
      case 'resize':
        if (canvas && scene) {
          canvas.width = Math.max(1, message.width);
          canvas.height = Math.max(1, message.height);
          scene.resize(canvas.width, canvas.height);
        }
        break;
      case 'settings':
        scene?.setSettings(message.settings);
        break;
      case 'image':
        scene?.setImage(message.kind, message.image);
        message.image?.close();
        break;
      case 'clock':
        clock = { contextTime: message.contextTime, performanceTime: message.performanceTime };
        break;
      case 'running':
        setRunning(message.running);
        break;
      case 'dispose':
        setRunning(false);
        scene?.dispose();
        scene = null;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        scope.close();
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
