import type { KaleidoSettings } from './kaleido-settings';
import type { ImageKind } from './logo-spectrum';
import type { LogoSpectrumSettings } from './visual-settings';

/** The scenes the render worker can show. */
export type SceneKind = 'logoSpectrum' | 'kaleidoscope';

/** Messages from the main thread to the render worker. */
export type RenderRequest =
  | { type: 'init'; canvas: OffscreenCanvas; timeline: SharedArrayBuffer; sampleRate: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'scene'; scene: SceneKind }
  | { type: 'logoSpectrum'; settings: LogoSpectrumSettings }
  | { type: 'kaleidoscope'; settings: KaleidoSettings }
  | { type: 'image'; kind: ImageKind; image: ImageBitmap | null }
  /** The audio clock: `contextTime` is heard at `performanceTime` (epoch milliseconds). */
  | { type: 'clock'; contextTime: number; performanceTime: number }
  | { type: 'running'; running: boolean }
  | { type: 'dispose' };

/** Messages from the render worker. */
export type RenderEvent =
  | { type: 'ready'; floatTargets: boolean }
  | { type: 'stats'; fps: number; frames: number }
  | { type: 'error'; message: string };
