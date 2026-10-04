<script lang="ts">
  import { onMount } from 'svelte';
  import { shownArtist, shownTitle } from '../core/state/app-state';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * The mini player's controls (DS-06), over the visuals at the bottom of its window: the track
   * playing, previous, play or pause, next, and back to the tab. They show while the pointer is
   * in the window or a control has the keyboard's focus, and for a moment after it opened.
   */
  let { onback }: { onback: () => void } = $props();

  const player = usePlayer();
  const app = player.store;
  const current = $derived($app.tracks.find((track) => track.id === $app.currentId) ?? null);
  const live = $derived($app.live.status === 'on');
  const artist = $derived(live ? $app.live.label : current ? shownArtist(current) : undefined);
  let fresh = $state(true);

  onMount(() => {
    const timer = setTimeout(() => (fresh = false), 3000);
    return () => clearTimeout(timer);
  });
</script>

<div class="controls" class:fresh data-testid="mini-controls">
  <div class="titles">
    <span class="title" data-testid="mini-title"
      >{live ? 'Live input' : current ? shownTitle(current) : 'Nothing playing'}</span
    >
    {#if artist}<span class="artist">{artist}</span>{/if}
  </div>
  {#if !live}
    <div class="buttons">
      <button
        class="icon"
        onclick={() => player.previous()}
        aria-label="Previous"
        disabled={!current}
      >
        <Icon name="previous" />
      </button>
      <button
        class="icon play"
        onclick={() => player.toggle()}
        aria-label={$app.playing ? 'Pause' : 'Play'}
        disabled={$app.tracks.length === 0}
        data-testid="mini-play"
      >
        <Icon name={$app.playing ? 'pause' : 'play'} size={22} />
      </button>
      <button class="icon" onclick={() => player.next()} aria-label="Next" disabled={!current}>
        <Icon name="next" />
      </button>
    </div>
  {/if}
  <button
    class="icon back"
    onclick={onback}
    aria-label="Back to the tab"
    title="Back to the tab (M)"
    data-testid="mini-back"
  >
    <Icon name="backToTab" />
  </button>
</div>

<style>
  .controls {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 28px 10px 8px;
    background: linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0));
    opacity: 0;
    transition: opacity 0.25s;
  }
  :global(body:hover) .controls,
  .controls:has(:focus-visible),
  .controls.fresh {
    opacity: 1;
  }
  .titles {
    flex: 1 1 120px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }
  .title,
  .artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-weight: 600;
    font-size: 14px;
  }
  .artist {
    font-size: 12px;
    color: var(--muted);
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border-color: transparent;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
  }
  .play {
    width: 40px;
    height: 40px;
    background: var(--accent);
    color: #120a1f;
  }
</style>
