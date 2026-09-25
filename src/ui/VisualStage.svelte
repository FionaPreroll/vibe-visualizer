<script lang="ts">
  import { onMount } from 'svelte';
  import type { ImageKind } from '../core/render/logo-spectrum';
  import { Renderer } from '../core/render/renderer';
  import { decodeImage, type StoredImage } from '../core/render/visual-assets';
  import { usePlayer } from './player-context';
  import { useAssets } from './visuals-context';

  /**
   * The Logo Spectrum visuals (M2), drawn by the render worker at the canvas's native
   * resolution (VE-01). Settings and images are forwarded as they change.
   */

  const player = usePlayer();
  const assets = useAssets();
  const app = player.store;
  let canvas: HTMLCanvasElement;
  let status = $state<'starting' | 'running' | 'failed'>('starting');
  let message = $state('');
  let fps = $state(0);

  onMount(() => {
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      return [
        Math.max(1, Math.round(canvas.clientWidth * ratio)),
        Math.max(1, Math.round(canvas.clientHeight * ratio)),
      ] as const;
    };
    const [width, height] = size();
    const renderer = new Renderer(canvas, player.engine, width, height);
    renderer.onEvent = (event) => {
      if (event.type === 'ready') status = 'running';
      else if (event.type === 'stats') fps = event.fps;
      else {
        status = 'failed';
        message = event.message;
      }
    };

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.devicePixelContentBoxSize?.[0];
      if (box) renderer.resize(box.inlineSize, box.blockSize);
      else renderer.resize(...size());
    });
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(canvas);
    }

    let lastVisuals = $app.visuals;
    renderer.setSettings(lastVisuals);
    const unsubscribeSettings = app.subscribe((state) => {
      if (state.visuals === lastVisuals) return;
      lastVisuals = state.visuals;
      renderer.setSettings(state.visuals);
    });

    // Decode images off the render thread's path; skip results that were replaced meanwhile.
    const shown: Record<ImageKind, StoredImage | null | undefined> = {
      background: undefined,
      logo: undefined,
    };
    const unsubscribeAssets = assets.subscribe((images) => {
      for (const kind of ['background', 'logo'] as const) {
        const image = images[kind];
        if (image === shown[kind]) continue;
        shown[kind] = image;
        if (!image) {
          renderer.setImage(kind, null);
          continue;
        }
        decodeImage(image.blob)
          .then((bitmap) => {
            if (shown[kind] === image) renderer.setImage(kind, bitmap);
            else bitmap.close();
          })
          .catch(() => renderer.setImage(kind, null));
      }
    });

    const onVisibility = () => renderer.setRunning(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribeSettings();
      unsubscribeAssets();
      observer.disconnect();
      renderer.dispose();
    };
  });
</script>

<canvas
  bind:this={canvas}
  data-testid="visual-stage"
  data-status={status}
  data-fps={fps.toFixed(0)}
  aria-label="Logo Spectrum visuals"
></canvas>
{#if status === 'failed'}
  <p class="failed" role="alert">The visuals could not start: {message}</p>
{/if}

<style>
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    background: #07070c;
  }
  .failed {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    margin: 0;
    padding: 8px 14px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--fail) 22%, var(--surface));
    border: 1px solid var(--fail);
  }
</style>
