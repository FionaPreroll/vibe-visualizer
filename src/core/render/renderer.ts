import { AudioEngine } from '../audio/engine/audio-engine';
import type { KaleidoSettings } from './kaleido-settings';
import type { ImageKind } from './logo-spectrum';
import type { OverlaySettings, OverlayTrack } from './overlay-settings';
import type { AutoPresets } from './preset-director';
import type { RenderEvent, RenderRequest, SceneKind } from './render-protocol';
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

  /** Switches the scene shown; both keep their state. */
  setScene(scene: SceneKind): void {
    this.send({ type: 'scene', scene });
  }

  setLogoSpectrum(settings: LogoSpectrumSettings): void {
    this.send({ type: 'logoSpectrum', settings });
  }

  setKaleidoscope(settings: KaleidoSettings): void {
    this.send({ type: 'kaleidoscope', settings });
  }

  /** Automatic preset switching and the presets of each mode that take part (PR-02). */
  setAutoPresets(
    config: AutoPresets,
    logoSpectrum: LogoSpectrumSettings[],
    kaleidoscope: KaleidoSettings[],
  ): void {
    this.send({ type: 'autoPresets', config, logoSpectrum, kaleidoscope });
  }

  /** Reduce flashing (VE-06). */
  setReduceFlashing(on: boolean): void {
    this.send({ type: 'reduceFlashing', on });
  }

  /** The track overlay (LS-18, LS-19). */
  setOverlay(settings: OverlaySettings): void {
    this.send({ type: 'overlay', settings });
  }

  /** The tracks of the files in the stream, by the engine's token, and their tempo. */
  setTracks(tracks: { token: number; track: OverlayTrack | null }[], rate: number): void {
    this.send({ type: 'tracks', tracks, rate });
  }

  /** The cover art of the file with `token` (the bitmap is transferred). */
  setCover(token: number, image: ImageBitmap | null): void {
    this.send({ type: 'cover', token, image }, image ? [image] : []);
  }

  /** Shows the cover art of the track heard as the Logo Spectrum's logo (LS-15). */
  setCoverLogo(on: boolean): void {
    this.send({ type: 'coverLogo', on });
  }

  /** Hands an image to the worker (the bitmap is transferred and must not be used afterwards). */
  setImage(kind: ImageKind, image: ImageBitmap | null): void {
    this.send({ type: 'image', kind, image }, image ? [image] : []);
  }

  setRunning(running: boolean): void {
    this.send({ type: 'running', running });
  }

  /** Stops the worker; `now` when the page goes away and there is no moment left to wait. */
  dispose(now = false): void {
    if (this.disposed) return;
    clearInterval(this.clockTimer);
    this.send({ type: 'dispose' });
    this.disposed = true;
    if (now) {
      this.worker.terminate();
      return;
    }
    // Give the worker a moment to release the GPU context, then stop it for sure.
    setTimeout(() => this.worker.terminate(), 1000);
  }

  private sendClock(): void {
    const clock = this.engine.outputClock();
    if (clock) this.send({ type: 'clock', ...clock, live: this.engine.live });
  }

  private send(message: RenderRequest, transfer: Transferable[] = []): void {
    if (!this.disposed) this.worker.postMessage(message, transfer);
  }
}
