import type { KaleidoSettings } from './kaleido-settings';
import type { ImageKind } from './logo-spectrum';
import type { AutoPresets } from './preset-director';
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
  /** Automatic preset switching (PR-02), and the presets of each mode that take part. */
  | {
      type: 'autoPresets';
      config: AutoPresets;
      logoSpectrum: LogoSpectrumSettings[];
      kaleidoscope: KaleidoSettings[];
    }
  | { type: 'image'; kind: ImageKind; image: ImageBitmap | null }
  /** Reduce flashing (VE-06), for both scenes. */
  | { type: 'reduceFlashing'; on: boolean }
  /**
   * The audio clock: `contextTime` is heard at `performanceTime` (epoch milliseconds). With
   * `live` input the newest analysis frame is shown instead.
   */
  | { type: 'clock'; contextTime: number; performanceTime: number; live: boolean }
  | { type: 'running'; running: boolean }
  | { type: 'dispose' };

/** Messages from the render worker. */
export type RenderEvent =
  | { type: 'ready'; floatTargets: boolean }
  | { type: 'stats'; fps: number; frames: number }
  /** The switching moved on to another preset (it morphs there now). */
  | {
      type: 'preset';
      scene: 'logoSpectrum';
      settings: LogoSpectrumSettings;
    }
  | {
      type: 'preset';
      scene: 'kaleidoscope';
      settings: KaleidoSettings;
    }
  | { type: 'error'; message: string };
