<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { aspectRatio, type AspectRatio } from '../core/export/video-format';
  import { AutoQuality } from '../core/render/auto-quality';
  import { BUILT_IN_KALEIDO_PRESETS } from '../core/render/kaleido-settings';
  import type { ImageKind } from '../core/render/logo-spectrum';
  import { switchingPool } from '../core/render/preset-director';
  import type { SceneKind } from '../core/render/render-protocol';
  import { Renderer } from '../core/render/renderer';
  import { decodeImage, type StoredImage } from '../core/render/visual-assets';
  import { BUILT_IN_PRESETS } from '../core/render/visual-settings';
  import { usePlayer } from './player-context';
  import { kaleidoPresets, logoSpectrumPresets } from './preset-store';
  import { reportProblem } from './problems';
  import { liveScale } from './render-quality';
  import SafeAreas from './SafeAreas.svelte';
  import { useCapture } from './stage-capture';
  import { StreamInfo } from './stream-info';
  import { useAssets } from './visuals-context';

  /**
   * The visuals (Logo Spectrum or Kaleidoscope), drawn by the render worker at the canvas's
   * native resolution (VE-01), letterboxed to the video's aspect ratio (VE-09). Switching between
   * the two keeps the worker and both scenes; settings and images are forwarded as they change.
   * The worker switches presets on its own (PR-02) and says so, so the panels show the preset.
   * It draws at a share of the canvas's device pixels (VE-07): the render scale, lowered by the
   * auto-quality while the frame rate drops. When the graphics card is reset and the context is
   * lost, or drawing fails, a new worker takes over on a new canvas (NF-09).
   */
  interface Props {
    mode: SceneKind;
    aspect: AspectRatio;
    safeAreas: boolean;
    /** Stops drawing (while an export needs the graphics card, or the visuals rest). */
    paused: boolean;
    /** The visuals rest at the user's wish (DS-05): the stage says so. */
    resting: boolean;
  }
  let { mode, aspect, safeAreas, paused, resting }: Props = $props();

  const player = usePlayer();
  const assets = useAssets();
  const capture = useCapture();
  const app = player.store;
  let canvas: HTMLCanvasElement | undefined = $state();
  let renderer: Renderer | null = $state(null);
  let status = $state<'starting' | 'running' | 'failed'>('starting');
  let message = $state('');
  let fps = $state(0);
  /** Whether the visuals ran since the page loaded: a failure then stops them. */
  let ran = $state(false);
  /** Counts the canvases: each start needs a new one, as a canvas draws for one worker only. */
  let generation = $state(0);

  let visible = $state(true);

  // Render scale and auto-quality (VE-07).
  const quality = new AutoQuality();
  let autoScale = $state(1);
  const autoQuality = $derived($app.settings.autoQuality);
  const scale = $derived($app.settings.renderScale * (autoQuality ? autoScale : 1));
  /** Device pixels of the canvas box, before the scale. */
  let box: readonly [number, number] = [1, 1];
  const scaled = () =>
    [Math.max(1, Math.round(box[0] * scale)), Math.max(1, Math.round(box[1] * scale))] as const;

  $effect(() => {
    liveScale.set(scale);
    renderer?.resize(...scaled());
  });

  $effect(() => {
    // Switched on again: it measures anew, from the full resolution.
    if (!autoQuality) {
      quality.reset();
      autoScale = 1;
    }
  });

  $effect(() => {
    renderer?.setScene(mode);
  });

  $effect(() => {
    renderer?.setRunning(visible && !paused);
  });

  const reduceFlashing = $derived($app.settings.reduceFlashing);
  $effect(() => {
    renderer?.setReduceFlashing(reduceFlashing);
  });

  // The track overlay (LS-18, LS-19), the cover art as the logo (LS-15) and its colours
  // (VE-12): the worker learns the tracks of the files in the stream, and shows the one the
  // music heard comes from.
  const overlay = $derived($app.settings.overlay);
  $effect(() => {
    renderer?.setOverlay(overlay);
  });
  const coverLogo = $derived($app.settings.coverLogo);
  $effect(() => {
    renderer?.setCoverLogo(coverLogo);
  });
  const coverColors = $derived($app.settings.coverColors);
  $effect(() => {
    renderer?.setCoverColors(coverColors);
  });
  const stream = player.stream;
  const analyses = player.analysis;
  const streamInfo = $derived(renderer ? new StreamInfo(renderer) : null);
  $effect(() => {
    streamInfo?.update($stream, $app.tracks, $app.sound.rate, coverLogo || coverColors, $analyses);
  });

  // Automatic preset switching: its settings and the presets of each mode that take part.
  const autoPresets = $derived($app.settings.autoPresets);
  const favourites = $derived($app.settings.favourites);
  $effect(() => {
    const pool = autoPresets.pool;
    renderer?.setAutoPresets(
      autoPresets,
      switchingPool(BUILT_IN_PRESETS, $logoSpectrumPresets, favourites.logoSpectrum, pool),
      switchingPool(BUILT_IN_KALEIDO_PRESETS, $kaleidoPresets, favourites.kaleidoscope, pool),
    );
  });

  /** Starts a render worker on the canvas; returns what stops it again. */
  function start(): () => void {
    const element = canvas!;
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      return [
        Math.max(1, Math.round(element.clientWidth * ratio)),
        Math.max(1, Math.round(element.clientHeight * ratio)),
      ] as const;
    };
    box = size();
    const instance = new Renderer(element, player.engine, ...scaled());
    // The first frame already shows the right scene (the effect takes over after mounting).
    instance.setScene(mode);
    instance.onEvent = (event) => {
      if (event.type === 'ready') {
        status = 'running';
        ran = true;
        // A picture of the stage can be taken now (EX-10).
        capture.attach(instance);
      } else if (event.type === 'stats') {
        fps = event.fps;
        if (autoQuality && quality.update(event.fps)) autoScale = quality.scale;
      } else if (event.type === 'preset') {
        // The switching chose it: the panels show it (the worker morphs there already).
        if (event.scene === 'logoSpectrum') player.replaceVisuals(event.settings);
        else player.replaceKaleido(event.settings);
      } else if (event.type === 'lost') {
        recover('the graphics card was reset, several times in a row.');
      } else if (event.fatal) {
        recover(event.message);
      } else {
        // It draws on: the error is only reported.
        reportProblem(new Error(event.message), 'The render worker');
      }
    };

    const observer = new ResizeObserver((entries) => {
      const device = entries[0]?.devicePixelContentBoxSize?.[0];
      box = device ? [device.inlineSize, device.blockSize] : size();
      instance.resize(...scaled());
    });
    try {
      observer.observe(element, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(element);
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
    const unsubscribeAssets = assets.subscribe(() => {
      const images = assets.shown;
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

    const onVisibility = () => (visible = document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    // Leaving the page: the render worker stops before the page is torn down (see AppShell).
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) instance.dispose(true);
    };
    window.addEventListener('pagehide', onPageHide);
    // The effects above send mode changes and pauses from now on (and the current ones now).
    renderer = instance;

    return () => {
      renderer = null;
      instance.onEvent = null;
      capture.attach(null);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      unsubscribeSettings();
      unsubscribeAssets();
      observer.disconnect();
      instance.dispose();
    };
  }

  // Restarts (NF-09): a lost graphics context comes back on a new canvas, with everything sent
  // anew. A few times a minute; more often, the graphics card does not keep up, and the visuals
  // wait for a click.
  const RESTARTS = 3;
  const RESTART_WINDOW_MS = 60_000;
  const RESTART_DELAY_MS = 1000;
  const restarts: number[] = [];
  let stop: (() => void) | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;

  function recover(reason: string) {
    stop?.();
    stop = null;
    fps = 0;
    const now = performance.now();
    while (restarts.length > 0 && now - restarts[0]! > RESTART_WINDOW_MS) restarts.shift();
    if (restarts.length >= RESTARTS) {
      status = 'failed';
      message = reason;
      return;
    }
    restarts.push(now);
    status = 'starting';
    restartTimer = setTimeout(() => void restart(), RESTART_DELAY_MS);
  }

  async function restart() {
    stop?.();
    stop = null;
    generation++;
    // The new canvas is in place after the update.
    await tick();
    if (mounted) stop = start();
  }

  function tryAgain() {
    restarts.length = 0;
    status = 'starting';
    void restart();
  }

  onMount(() => {
    mounted = true;
    stop = start();
    return () => {
      mounted = false;
      clearTimeout(restartTimer);
      stop?.();
      stop = null;
    };
  });
</script>

<div class="box">
  <div class="frame" style:--ratio={aspectRatio(aspect)} data-aspect={aspect}>
    {#key generation}
      <canvas
        bind:this={canvas}
        data-testid="visual-stage"
        data-status={status}
        data-fps={fps.toFixed(0)}
        data-scale={scale.toFixed(3)}
        data-scene={mode}
        data-generation={generation}
        data-paused={paused}
        class:resting
        aria-label={mode === 'kaleidoscope' ? 'Kaleidoscope visuals' : 'Logo Spectrum visuals'}
      ></canvas>
    {/key}
    {#if safeAreas}
      <SafeAreas {aspect} />
    {/if}
    {#if resting}
      <div class="rest" data-testid="visuals-paused">
        <p>The visuals rest; the music plays on.</p>
        <button onclick={() => player.updateSettings({ visualsPaused: false })}
          >Show the visuals (B)</button
        >
      </div>
    {/if}
  </div>
</div>
{#if status === 'failed'}
  <p class="failed" role="alert" data-testid="visual-stage-failed">
    {ran ? 'The visuals stopped' : 'The visuals could not start'}: {message}
    <button onclick={tryAgain}>Try again</button>
  </p>
{/if}

<style>
  .box {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    container-type: size;
    background: #000;
  }
  /* The largest box of the aspect ratio that fits the stage. */
  .frame {
    position: relative;
    width: min(100cqw, 100cqh * var(--ratio));
    height: min(100cqh, 100cqw / var(--ratio));
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    background: #07070c;
  }
  /* The last picture stays, dimmed, under a note. */
  canvas.resting {
    opacity: 0.25;
  }
  .rest {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    padding: 16px;
    text-align: center;
  }
  .rest p {
    margin: 0;
    color: var(--text);
    font-size: 15px;
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
  .failed button {
    margin-left: 10px;
  }
</style>
