<script lang="ts">
  import { untrack } from 'svelte';
  import { prepareCover } from '../core/library/track-covers';
  import {
    coverTonesOf,
    DEFAULT_TRACK_COLORS,
    MAX_OWN_COLORS,
    sanitizeTrackColors,
    toneColor,
    trackPalette,
    VIVID_RANGE,
    type Tone,
    type TrackColors,
    type TrackColorSource,
  } from '../core/render/cover-palette';
  import { decodeImage, IMAGE_TYPES } from '../core/render/visual-assets';
  import {
    shownArtist,
    shownCover,
    shownTitle,
    TRACK_TEXT_LENGTH,
    type Track,
  } from '../core/state/app-state';
  import { errorMessage } from '../core/util/format';
  import { backdropClose } from './backdrop';
  import { percent } from './controls/format';
  import Slider from './controls/Slider.svelte';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * Names a track (LS-18): the title and artist that the overlay, the queue and exports show,
   * its cover (LS-21) and the colours the visuals take from it (VE-12). They are kept for the
   * file; an empty title, or the file's own names, go back to the file's.
   */
  interface Props {
    /** The track to name; the dialog is open while there is one. */
    track: Track | null;
    onclose: () => void;
  }
  let { track, onclose }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  const heading = `track-name-${Math.random().toString(36).slice(2)}`;
  let dialog: HTMLDialogElement | undefined = $state();
  let coverInput: HTMLInputElement | undefined = $state();
  const backdrop = backdropClose(() => onclose());
  let title = $state('');
  let artist = $state('');
  /**
   * The cover chosen here, saved with the names: an image, null to take the user's away, or
   * undefined to keep the cover as it is.
   */
  let cover = $state<{ blob: Blob; url: string } | null | undefined>(undefined);
  let problem = $state<string | null>(null);
  /** The colours of the visuals for this track (VE-12), saved with the names. */
  let colors = $state<TrackColors>(DEFAULT_TRACK_COLORS);
  /** The tones of the cover shown here: what the colours of the cover are made of. */
  let tones = $state<Tone[] | null>(null);

  const SOURCES: { value: TrackColorSource; label: string }[] = [
    { value: 'cover', label: 'From the cover' },
    { value: 'own', label: 'Your own' },
    { value: 'look', label: "The look's" },
  ];

  /** The track as it is now (its cover may come later than the dialog). */
  const live = $derived(
    track ? ($app.tracks.find((entry) => entry.id === track.id) ?? track) : null,
  );
  const preview = $derived(
    cover === undefined ? live && shownCover(live) : cover === null ? live?.coverUrl : cover.url,
  );
  const ownCover = $derived(cover === undefined ? !!live?.ownCoverUrl : cover !== null);
  /** The palette the visuals take for this track, as set here; null: the look's own. */
  const palette = $derived(trackPalette(colors, tones));

  // The tones of the cover shown, found as the render worker finds them.
  $effect(() => {
    const url = preview;
    tones = null;
    if (!url) return;
    let current = true;
    fetch(url)
      .then((response) => response.blob())
      .then(decodeImage)
      .then((bitmap) => {
        const found = coverTonesOf(bitmap);
        bitmap.close();
        if (current) tones = found;
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });

  function chooseSource(source: TrackColorSource) {
    // Your own colours start from the cover's, or from two to change.
    const own =
      colors.own.length > 0
        ? colors.own
        : (tones?.filter((tone) => tone.C > 0).map(toneColor) ?? []).slice(0, MAX_OWN_COLORS);
    colors = { ...colors, source, own: own.length > 0 ? own : ['#ff2fd6', '#1ff0ff'] };
  }

  function setOwn(index: number, color: string) {
    colors = { ...colors, own: colors.own.map((old, i) => (i === index ? color : old)) };
  }

  function stage(next: { blob: Blob; url: string } | null | undefined) {
    const previous = untrack(() => cover);
    if (previous) URL.revokeObjectURL(previous.url);
    cover = next;
  }

  $effect(() => {
    if (!dialog) return;
    if (track && !dialog.open) {
      title = shownTitle(track);
      artist = shownArtist(track) ?? '';
      colors = { ...(track.colors ?? DEFAULT_TRACK_COLORS) };
      stage(undefined);
      problem = null;
      dialog.showModal();
    } else if (!track) {
      stage(undefined);
      if (dialog.open) dialog.close();
    }
  });

  async function pickCover(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    problem = null;
    try {
      const blob = await prepareCover(file);
      stage({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      problem = errorMessage(error);
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (track) {
      player.renameTrack(track.id, title, artist);
      if (cover !== undefined) void player.setOwnCover(track.id, cover?.blob ?? null);
      player.setTrackColors(track.id, sanitizeTrackColors(colors));
    }
    onclose();
  }

  function useFile() {
    if (track) {
      player.renameTrack(track.id, track.title, track.artist ?? '');
      if (live?.ownCoverUrl) void player.setOwnCover(track.id, null);
      player.setTrackColors(track.id, null);
    }
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
      <h2 id={heading}>Title, artist, cover and colours</h2>
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
      {#if live?.fingerprint}
        <div class="cover">
          <span class="label">Cover</span>
          <div class="cover-row">
            {#if preview}
              <img src={preview} alt="" data-testid="track-cover-preview" />
            {:else}
              <span class="cover-placeholder"><Icon name="music" size={22} /></span>
            {/if}
            <div class="cover-actions">
              <button
                type="button"
                onclick={() => coverInput?.click()}
                data-testid="track-cover-pick"
              >
                Choose an image…
              </button>
              <button
                type="button"
                onclick={() => stage(null)}
                disabled={!ownCover}
                data-testid="track-cover-remove"
              >
                {live.coverUrl ? "Use the file's cover" : 'Remove'}
              </button>
            </div>
          </div>
          <input
            bind:this={coverInput}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            hidden
            onchange={pickCover}
            data-testid="track-cover-input"
          />
          {#if problem}
            <p class="problem" role="alert" data-testid="track-cover-problem">{problem}</p>
          {/if}
          <p class="muted small">
            It shows in the queue, as the logo (with the cover art on) and in exports.
          </p>
        </div>
        <div class="colors" data-testid="track-colors">
          <span class="label">Colours of the visuals</span>
          <div class="sources" role="radiogroup" aria-label="Colours of the visuals">
            {#each SOURCES as { value, label } (value)}
              <button
                type="button"
                role="radio"
                aria-checked={colors.source === value}
                class:on={colors.source === value}
                onclick={() => chooseSource(value)}
                data-testid={`track-colors-${value}`}
              >
                {label}
              </button>
            {/each}
          </div>
          {#if colors.source === 'own'}
            <div class="own">
              {#each colors.own as color, index (index)}
                <input
                  type="color"
                  value={color}
                  aria-label={`Colour ${index + 1}`}
                  oninput={(event) => setOwn(index, event.currentTarget.value)}
                  data-testid="track-colors-pick"
                />
              {/each}
              {#if colors.own.length < MAX_OWN_COLORS}
                <button
                  type="button"
                  onclick={() => (colors = { ...colors, own: [...colors.own, colors.own[0]!] })}
                  aria-label="Add a colour"
                >
                  <Icon name="plus" size={14} />
                </button>
              {/if}
              {#if colors.own.length > 1}
                <button
                  type="button"
                  onclick={() => (colors = { ...colors, own: colors.own.slice(0, -1) })}
                  aria-label="Remove the last colour"
                >
                  <Icon name="minus" size={14} />
                </button>
              {/if}
            </div>
          {/if}
          {#if colors.source !== 'look'}
            <Slider
              label="Colourful"
              value={colors.vivid}
              min={VIVID_RANGE.min}
              max={VIVID_RANGE.max}
              step={0.05}
              format={percent}
              defaultValue={1}
              onchange={(vivid) => (colors = { ...colors, vivid })}
            />
          {/if}
          <div class="preview" data-testid="track-colors-preview">
            {#if palette}
              <span
                class="gradient"
                style:background={`linear-gradient(90deg, ${palette.gradient.join(', ')})`}
              ></span>
              <span class="layers">
                {#each palette.layers as color, index (index)}
                  <span style:background={color}></span>
                {/each}
              </span>
            {:else}
              <span class="none" data-testid="track-colors-none">
                {colors.source === 'look'
                  ? "The look's own palette"
                  : "No cover art: the look's palette"}
              </span>
            {/if}
          </div>
          <p class="muted small">
            With <em>The colours of the track playing</em> on (Visuals), live and in videos.
          </p>
        </div>
      {/if}
    </div>
    <footer>
      <button
        type="button"
        onclick={useFile}
        disabled={!live?.edit && !live?.ownCoverUrl && !live?.colors}
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
  .cover {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .cover .label {
    color: var(--muted);
  }
  .cover-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .cover-row img,
  .cover-placeholder {
    flex: none;
    width: 64px;
    height: 64px;
    border-radius: 8px;
    object-fit: cover;
    background: var(--surface-2);
  }
  .cover-placeholder {
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .cover-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .colors {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }
  .colors .label {
    color: var(--muted);
  }
  .sources {
    display: flex;
    gap: 6px;
  }
  .sources button {
    flex: 1;
    padding: 6px 8px;
    font-size: 13px;
  }
  .sources button.on {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .own {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .own input {
    width: 44px;
    height: 32px;
    padding: 2px;
  }
  .own button {
    padding: 6px;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preview .gradient {
    height: 14px;
    border-radius: 7px;
  }
  .preview .layers {
    display: flex;
    gap: 4px;
  }
  .preview .layers span {
    flex: 1;
    height: 8px;
    border-radius: 4px;
  }
  .preview .none {
    color: var(--muted);
    font-size: 12px;
  }
  .problem {
    margin: 0;
    color: var(--fail);
    font-size: 13px;
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
