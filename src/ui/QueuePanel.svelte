<script lang="ts">
  import { formatDuration } from '../core/util/format';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  const player = usePlayer();
  const app = player.store;

  let fileInput: HTMLInputElement;
  let dragIndex = $state<number | null>(null);
  let dropIndex = $state<number | null>(null);

  const totalDuration = $derived(
    $app.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
  );

  function addFromInput() {
    if (fileInput.files) player.addFiles(fileInput.files);
    fileInput.value = '';
  }

  function onDragStart(event: DragEvent, index: number) {
    dragIndex = index;
    event.dataTransfer?.setData('application/x-vibe-track', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event: DragEvent, index: number) {
    if (dragIndex === null) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function onDrop(event: DragEvent) {
    if (dragIndex === null || dropIndex === null) return;
    event.preventDefault();
    const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
    player.move(dragIndex, to);
    dragIndex = null;
    dropIndex = null;
  }

  function onKey(event: KeyboardEvent, index: number, id: string) {
    if (event.key === 'Enter') void player.playTrack(id);
    else if (event.key === 'Delete' || event.key === 'Backspace') void player.remove(id);
    else if (event.altKey && event.key === 'ArrowUp' && index > 0) player.move(index, index - 1);
    else if (event.altKey && event.key === 'ArrowDown') player.move(index, index + 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<section class="queue" aria-label="Queue">
  <header>
    <div>
      <h2>Queue</h2>
      <span class="summary">
        {$app.tracks.length}
        {$app.tracks.length === 1 ? 'track' : 'tracks'}
        {#if totalDuration > 0}· {formatDuration(totalDuration)}{/if}
      </span>
    </div>
    <div class="actions">
      <button onclick={() => fileInput.click()} data-testid="add-files">
        <Icon name="plus" size={18} /> Add files
      </button>
      <button
        class="ghost"
        onclick={() => player.clear()}
        disabled={$app.tracks.length === 0}
        aria-label="Clear queue"
        title="Clear queue"
      >
        <Icon name="trash" size={18} />
      </button>
    </div>
    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept="audio/*,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wav,.aif,.aiff,.webm"
      onchange={addFromInput}
      hidden
      data-testid="file-input"
    />
  </header>

  {#if $app.tracks.length === 0}
    <p class="empty">Drop audio files anywhere, or click “Add files”.</p>
  {:else}
    <ol role="listbox" aria-label="Queue tracks" ondragleave={() => (dropIndex = null)}>
      {#each $app.tracks as track, index (track.id)}
        <li
          class:current={track.id === $app.currentId}
          class:unsupported={track.status === 'unsupported'}
          class:drop-before={dropIndex === index && dragIndex !== null}
          class:drop-after={dropIndex === index + 1 && index === $app.tracks.length - 1}
          draggable="true"
          ondragstart={(event) => onDragStart(event, index)}
          ondragover={(event) => onDragOver(event, index)}
          ondrop={onDrop}
          ondragend={() => {
            dragIndex = null;
            dropIndex = null;
          }}
          ondblclick={() => track.status !== 'unsupported' && player.playTrack(track.id)}
          onkeydown={(event) => onKey(event, index, track.id)}
          tabindex="0"
          role="option"
          aria-selected={track.id === $app.currentId}
          data-testid="queue-item"
          data-status={track.status}
          title={track.reason ?? track.fileName}
        >
          <span class="grip" aria-hidden="true"><Icon name="grip" size={16} /></span>
          {#if track.coverUrl}
            <img src={track.coverUrl} alt="" />
          {:else}
            <span class="cover-placeholder"><Icon name="music" size={16} /></span>
          {/if}
          <span class="text">
            <span class="title">{track.title}</span>
            <span class="artist">
              {#if track.status === 'unsupported'}
                <Icon name="alert" size={12} /> {track.reason}
              {:else}
                {track.artist ?? track.fileName}
              {/if}
            </span>
          </span>
          <span class="duration" data-testid="queue-duration">
            {track.status === 'probing'
              ? '…'
              : track.duration !== null
                ? formatDuration(track.duration)
                : ''}
          </span>
          <button
            class="remove ghost"
            onclick={() => player.remove(track.id)}
            aria-label="Remove {track.title}"
          >
            <Icon name="close" size={16} />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .queue {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 16px 16px 10px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .summary {
    color: var(--muted);
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .actions button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
  }
  .ghost {
    background: transparent;
    border-color: transparent;
    color: var(--muted);
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border);
  }
  .empty {
    margin: 24px 16px;
    color: var(--muted);
    font-size: 14px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0 8px 16px;
    overflow-y: auto;
    flex: 1;
  }
  li {
    display: grid;
    grid-template-columns: 16px 36px 1fr auto 28px;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: default;
    border-top: 2px solid transparent;
    border-bottom: 2px solid transparent;
  }
  li:hover,
  li:focus-visible {
    background: var(--surface-2);
  }
  li.current {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  li.current .title {
    color: var(--accent);
  }
  li.unsupported {
    opacity: 0.55;
  }
  li.drop-before {
    border-top-color: var(--accent-2);
  }
  li.drop-after {
    border-bottom-color: var(--accent-2);
  }
  .grip {
    color: var(--muted);
    cursor: grab;
  }
  img,
  .cover-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    object-fit: cover;
  }
  .cover-placeholder {
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--muted);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title,
  .artist {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    font-size: 14px;
  }
  .artist {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  .duration {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .remove {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    opacity: 0;
  }
  li:hover .remove,
  li:focus-within .remove {
    opacity: 1;
  }
</style>
