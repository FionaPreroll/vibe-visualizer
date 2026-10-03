import type { KaleidoSettings } from './kaleido-settings';
import type { ImageKind } from './logo-spectrum';
import type { OverlaySettings, OverlayTrack } from './overlay-settings';
import type { AutoPresets } from './preset-director';
import type { LogoSpectrumSettings } from './visual-settings';

/** The scenes the render worker can show. */
export type SceneKind = 'logoSpectrum' | 'kaleidoscope';

/** A file of the engine's stream, by its token: its track for the overlay, and how it moves. */
export interface StreamTrack {
  token: number;
  track: OverlayTrack | null;
  /**
   * How loud the file gets is still being found out (its analysis runs, AN-05): until then, the
   * picture does not move with the music (no shake, no zoom or pulse on the bass), so a quiet
   * start of it does not swing too far.
   */
  calm: boolean;
}

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
  /** The track overlay over both scenes (LS-18, LS-19). */
  | { type: 'overlay'; settings: OverlaySettings }
  /**
   * The files of the stream, the one heard and the one that follows, by the engine's token,
   * and the tempo they play at: the overlay shows the file the music being heard comes from
   * (null: not known yet).
   */
  | { type: 'tracks'; tracks: StreamTrack[]; rate: number }
  /** The cover art of the file with `token` (null: none). */
  | { type: 'cover'; token: number; image: ImageBitmap | null }
  /** The Logo Spectrum shows the cover art of the track heard as its logo (LS-15). */
  | { type: 'coverLogo'; on: boolean }
  /**
   * The audio clock: `contextTime` is heard at `performanceTime` (epoch milliseconds). With
   * `live` input the newest analysis frame is shown instead.
   */
  | { type: 'clock'; contextTime: number; performanceTime: number; live: boolean }
  | { type: 'running'; running: boolean }
  /** The picture of the next frame, scaled to `width` × `height`, as a PNG (EX-10). */
  | { type: 'capture'; id: number; width: number; height: number }
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
  /** The picture asked for with the same `id`; null and why if there is none. */
  | { type: 'capture'; id: number; png: Blob | null; message?: string }
  | { type: 'error'; message: string };
