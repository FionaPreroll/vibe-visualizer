import { AudioEngine } from '../audio/engine/audio-engine';
import type { ImageKind } from './logo-spectrum';
import type { RenderEvent, RenderRequest } from './render-protocol';
import RenderWorker from './render.worker.ts?worker';
import type { LogoSpectrumSettings } from './visual-settings';

/**
 * Main-thread face of the render worker: hands it the canvas, the feature timeline and the
 * audio clock, and forwards settings and images.
 */
export class Renderer {
  private readonly worker = new RenderWorker();
  private readonly engine: AudioEngine;
  private readonly clockTimer: ReturnType<typeof setInterval>;
  private disposed = false;
  /** Called for every event of the worker (ready, stats, errors). */
  onEvent: ((event: RenderEvent) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, engine: AudioEngine, width: number, height: number) {
    this.engine = engine;
    const offscreen = canvas.transferControlToOffscreen();
    offscreen.width = Math.max(1, width);
    offscreen.height = Math.max(1, height);
    this.worker.addEventListener('message', (event: MessageEvent<RenderEvent>) => {
      this.onEvent?.(event.data);
    });
    this.worker.addEventListener('error', (event) => {
      this.onEvent?.({ type: 'error', message: event.message || 'The render worker failed.' });
    });
    this.send(
      {
        type: 'init',
        canvas: offscreen,
        timeline: engine.timelineBuffer,
        sampleRate: AudioEngine.SAMPLE_RATE,
      },
      [offscreen],
    );
    // The worker extrapolates the audio clock between updates.
    this.sendClock();
    this.clockTimer = setInterval(() => this.sendClock(), 250);
  }

  resize(width: number, height: number): void {
    this.send({ type: 'resize', width: Math.round(width), height: Math.round(height) });
  }

  setSettings(settings: LogoSpectrumSettings): void {
    this.send({ type: 'settings', settings });
  }

  /** Hands an image to the worker (the bitmap is transferred and must not be used afterwards). */
  setImage(kind: ImageKind, image: ImageBitmap | null): void {
    this.send({ type: 'image', kind, image }, image ? [image] : []);
  }

  setRunning(running: boolean): void {
    this.send({ type: 'running', running });
  }

  dispose(): void {
    if (this.disposed) return;
    clearInterval(this.clockTimer);
    this.send({ type: 'dispose' });
    this.disposed = true;
    // Give the worker a moment to release the GPU context, then stop it for sure.
    setTimeout(() => this.worker.terminate(), 1000);
  }

  private sendClock(): void {
    const clock = this.engine.outputClock();
    if (clock) this.send({ type: 'clock', ...clock });
  }

  private send(message: RenderRequest, transfer: Transferable[] = []): void {
    if (!this.disposed) this.worker.postMessage(message, transfer);
  }
}
