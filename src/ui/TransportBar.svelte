<script lang="ts">
  import { onMount } from 'svelte';
  import { formatDuration } from '../core/util/format';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  const player = usePlayer();
  const app = player.store;

  let position = $state(0);
  let dragFraction = $state<number | null>(null);
  let timeline: HTMLDivElement;

  const current = $derived($app.tracks.find((track) => track.id === $app.currentId) ?? null);
  const duration = $derived(current?.duration ?? 0);
  const shown = $derived(dragFraction !== null ? dragFraction * duration : position);
  const fraction = $derived(duration > 0 ? Math.min(1, shown / duration) : 0);

  onMount(() => {
    let request = 0;
    const tick = () => {
      position = player.position;
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  });

  function fractionAt(event: PointerEvent): number {
    const rect = timeline.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }

  function onPointerDown(event: PointerEvent) {
    if (!current || duration <= 0) return;
    timeline.setPointerCapture(event.pointerId);
    dragFraction = fractionAt(event);
  }

  function onPointerMove(event: PointerEvent) {
    if (dragFraction !== null) dragFraction = fractionAt(event);
  }

  function onPointerUp(event: PointerEvent) {
    if (dragFraction === null) return;
    const target = fractionAt(event) * duration;
    dragFraction = null;
    void player.seek(target);
  }

  function onTimelineKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 30 : 5;
    if (event.key === 'ArrowLeft') void player.seek(position - step);
    else if (event.key === 'ArrowRight') void player.seek(position + step);
    else if (event.key === 'Home') void player.seek(0);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<footer class="transport" data-testid="transport">
  <div class="now">
    {#if current?.coverUrl}
      <img src={current.coverUrl} alt="" />
    {:else}
      <div class="cover-placeholder"><Icon name="music" /></div>
    {/if}
    <div class="titles">
      <span class="title" data-testid="now-title">{current?.title ?? 'Nothing playing'}</span>
      <span class="artist">{current?.artist ?? ''}</span>
    </div>
  </div>

  <div class="center">
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
        data-testid="play-button"
      >
        <Icon name={$app.playing ? 'pause' : 'play'} size={24} />
      </button>
      <button class="icon" onclick={() => player.next()} aria-label="Next" disabled={!current}>
        <Icon name="next" />
      </button>
      <button class="icon" onclick={() => player.stop()} aria-label="Stop" disabled={!current}>
        <Icon name="stop" />
      </button>
    </div>
    <div class="timeline-row">
      <span class="time" data-testid="elapsed" data-seconds={position.toFixed(2)}>
        {formatDuration(shown)}
      </span>
      <div
        class="timeline"
        bind:this={timeline}
        role="slider"
        tabindex="0"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={formatDuration(shown)}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onkeydown={onTimelineKey}
        data-testid="timeline"
      >
        <div class="track"><div class="fill" style:width="{fraction * 100}%"></div></div>
        <div class="knob" style:left="{fraction * 100}%"></div>
      </div>
      <span class="time">-{formatDuration(Math.max(0, duration - shown))}</span>
    </div>
  </div>

  <label class="volume">
    <Icon name="volume" />
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={$app.settings.volume}
      oninput={(event) => player.updateSettings({ volume: Number(event.currentTarget.value) })}
      aria-label="Volume"
    />
  </label>
</footer>

<style>
  .transport {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(320px, 2.2fr) minmax(140px, 1fr);
    align-items: center;
    gap: 24px;
    padding: 10px 20px;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .now {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  img,
  .cover-placeholder {
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .cover-placeholder {
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--muted);
  }
  .titles {
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
  .artist {
    color: var(--muted);
    font-size: 13px;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    border-color: transparent;
  }
  .icon:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .icon.play {
    width: 44px;
    height: 44px;
    background: var(--text);
    color: var(--bg);
  }
  .icon.play:hover:not(:disabled) {
    background: #fff;
  }
  .timeline-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }
  .time {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    min-width: 52px;
    text-align: center;
  }
  .timeline {
    position: relative;
    flex: 1;
    height: 20px;
    cursor: pointer;
    touch-action: none;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: 8px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
  }
  .knob {
    position: absolute;
    top: 4px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .timeline:hover .knob,
  .timeline:focus-visible .knob {
    opacity: 1;
  }
  .volume {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    color: var(--muted);
  }
  .volume input {
    width: 110px;
    accent-color: var(--accent);
  }
</style>
