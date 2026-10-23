<script lang="ts">
  import { chapterProblem, chapterText } from '../../core/export/export-job';
  import type { ExportState } from '../../core/export/exporter';
  import { formatBytes, formatDuration } from '../../core/util/format';
  import { useExporter } from '../exporter-context';
  import Icon from '../Icon.svelte';
  import { readyText } from './export-words';
  import ExportVideos from './ExportVideos.svelte';

  /** A finished export: the file or the videos, how long it took, and its chapters (EX-14). */
  let { done }: { done: Extract<ExportState, { status: 'done' }> } = $props();

  const exporter = useExporter();
  let copied = $state(false);

  /** Puts the chapter list on the clipboard, for the video's description (EX-14). */
  async function copyChapters(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard blocked: the list stays readable and selectable on screen.
    }
  }

  /** Saves the chapter list as a text file named after the video. */
  function saveChapters(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, '')} - chapters.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<section class="result" data-testid="export-done">
  <p class="big">
    {readyText(Math.max(1, done.videos.length), done.planned, done.fileName)}
  </p>
  {#if done.videos.length > 0}
    <ExportVideos videos={done.videos} />
  {:else}
    <p class="file">{done.fileName} · {formatBytes(done.bytes)}</p>
  {/if}
  {#if done.seconds !== null}
    <p class="hint">Rendered in {formatDuration(done.seconds)}.</p>
  {/if}
  {#if done.chapters.length > 1}
    {@const text = chapterText(done.chapters)}
    {@const issue = chapterProblem(done.chapters, done.duration)}
    <div class="chapters">
      <p class="hint">Chapters for the description on YouTube:</p>
      <pre data-testid="export-chapters">{text}</pre>
      {#if issue}
        <p class="hint">{issue}</p>
      {/if}
      <div class="actions">
        <button onclick={() => copyChapters(text)} data-testid="export-chapters-copy">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onclick={() => saveChapters(text, done.fileName)}
          data-testid="export-chapters-save"
        >
          Save as text
        </button>
      </div>
    </div>
  {/if}
  <div class="actions">
    {#if done.url}
      <a
        class="button primary"
        href={done.url}
        download={done.fileName}
        data-testid="export-download"
      >
        <Icon name="export" size={16} /> Download
      </a>
      <button onclick={() => exporter.discard()}>Delete from browser storage</button>
    {:else if done.videos.some((video) => video.url)}
      <button onclick={() => exporter.discard()}>Delete from browser storage</button>
    {:else if done.videos.length > 0}
      <p class="hint">Saved into the folder you chose.</p>
    {:else}
      <p class="hint">Saved to the file you chose.</p>
    {/if}
    <button onclick={() => exporter.dismiss()}>New export</button>
  </div>
  {#if done.videos.some((video) => video.url)}
    <p class="hint">The videos stay in browser storage until the next export.</p>
  {/if}
</section>
