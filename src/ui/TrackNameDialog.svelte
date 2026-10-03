<script lang="ts">
  import { shownArtist, shownTitle, TRACK_TEXT_LENGTH, type Track } from '../core/state/app-state';
  import { backdropClose } from './backdrop';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * Names a track (LS-18): the title and artist that the overlay, the queue and exports show.
   * They are kept for the file; an empty title, or the file's own names, go back to the file's.
   */
  interface Props {
    /** The track to name; the dialog is open while there is one. */
    track: Track | null;
    onclose: () => void;
  }
  let { track, onclose }: Props = $props();

  const player = usePlayer();
  const heading = `track-name-${Math.random().toString(36).slice(2)}`;
  let dialog: HTMLDialogElement | undefined = $state();
  const backdrop = backdropClose(() => onclose());
  let title = $state('');
  let artist = $state('');

  $effect(() => {
    if (!dialog) return;
    if (track && !dialog.open) {
      title = shownTitle(track);
      artist = shownArtist(track) ?? '';
      dialog.showModal();
    } else if (!track && dialog.open) {
      dialog.close();
    }
  });

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (track) player.renameTrack(track.id, title, artist);
    onclose();
  }

  function useFile() {
    if (track) player.renameTrack(track.id, track.title, track.artist ?? '');
    onclose();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={heading}
  {onclose}
  {...backdrop}
  data-testid="track-name-dialog"
>
  <form onsubmit={save}>
    <header>
      <h2 id={heading}>Title and artist</h2>
      <button type="button" class="close" onclick={onclose} aria-label="Close">
        <Icon name="close" size={18} />
      </button>
    </header>
    <div class="body">
      <p class="muted">
        As the track overlay, the queue and exports show this track. Kept for the file.
      </p>
      <label>
        <span>Title</span>
        <input
          bind:value={title}
          maxlength={TRACK_TEXT_LENGTH}
          placeholder={track?.title}
          data-testid="track-name-title"
        />
      </label>
      <label>
        <span>Artist</span>
        <input
          bind:value={artist}
          maxlength={TRACK_TEXT_LENGTH}
          placeholder="None"
          data-testid="track-name-artist"
        />
      </label>
      {#if track}
        <p class="muted small" data-testid="track-name-file">
          From the file: {track.title}{track.artist ? ` · ${track.artist}` : ''}
        </p>
      {/if}
    </div>
    <footer>
      <button
        type="button"
        onclick={useFile}
        disabled={!track?.edit}
        data-testid="track-name-reset"
      >
        Use the file's
      </button>
      <span class="spacer"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" data-testid="track-name-save">Save</button>
    </footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(440px, 94vw);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgb(5 5 10 / 0.7);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 12px 24px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .close {
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 24px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  label span {
    color: var(--muted);
  }
  input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .small {
    font-size: 12px;
  }
  footer {
    display: flex;
    gap: 8px;
    padding: 0 24px 20px;
  }
  .spacer {
    flex: 1;
  }
</style>
