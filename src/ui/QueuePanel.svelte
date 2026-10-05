<script lang="ts">
  import { gridTempo } from '../core/analysis/grid-beats';
  import type { BeatGrid } from '../core/analysis/beat-grid';
  import {
    AUDIO_ACCEPT,
    entriesFromFiles,
    hasHandlePickers,
    pickFiles,
    pickFolder,
  } from '../core/library/folder-reader';
  import { sameGrid } from '../core/library/analysis-cache';
  import { shownArtist, shownCover, shownTitle, type Track } from '../core/state/app-state';
  import { errorMessage, formatDuration } from '../core/util/format';
  import { DragScroll } from './drag-scroll';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import TrackNameDialog from './TrackNameDialog.svelte';
  import TrackTempo from './TrackTempo.svelte';

  const player = usePlayer();
  const app = player.store;
  const analyses = player.analysis;

  /**
   * The track's beat grid, once analysed: with a tempo, or with one set by hand (which can then
   * be changed again even where the grid finds no clear beat).
   */
  function gridOf(track: Track): BeatGrid | null {
    const grid = track.fingerprint ? $analyses.get(track.fingerprint)?.grid : null;
    return grid && (gridTempo(grid) > 0 || track.tempo !== null) ? grid : null;
  }

  /**
   * True while the grid is being computed anew for a corrected tempo (TMP-06) or another tempo
   * range (AN-12).
   */
  function regridding(track: Track): boolean {
    const state = track.fingerprint ? $analyses.get(track.fingerprint) : undefined;
    const wanted = { tempo: track.tempo, range: $app.settings.bpmRange, fixed: track.fixedTempo };
    return state !== undefined && !sameGrid(state, wanted);
  }

  let fileInput: HTMLInputElement;
  let folderInput: HTMLInputElement;
  let dragIndex = $state<number | null>(null);
  let dropIndex = $state<number | null>(null);
  let list: HTMLOListElement | undefined = $state();
  /** Scrolls the list while a track is dragged near its top or bottom. */
  let dragScroll: DragScroll | null = null;
  /** The track being named (LS-18). */
  let naming = $state<Track | null>(null);

  const totalDuration = $derived(
    $app.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
  );

  /** Entries of the last visit whose files are not readable yet (SRC-05). */
  const locked = $derived($app.tracks.filter((track) => track.status === 'locked').length);
  const missing = $derived($app.tracks.filter((track) => track.status === 'missing').length);

  function addFromInput() {
    if (fileInput.files) player.addFiles(fileInput.files);
    fileInput.value = '';
  }

  function addFromFolderInput() {
    if (folderInput.files) player.addEntries(entriesFromFiles(folderInput.files));
    folderInput.value = '';
  }

  /**
   * Chromium's pickers give handles, so the files stay available after a reload; elsewhere the
   * file inputs (opened right in the click, as some browsers require).
   */
  async function addFiles() {
    if (!hasHandlePickers()) return fileInput.click();
    const picked = await pickFiles();
    if (picked) player.addEntries(picked);
    else fileInput.click();
  }

  async function addFolder() {
    if (!hasHandlePickers()) return folderInput.click();
    try {
      const picked = await pickFolder();
      if (picked) player.addEntries(picked);
      else folderInput.click();
    } catch (error) {
      player.reportError(`Cannot read the folder: ${errorMessage(error)}`);
    }
  }

  function play(track: Track) {
    if (track.status === 'missing') void addFiles();
    else if (track.status !== 'unsupported') void player.playTrack(track.id);
  }

  function onDragStart(event: DragEvent, index: number) {
    dragIndex = index;
    event.dataTransfer?.setData('application/x-vibe-track', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    dragScroll = list ? new DragScroll(list) : null;
  }

  function endDrag() {
    dragScroll?.stop();
    dragScroll = null;
    dragIndex = null;
    dropIndex = null;
  }

  /** Where a track dragged over the entry at `index` goes: before it, or after it. */
  function placeAt(event: DragEvent, index: number): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function onDragOver(event: DragEvent, index: number) {
    if (dragIndex === null) return;
    event.preventDefault();
    dropIndex = placeAt(event, index);
  }

  /**
   * The dragged track goes to `place`, which the drop itself says: the list may have scrolled
   * under the resting pointer since the last `dragover`.
   */
  function onDrop(event: DragEvent, place: number) {
    if (dragIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    player.move(dragIndex, place > dragIndex ? place - 1 : place);
    endDrag();
  }

  function onKey(event: KeyboardEvent, index: number, track: Track) {
    // Keys on the buttons of the entry are theirs.
    if (event.target !== event.currentTarget) return;
    const id = track.id;
    if (event.key === 'Enter') play(track);
    else if (event.key === 'F2') naming = track;
    else if (event.key === 'Delete' || event.key === 'Backspace') void player.remove(id);
    else if (event.altKey && event.key === 'ArrowUp' && index > 0) player.move(index, index - 1);
    else if (event.altKey && event.key === 'ArrowDown') player.move(index, index + 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<section
  class="queue"
  aria-label="Queue"
  ondragover={(event) => {
    if (dragIndex !== null) dragScroll?.over(event.clientY);
  }}
>
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
      <button onclick={addFiles} data-testid="add-files">
        <Icon name="plus" size={18} /> Add files
      </button>
      <button
        class="ghost"
        onclick={addFolder}
        aria-label="Add a folder"
        title="Add a folder (with its subfolders)"
        data-testid="add-folder"
      >
        <Icon name="folder" size={18} />
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
      accept={['audio/*', ...AUDIO_ACCEPT].join(',')}
      onchange={addFromInput}
      hidden
      data-testid="file-input"
    />
    <input
      bind:this={folderInput}
      type="file"
      webkitdirectory
      onchange={addFromFolderInput}
      hidden
      data-testid="folder-input"
    />
  </header>

  {#if locked > 0}
    <div class="notice" data-testid="queue-locked">
      <Icon name="lock" size={18} />
      <span>The browser asks before the app may read your files again.</span>
      <button onclick={() => player.unlock()} data-testid="unlock">Allow</button>
    </div>
  {/if}
  {#if missing > 0}
    <div class="notice" data-testid="queue-missing">
      <Icon name="alert" size={18} />
      <div class="notice-body">
        <span>
          {missing === 1 ? 'One track needs its file' : `${missing} tracks need their files`} again: add
          the files or their folder, and they come back with their cues.
        </span>
        <div class="notice-actions">
          <button onclick={addFiles} data-testid="missing-add-files">Add files</button>
          <button onclick={addFolder} data-testid="missing-add-folder">Add folder</button>
        </div>
      </div>
    </div>
  {/if}

  {#if $app.tracks.length === 0}
    <p class="empty">Drop audio files anywhere, or click “Add files”.</p>
  {:else}
    <ol
      bind:this={list}
      role="listbox"
      aria-label="Queue tracks"
      ondragleave={(event) => {
        // Only when the drag leaves the list, not when it goes from one track to the next.
        if (!list?.contains(event.relatedTarget as Node | null)) dropIndex = null;
      }}
      ondragover={(event) => {
        // Below the last track, where the list ends: the end of the queue.
        if (dragIndex === null || event.target !== event.currentTarget) return;
        event.preventDefault();
        const last = list?.lastElementChild?.getBoundingClientRect();
        if (last && event.clientY > last.bottom) dropIndex = $app.tracks.length;
      }}
      ondrop={(event) => onDrop(event, dropIndex ?? $app.tracks.length)}
      data-testid="queue-list"
    >
      {#each $app.tracks as track, index (track.id)}
        <li
          class:current={track.id === $app.currentId}
          class:unsupported={track.status === 'unsupported'}
          class:offline={track.status === 'locked' || track.status === 'missing'}
          class:drop-before={dropIndex === index && dragIndex !== null}
          class:drop-after={dropIndex === index + 1 && index === $app.tracks.length - 1}
          draggable="true"
          ondragstart={(event) => onDragStart(event, index)}
          ondragover={(event) => onDragOver(event, index)}
          ondrop={(event) => onDrop(event, placeAt(event, index))}
          ondragend={endDrag}
          ondblclick={() => play(track)}
          onkeydown={(event) => onKey(event, index, track)}
          tabindex="0"
          role="option"
          aria-selected={track.id === $app.currentId}
          data-testid="queue-item"
          data-status={track.status}
          title={track.status === 'locked'
            ? 'Double-click to allow access and play'
            : track.status === 'missing'
              ? `Add ${track.fileName} again to play it`
              : (track.reason ?? track.fileName)}
        >
          <span class="grip" aria-hidden="true"><Icon name="grip" size={16} /></span>
          {#if shownCover(track)}
            <img src={shownCover(track)} alt="" data-testid="queue-cover" />
          {:else}
            <span class="cover-placeholder"><Icon name="music" size={16} /></span>
          {/if}
          <span class="text">
            <span class="title">{shownTitle(track)}</span>
            <span class="artist">
              {#if track.status === 'unsupported'}
                <Icon name="alert" size={12} /> {track.reason}
              {:else if track.status === 'locked'}
                <Icon name="lock" size={12} /> Needs your permission
              {:else if track.status === 'missing'}
                <Icon name="alert" size={12} /> File not available
              {:else}
                {shownArtist(track) ?? track.fileName}
              {/if}
            </span>
          </span>
          <span class="numbers">
            <span class="duration" data-testid="queue-duration">
              {track.status === 'probing'
                ? '…'
                : track.duration !== null
                  ? formatDuration(track.duration)
                  : ''}
            </span>
            {#if gridOf(track)}
              <TrackTempo {track} grid={gridOf(track)!} pending={regridding(track)} />
            {/if}
          </span>
          <button
            class="rename ghost"
            onclick={() => (naming = track)}
            aria-label="Title, artist, cover, colours and look of {shownTitle(track)}"
            title="Title, artist, cover, colours and look (F2)"
            data-testid="queue-rename"
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            class="remove ghost"
            onclick={() => player.remove(track.id)}
            aria-label="Remove {shownTitle(track)}"
          >
            <Icon name="close" size={16} />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
  <TrackNameDialog track={naming} onclose={() => (naming = null)} />
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
    grid-template-columns: 16px 36px 1fr auto 28px 28px;
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
  li.unsupported,
  li.offline {
    opacity: 0.55;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 13px;
    color: var(--muted);
  }
  .notice span,
  .notice-body {
    flex: 1;
  }
  .notice-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .notice button {
    padding: 4px 10px;
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
  .numbers {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .duration {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .remove,
  .rename {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    opacity: 0;
  }
  li:hover .remove,
  li:focus-within .remove,
  li:hover .rename,
  li:focus-within .rename {
    opacity: 1;
  }
</style>
