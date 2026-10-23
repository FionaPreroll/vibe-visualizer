<script lang="ts">
  import type { ExportState } from '../../core/export/exporter';
  import { useExporter } from '../exporter-context';
  import ExportVideos from './ExportVideos.svelte';

  /** An export that stopped before it was finished (EX-15): it resumes where it stopped. */
  let {
    stopped,
    onresume,
  }: {
    stopped: Extract<ExportState, { status: 'interrupted' | 'failed' }>;
    onresume: () => void;
  } = $props();

  const exporter = useExporter();
</script>

<section class="result" data-testid="export-interrupted">
  {#if stopped.status === 'failed'}
    <p class="big">The export stopped: {stopped.message}</p>
  {:else}
    {@const manifest = stopped.manifest}
    <p class="big">An export was interrupted.</p>
    <p class="file">
      {manifest.fileName} · {Math.round(
        (manifest.progress.segmentsDone / manifest.timing.segments) * 100,
      )} % rendered
    </p>
  {/if}
  <p class="hint">It continues where it stopped.</p>
  {#if stopped.status === 'failed' && stopped.videos.length > 0}
    <p class="hint">
      Finished before, from the same batch; resuming goes on with the rest.
      {#if stopped.videos.some((video) => video.url)}
        Discard deletes these videos from browser storage too.
      {/if}
    </p>
    <ExportVideos videos={stopped.videos} />
  {/if}
  <div class="actions">
    <button class="primary" onclick={onresume} data-testid="export-resume">Resume</button>
    <button onclick={() => exporter.discard()} data-testid="export-discard">Discard</button>
  </div>
</section>
