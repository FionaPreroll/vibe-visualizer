/** A browser feature the app cannot run without (NF-02), and what needs it. */
export interface Requirement {
  feature: string;
  use: string;
}

/**
 * The features this browser lacks of those the app cannot run without; none: it can run.
 * WebGL 2 is tried for real, as a browser can have it and still refuse it (graphics
 * acceleration turned off, or a graphics card it does not trust).
 */
export function missingRequirements(scope: typeof globalThis = globalThis): Requirement[] {
  const missing: Requirement[] = [];
  if (!scope.crossOriginIsolated || typeof scope.SharedArrayBuffer !== 'function') {
    missing.push({
      feature: 'SharedArrayBuffer (cross-origin isolation)',
      use: 'the audio engine shares its buffers between threads',
    });
  }
  if (typeof scope.AudioWorkletNode !== 'function') {
    missing.push({ feature: 'AudioWorklet', use: 'the sound is played and analysed in it' });
  }
  const offscreen =
    typeof scope.OffscreenCanvas === 'function' &&
    typeof scope.HTMLCanvasElement === 'function' &&
    'transferControlToOffscreen' in scope.HTMLCanvasElement.prototype;
  if (!offscreen) {
    missing.push({ feature: 'OffscreenCanvas', use: 'the visuals are drawn in a worker' });
  } else if (!webGl2(scope)) {
    missing.push({ feature: 'WebGL 2', use: 'the visuals are drawn with it' });
  }
  return missing;
}

function webGl2(scope: typeof globalThis): boolean {
  try {
    const gl = new scope.OffscreenCanvas(1, 1).getContext('webgl2');
    // Given back at once: browsers keep only a few contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}
