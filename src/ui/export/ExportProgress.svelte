<script lang="ts">
  import type { RunningExport } from '../../core/export/exporter';
  import { useExporter } from '../exporter-context';
  import Icon from '../Icon.svelte';
  import { PHASES, remaining } from './export-words';

  /** A running export (EX-06): its preview, progress and phase; pause, continue and cancel. */
  let { job }: { job: RunningExport } = $props();

  const exporter = useExporter();
  let preview: HTMLCanvasElement | undefined = $state();

  // The latest preview frame (none yet: the next video of a batch).
  $effect(() => {
    const bitmap = job.preview;
    if (!preview) return;
    if (!bitmap) {
      preview.getContext('2d')?.clearRect(0, 0, preview.width, preview.height);
      return;
    }
    try {
      preview.width = bitmap.width;
      preview.height = bitmap.height;
      preview.getContext('2d')?.drawImage(bitmap, 0, 0);
    } catch {
      // Already replaced by a newer frame.
    }
  });
</script>

<section class="progress" data-testid="export-progress" data-phase={job.phase}>
  <canvas
    bind:this={preview}
    class="preview"
    style:aspect-ratio={job.format.width / job.format.height}
  ></canvas>
  <p class="file" data-testid="export-file">
    {#if job.batch}Video {job.batch.index + 1} of {job.batch.count} ·{/if}
    {job.fileName} · {job.format.width}×{job.format.height} · {job.format.fps} fps
  </p>
  <div
    class="bar"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.floor(job.progress * 100)}
    aria-label="Export progress"
  >
    <div class="fill" style:width="{job.progress * 100}%"></div>
  </div>
  <p class="status">
    <span>{job.paused ? 'Paused' : PHASES[job.phase]} · {Math.floor(job.progress * 100)} %</span>
    <span>
      {#if job.speed !== null}{job.speed.toFixed(1)}× real time ·{/if}
      {remaining(job.remaining)}
    </span>
  </p>
  <p class="hint">
    The live visuals pause while exporting. You can close this window; the export goes on and keeps
    the screen awake.
  </p>
  <div class="actions">
    {#if job.paused}
      <button class="primary" onclick={() => exporter.unpause()}>
        <Icon name="play" size={16} /> Continue
      </button>
    {:else}
      <button onclick={() => exporter.pause()}><Icon name="pause" size={16} /> Pause</button>
    {/if}
    <button onclick={() => exporter.cancel()} data-testid="export-cancel">Cancel export</button>
  </div>
</section>
