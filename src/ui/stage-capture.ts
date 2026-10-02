import { getContext, setContext } from 'svelte';
import { writable, type Readable } from 'svelte/store';
import type { Renderer } from '../core/render/renderer';

/**
 * The picture on the stage, e.g. for a thumbnail (EX-10): the visual stage lends its renderer
 * while it shows the visuals.
 */
export class StageCapture {
  private renderer: Renderer | null = null;
  private readonly attached = writable(false);

  /** Whether the visuals are on the stage to take a picture of (a Svelte store). */
  get ready(): Readable<boolean> {
    return { subscribe: this.attached.subscribe };
  }

  attach(renderer: Renderer | null): void {
    this.renderer = renderer;
    this.attached.set(renderer !== null);
  }

  /** The next frame, scaled to `width` × `height`, as a PNG. */
  picture(width: number, height: number): Promise<Blob> {
    if (!this.renderer) {
      return Promise.reject(new Error('Switch to Logo Spectrum or Kaleidoscope first.'));
    }
    return this.renderer.capture(width, height);
  }
}

const KEY = Symbol('stage-capture');

export function provideCapture(capture: StageCapture): void {
  setContext(KEY, capture);
}

export function useCapture(): StageCapture {
  const capture = getContext<StageCapture | undefined>(KEY);
  if (!capture) throw new Error('useCapture() outside of the app shell');
  return capture;
}
