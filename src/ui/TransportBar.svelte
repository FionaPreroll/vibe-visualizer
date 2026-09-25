<script lang="ts">
  import { onMount } from 'svelte';
  import { formatDuration } from '../core/util/format';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  const player = usePlayer();
  const app = player.store;

  let position = $state(0);
  let dragFraction = $state<number | null>(null);
  let timeline: HTMLDivElement | undefined = $state();

  const current = $derived($app.tracks.find((track) => track.id === $app.currentId) ?? null);
  const live = $derived($app.live.status === 'on');
  const duration = $derived(current?.duration ?? 0);
  const shown = $derived(dragFraction !== null ? dragFraction * duration : position);
  const fraction = $derived(duration > 0 ? Math.min(1, shown / duration) : 0);
  const marks = $derived(current?.marks ?? { in: null, out: null });
  const marked = $derived(marks.in !== null || marks.out !== null);
  const inFraction = $derived(duration > 0 ? (marks.in ?? 0) / duration : 0);
  const outFraction = $derived(duration > 0 ? (marks.out ?? duration) / duration : 1);

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
    const rect = timeline!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }

  function onPointerDown(event: PointerEvent) {
    if (!current || duration <= 0) return;
    timeline!.setPointerCapture(event.pointerId);
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
    {#if live}
      <div class="cover-placeholder live"><Icon name="live" /></div>
      <div class="titles">
        <span class="title" data-testid="now-title">Live input</span>
        <span class="artist">{$app.live.label}</span>
      </div>
    {:else}
      {#if current?.coverUrl}
        <img src={current.coverUrl} alt="" />
      {:else}
        <div class="cover-placeholder"><Icon name="music" /></div>
      {/if}
      <div class="titles">
        <span class="title" data-testid="now-title">{current?.title ?? 'Nothing playing'}</span>
        <span class="artist">{current?.artist ?? ''}</span>
      </div>
    {/if}
  </div>

  {#if live}
    <div class="center live-center">
      <span class="badge"><span class="dot"></span> LIVE</span>
      <span class="hint">Choose a track in the queue to go back to it.</span>
      <button onclick={() => player.stopLive()} data-testid="transport-stop-live">
        Stop live input
      </button>
    </div>
  {:else}
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
        <span class="divider"></span>
        <button
          class="icon"
          onclick={() => player.mark('in')}
          aria-label="Mark in"
          title="Mark in (I): start of the export range"
          disabled={!current}
        >
          <Icon name="markIn" />
        </button>
        <button
          class="icon"
          onclick={() => player.mark('out')}
          aria-label="Mark out"
          title="Mark out (O): end of the export range"
          disabled={!current}
        >
          <Icon name="markOut" />
        </button>
        {#if marked}
          <button
            class="marks"
            onclick={() => {
              player.mark('in', null);
              player.mark('out', null);
            }}
            title="Clear the markers"
            data-testid="marks"
          >
            {formatDuration(marks.in ?? 0)}–{formatDuration(marks.out ?? duration)}
            <Icon name="close" size={14} />
          </button>
        {/if}
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
          {#if marked}
            <div
              class="range"
              style:left="{inFraction * 100}%"
              style:width="{Math.max(0, outFraction - inFraction) * 100}%"
              data-testid="marked-range"
            ></div>
            {#if marks.in !== null}<div class="mark" style:left="{inFraction * 100}%"></div>{/if}
            {#if marks.out !== null}<div class="mark" style:left="{outFraction * 100}%"></div>{/if}
          {/if}
          <div class="knob" style:left="{fraction * 100}%"></div>
        </div>
        <span class="time">-{formatDuration(Math.max(0, duration - shown))}</span>
      </div>
    </div>
  {/if}

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
  .live-center {
    flex-direction: row;
    justify-content: center;
    gap: 14px;
  }
  .badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--fail);
    color: #fff;
    font: 600 12px var(--mono);
  }
  .badge .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fail);
    box-shadow: 0 0 6px var(--fail);
  }
  .live-center .hint {
    font-size: 12px;
    color: var(--muted);
  }
  .live-center button {
    white-space: nowrap;
  }
  .cover-placeholder.live {
    color: var(--fail);
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
  .range {
    position: absolute;
    top: 5px;
    height: 10px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-2) 22%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-2) 60%, transparent);
    pointer-events: none;
  }
  .mark {
    position: absolute;
    top: 2px;
    width: 2px;
    height: 16px;
    margin-left: -1px;
    background: var(--accent-2);
    pointer-events: none;
  }
  .divider {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }
  .marks {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent-2);
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
