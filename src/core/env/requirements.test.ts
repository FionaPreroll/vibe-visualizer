import { describe, expect, it } from 'vitest';
import { missingRequirements } from './requirements';

/** A browser with everything, but for what `without` takes away. */
function browser(without: Partial<Record<string, unknown>> = {}, webgl2 = true): typeof globalThis {
  class Canvas {
    transferControlToOffscreen() {}
  }
  class Offscreen {
    getContext(kind: string) {
      return kind === 'webgl2' && webgl2 ? { getExtension: () => null } : null;
    }
  }
  return {
    crossOriginIsolated: true,
    SharedArrayBuffer,
    AudioWorkletNode: class {},
    OffscreenCanvas: Offscreen,
    HTMLCanvasElement: Canvas,
    ...without,
  } as unknown as typeof globalThis;
}

const features = (scope: typeof globalThis) =>
  missingRequirements(scope).map((requirement) => requirement.feature);

describe('requirements', () => {
  it('are all met in a current browser', () => {
    expect(missingRequirements(browser())).toEqual([]);
  });

  it('need cross-origin isolation for SharedArrayBuffer', () => {
    expect(features(browser({ crossOriginIsolated: false }))).toEqual([
      'SharedArrayBuffer (cross-origin isolation)',
    ]);
    expect(features(browser({ SharedArrayBuffer: undefined }))).toEqual([
      'SharedArrayBuffer (cross-origin isolation)',
    ]);
  });

  it('need AudioWorklet and OffscreenCanvas', () => {
    expect(features(browser({ AudioWorkletNode: undefined, OffscreenCanvas: undefined }))).toEqual([
      'AudioWorklet',
      'OffscreenCanvas',
    ]);
  });

  it('try WebGL 2 for real', () => {
    expect(features(browser({}, false))).toEqual(['WebGL 2']);
  });
});
