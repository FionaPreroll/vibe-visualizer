<script lang="ts">
  import { onMount } from 'svelte';
  import type { ImageKind } from '../core/render/logo-spectrum';
  import type { SceneKind } from '../core/render/render-protocol';
  import { Renderer } from '../core/render/renderer';
  import { decodeImage, type StoredImage } from '../core/render/visual-assets';
  import { usePlayer } from './player-context';
  import { useAssets } from './visuals-context';

  /**
   * The visuals (Logo Spectrum or Kaleidoscope), drawn by the render worker at the canvas's
   * native resolution (VE-01). Switching between the two keeps the worker and both scenes;
   * settings and images are forwarded as they change.
   */
  interface Props {
    mode: SceneKind;
  }
  let { mode }: Props = $props();

  const player = usePlayer();
  const assets = useAssets();
  const app = player.store;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer | null = $state(null);
  let status = $state<'starting' | 'running' | 'failed'>('starting');
  let message = $state('');
  let fps = $state(0);

  $effect(() => {
    renderer?.setScene(mode);
  });

  onMount(() => {
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      return [
        Math.max(1, Math.round(canvas.clientWidth * ratio)),
        Math.max(1, Math.round(canvas.clientHeight * ratio)),
      ] as const;
    };
    const [width, height] = size();
    const instance = new Renderer(canvas, player.engine, width, height);
    // The first frame already shows the right scene (the effect takes over after mounting).
    instance.setScene(mode);
    instance.onEvent = (event) => {
      if (event.type === 'ready') status = 'running';
      else if (event.type === 'stats') fps = event.fps;
      else {
        status = 'failed';
        message = event.message;
      }
    };

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.devicePixelContentBoxSize?.[0];
      if (box) instance.resize(box.inlineSize, box.blockSize);
      else instance.resize(...size());
    });
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(canvas);
    }

    let lastVisuals = $app.visuals;
    let lastKaleido = $app.kaleido;
    instance.setLogoSpectrum(lastVisuals);
    instance.setKaleidoscope(lastKaleido);
    const unsubscribeSettings = app.subscribe((state) => {
      if (state.visuals !== lastVisuals) {
        lastVisuals = state.visuals;
        instance.setLogoSpectrum(state.visuals);
      }
      if (state.kaleido !== lastKaleido) {
        lastKaleido = state.kaleido;
        instance.setKaleidoscope(state.kaleido);
      }
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
          instance.setImage(kind, null);
          continue;
        }
        decodeImage(image.blob)
          .then((bitmap) => {
            if (shown[kind] === image) instance.setImage(kind, bitmap);
            else bitmap.close();
          })
          .catch(() => instance.setImage(kind, null));
      }
    });

    const onVisibility = () => instance.setRunning(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    // The effect above sends mode changes from now on (and the current mode right away).
    renderer = instance;

    return () => {
      renderer = null;
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribeSettings();
      unsubscribeAssets();
      observer.disconnect();
      instance.dispose();
    };
  });
</script>

<canvas
  bind:this={canvas}
  data-testid="visual-stage"
  data-status={status}
  data-fps={fps.toFixed(0)}
  data-scene={mode}
  aria-label={mode === 'kaleidoscope' ? 'Kaleidoscope visuals' : 'Logo Spectrum visuals'}
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
