<script lang="ts">
  import { onMount } from 'svelte';
  import { entriesFromDrop } from '../core/library/folder-reader';
  import { errorMessage } from '../core/util/format';
  import { usePlayer } from './player-context';

  /** Accepts audio files and folders dropped anywhere on the window (SRC-01, SRC-03). */
  const player = usePlayer();
  let visible = $state(false);
  let depth = 0;

  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

  onMount(() => {
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      visible = true;
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) visible = false;
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      visible = false;
      // The dropped items are taken now; reading folders goes on after the event.
      entriesFromDrop(event.dataTransfer).then(
        (entries) => player.addEntries(entries),
        (error: unknown) =>
          player.reportError(`Cannot read what was dropped: ${errorMessage(error)}`),
      );
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });
</script>

{#if visible}
  <div class="overlay" aria-hidden="true">
    <div class="box">Drop to add to the queue</div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgba(11, 11, 18, 0.72);
    pointer-events: none;
  }
  .box {
    padding: 40px 64px;
    border: 2px dashed var(--accent);
    border-radius: 16px;
    font-size: 20px;
    color: var(--text);
    background: var(--surface);
  }
</style>
