<script lang="ts">
  import { errorMessage } from '../../core/util/format';
  import { WorkerClient } from '../../core/util/worker-rpc';
  import { quickMode } from '../quick';
  import { lab, SpikeRun } from '../report.svelte';
  import SpikeCard from '../ui/SpikeCard.svelte';
  import type { LiveResult, OfflineResult } from './render.worker';
  import RenderWorker from './render.worker.ts?worker';

  let running = $state(false);
  let runId = $state(0);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let liveFps = $state<number | null>(null);

  async function run() {
    running = true;
    liveFps = null;
    runId++;
    // A canvas can hand its control to a worker only once: re-create it per run.
    await Promise.resolve();
    const spike = new SpikeRun('S4');
    const client = new WorkerClient(new RenderWorker());
    try {
      if (!canvas) throw new Error('canvas missing');
      if (lab.env) spike.metric('GPU', lab.env.webgl2.renderer);
      const seconds = quickMode ? 2 : 8;
      spike.log(`Live: rendering 1920×1080 for ${seconds} s…`);
      const offscreen = canvas.transferControlToOffscreen();
      const live = await client.call<LiveResult>(
        'live',
        { canvas: offscreen, width: 1920, height: 1080, seconds },
        { transfer: [offscreen], onProgress: (fps: number) => (liveFps = fps) },
      );
      spike.check(
        'Float render targets (RGBA16F)',
        live.floatTargets,
        live.floatTargets ? 'available' : 'missing: colour banding in feedback effects',
      );
      const liveDetail = `${live.averageFps.toFixed(1)} fps average, ${live.onePercentLowFps.toFixed(1)} fps 1% low, ${live.averageCpuMs.toFixed(2)} ms CPU per frame`;
      spike.metric('Live 1080p', liveDetail);
      spike.check('1080p60 live', live.averageFps >= 57 && !live.contextLost, liveDetail);

      const frames = quickMode ? 3 : 120;
      spike.log(`Offline: rendering ${frames} frames at 3840×2160…`);
      const offline = await client.call<OfflineResult>('offline', {
        width: 3840,
        height: 2160,
        frames,
        fps: 30,
      });
      const offlineDetail = `${offline.fps.toFixed(1)} fps (${(offline.fps / 30).toFixed(2)}× real time at 30 fps), ${offline.glErrors} GL errors`;
      spike.metric('Offline 4K', offlineDetail);
      spike.check(
        '4K offline without errors',
        offline.glErrors === 0 && !offline.contextLost,
        offlineDetail,
      );
      spike.done();
    } catch (error) {
      spike.fail(errorMessage(error));
    } finally {
      client.terminate();
      running = false;
    }
  }
</script>

<SpikeCard
  id="S4"
  title="Rendering"
  question="Does WebGL2 in a worker handle float feedback, kaleidoscope folding and bloom?"
  criteria={['1080p60 live on integrated graphics', '4K offline without errors']}
>
  <div class="row">
    <button class="primary" onclick={run} disabled={running} data-testid="s4-run">
      {running ? 'Running…' : 'Run rendering test'}
    </button>
    <span class="hint">
      {#if liveFps !== null && running}
        Live: {liveFps.toFixed(0)} fps
      {:else}
        About 15 seconds. Flashing visuals.
      {/if}
    </span>
  </div>
  {#key runId}
    <canvas bind:this={canvas} class:visible={runId > 0} width="1920" height="1080"></canvas>
  {/key}
</SpikeCard>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hint {
    color: var(--muted);
    font-size: 14px;
  }
  canvas {
    display: none;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 8px;
    background: #000;
  }
  canvas.visible {
    display: block;
  }
</style>
