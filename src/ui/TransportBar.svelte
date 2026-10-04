<script lang="ts">
  import { onMount } from 'svelte';
  import { beatBefore } from '../core/analysis/beat-grid';
  import { tempoSections } from '../core/analysis/tempo-sections';
  import {
    REPEAT_MODES,
    shownArtist,
    shownCover,
    shownTitle,
    type RepeatMode,
  } from '../core/state/app-state';
  import { formatDuration } from '../core/util/format';
  import Icon from './Icon.svelte';
  import LiveTempo from './LiveTempo.svelte';
  import { usePlayer } from './player-context';
  import { CUE_COLOURS, drawWaveform } from './waveform-draw';

  const player = usePlayer();
  const app = player.store;
  const analyses = player.analysis;

  const REPEAT_LABELS: Record<RepeatMode, string> = {
    off: 'Repeat off',
    all: 'Repeat the queue',
    one: 'Repeat the track',
  };

  let position = $state(0);
  let dragFraction = $state<number | null>(null);
  let timeline: HTMLDivElement | undefined = $state();
  let waveCanvas: HTMLCanvasElement | undefined = $state();
  let timelineWidth = $state(0);

  const current = $derived($app.tracks.find((track) => track.id === $app.currentId) ?? null);
  const live = $derived($app.live.status === 'on');
  const duration = $derived(current?.duration ?? 0);
  const shown = $derived(dragFraction !== null ? dragFraction * duration : position);
  const fraction = $derived(duration > 0 ? Math.min(1, shown / duration) : 0);
  /** While a marker is dragged on the timeline: which one, and where it would go. */
  let markDrag = $state<{ mark: 'in' | 'out'; seconds: number } | null>(null);
  const marks = $derived.by(() => {
    const stored = current?.marks ?? { in: null, out: null };
    return markDrag ? { ...stored, [markDrag.mark]: markDrag.seconds } : stored;
  });
  const marked = $derived(marks.in !== null || marks.out !== null);
  const inFraction = $derived(duration > 0 ? (marks.in ?? 0) / duration : 0);
  /** The queue moves on at the out marker, unless the playhead is past it already. */
  const playEnd = $derived(marks.out !== null && shown < marks.out ? marks.out : duration);
  const outFraction = $derived(duration > 0 ? (marks.out ?? duration) / duration : 1);
  /** The waveform of the whole track as the seek bar (TR-03), once it is being analysed. */
  const analysis = $derived(current?.fingerprint ? $analyses.get(current.fingerprint) : undefined);
  const waveform = $derived(analysis?.waveform ?? null);
  const cues = $derived(current?.cues ?? []);
  /** Where the beat grid changes tempo (Korrektur 5): the start and tempo of each new section. */
  const tempoChanges = $derived(analysis?.grid ? tempoSections(analysis.grid).slice(1) : []);

  onMount(() => {
    let request = 0;
    const tick = () => {
      position = player.position;
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  });

  $effect(() => {
    if (!timeline) return;
    const observer = new ResizeObserver(([entry]) => {
      timelineWidth = entry?.contentRect.width ?? 0;
    });
    observer.observe(timeline);
    return () => observer.disconnect();
  });

  const waveformStyle = $derived($app.settings.waveformStyle);

  // Redrawn when the analysis grows or the bar changes size; the played part is an overlay.
  $effect(() => {
    const canvas = waveCanvas;
    if (!canvas || !waveform || timelineWidth <= 0 || duration <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(timelineWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const view = { from: 0, to: duration, played: Infinity, available: analysis?.seconds ?? 0 };
    drawWaveform(context, waveform, view, width, height, waveformStyle);
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

  /** Where a marker goes: on the beat, within the track, and on its side of the other one. */
  function clampMark(mark: 'in' | 'out', seconds: number): number {
    const stored = current?.marks;
    let target = Math.max(0, Math.min(duration, seconds));
    const other = mark === 'in' ? stored?.out : stored?.in;
    if (other !== null && other !== undefined) {
      target = mark === 'in' ? Math.min(target, other - 0.1) : Math.max(target, other + 0.1);
    }
    return Math.max(0, target);
  }

  function grabMark(event: PointerEvent, mark: 'in' | 'out') {
    // A marker is moved, not the playhead.
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    markDrag = { mark, seconds: clampMark(mark, player.snap(fractionAt(event) * duration)) };
  }

  function moveMark(event: PointerEvent) {
    if (!markDrag) return;
    event.stopPropagation();
    const seconds = clampMark(markDrag.mark, player.snap(fractionAt(event) * duration));
    markDrag = { mark: markDrag.mark, seconds };
  }

  function dropMark(event: PointerEvent) {
    if (!markDrag) return;
    event.stopPropagation();
    const { mark, seconds } = markDrag;
    markDrag = null;
    player.mark(mark, seconds, false);
  }

  /** ←/→ on a marker: to the previous or next beat (0.1 s without a beat grid or quantizing). */
  function onMarkKey(event: KeyboardEvent, mark: 'in' | 'out') {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const at = current?.marks[mark];
    if (at === null || at === undefined) return;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const grid = analysis?.grid;
    let target = at + direction * 0.1;
    if (grid && $app.settings.quantize) {
      const index = beatBefore(grid, at + direction * 1e-3) + (direction > 0 ? 1 : 0);
      const beat = grid.beats[index];
      if (beat !== undefined) target = beat;
    }
    player.mark(mark, clampMark(mark, target), false);
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
      {#if current && shownCover(current)}
        <img src={shownCover(current)} alt="" data-testid="now-cover" />
      {:else}
        <div class="cover-placeholder"><Icon name="music" /></div>
      {/if}
      <div class="titles">
        <span class="title" data-testid="now-title"
          >{current ? shownTitle(current) : 'Nothing playing'}</span
        >
        <span class="artist">{current ? (shownArtist(current) ?? '') : ''}</span>
      </div>
    {/if}
  </div>

  {#if live}
    <div class="center live-center">
      <span class="badge"><span class="dot"></span> LIVE</span>
      <LiveTempo />
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
        <button
          class="icon"
          class:on={$app.settings.shuffle}
          onclick={() => player.updateSettings({ shuffle: !$app.settings.shuffle })}
          aria-label="Shuffle"
          aria-pressed={$app.settings.shuffle}
          title="Shuffle: play the queue in random order"
          data-testid="shuffle"
        >
          <Icon name="shuffle" />
        </button>
        <button
          class="icon repeat"
          class:on={$app.settings.repeat !== 'off'}
          onclick={() =>
            player.updateSettings({
              repeat: REPEAT_MODES[(REPEAT_MODES.indexOf($app.settings.repeat) + 1) % 3]!,
            })}
          aria-label={REPEAT_LABELS[$app.settings.repeat]}
          title={`${REPEAT_LABELS[$app.settings.repeat]} (click to change)`}
          data-testid="repeat"
          data-mode={$app.settings.repeat}
        >
          <Icon name="repeat" />
          {#if $app.settings.repeat === 'one'}<span class="one">1</span>{/if}
        </button>
        <span class="divider"></span>
        <button
          class="icon"
          onclick={() => player.mark('in')}
          aria-label="Mark in"
          title="Mark in (I): the track starts here, and so does the export"
          disabled={!current}
        >
          <Icon name="markIn" />
        </button>
        <button
          class="icon"
          onclick={() => player.mark('out')}
          aria-label="Mark out"
          title="Mark out (O): the queue moves on here, and the export ends"
          disabled={!current}
        >
          <Icon name="markOut" />
        </button>
        <button
          class="icon"
          class:on={$app.settings.quantize}
          onclick={() => player.updateSettings({ quantize: !$app.settings.quantize })}
          aria-label="Snap to the beat"
          aria-pressed={$app.settings.quantize}
          title="Snap markers and cues to the beat (Q)"
          data-testid="quantize"
        >
          <Icon name="magnet" />
        </button>
        <button
          class="icon"
          class:on={$app.settings.detailWaveform}
          onclick={() => player.updateSettings({ detailWaveform: !$app.settings.detailWaveform })}
          aria-label="Detail waveform and hot cues"
          aria-pressed={$app.settings.detailWaveform}
          title="Detail waveform and hot cues (W)"
          data-testid="detail-toggle"
        >
          <Icon name="wave" />
        </button>
        {#if marked}
          <button
            class="marks"
            onclick={() => player.clearMarks()}
            title="The part that plays and exports; click to clear the markers"
            data-testid="marks"
          >
            {formatDuration(marks.in ?? 0)}–{formatDuration(marks.out ?? duration)}
            <span class="length" data-testid="marks-length">
              · {formatDuration((marks.out ?? duration) - (marks.in ?? 0))}
            </span>
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
          class:wave={waveform !== null}
        >
          {#if waveform}
            <canvas class="waveform" bind:this={waveCanvas} data-testid="waveform-overview"
            ></canvas>
            <div class="unplayed" style:left="{fraction * 100}%"></div>
          {:else}
            <div class="track"><div class="fill" style:width="{fraction * 100}%"></div></div>
          {/if}
          {#if duration > 0}
            {#each tempoChanges as change (change.start)}
              <div
                class="tempo-change"
                style:left="{(change.start / duration) * 100}%"
                title="The beat grid changes to {change.bpm.toFixed(1)} BPM at {formatDuration(
                  change.start,
                )}"
                data-testid="tempo-change"
              >
                {change.bpm.toFixed(0)}
              </div>
            {/each}
          {/if}
          {#each cues as cue, index (index)}
            {#if cue !== null && duration > 0}
              <div
                class="cue"
                style:left="{(cue / duration) * 100}%"
                style:--cue={CUE_COLOURS[index]}
                data-testid="cue-marker"
              >
                {index + 1}
              </div>
            {/if}
          {/each}
          {#if marked}
            <div
              class="range"
              style:left="{inFraction * 100}%"
              style:width="{Math.max(0, outFraction - inFraction) * 100}%"
              data-testid="marked-range"
            ></div>
            {#each ['in', 'out'] as const as mark (mark)}
              {@const seconds = marks[mark]}
              {#if seconds !== null}
                <div
                  class="mark"
                  class:dragging={markDrag?.mark === mark}
                  style:left="{(seconds / duration) * 100}%"
                  role="slider"
                  tabindex="0"
                  aria-label={mark === 'in' ? 'In marker' : 'Out marker'}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(seconds)}
                  aria-valuetext={formatDuration(seconds)}
                  title="Drag to move; ← → moves it by a beat"
                  onpointerdown={(event) => grabMark(event, mark)}
                  onpointermove={moveMark}
                  onpointerup={dropMark}
                  onpointercancel={() => (markDrag = null)}
                  onkeydown={(event) => onMarkKey(event, mark)}
                  data-testid="mark-{mark}"
                ></div>
              {/if}
            {/each}
          {/if}
          <div class="knob" style:left="{fraction * 100}%"></div>
        </div>
        <span class="time" title={playEnd < duration ? 'Until the out marker' : undefined}>
          -{formatDuration(Math.max(0, playEnd - shown))}
        </span>
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
  .icon.on {
    color: var(--accent-2);
  }
  .repeat {
    position: relative;
  }
  .repeat .one {
    position: absolute;
    right: 5px;
    bottom: 5px;
    font: 700 9px var(--mono);
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
  .timeline.wave {
    height: 32px;
  }
  .waveform {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 3px;
  }
  /* The rest of the track is dimmed; the played part shows in full colour. */
  .unplayed {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--surface) 58%, transparent);
    pointer-events: none;
  }
  .cue {
    position: absolute;
    top: -2px;
    min-width: 11px;
    height: 11px;
    margin-left: -1px;
    padding: 0 2px;
    border-radius: 0 3px 3px 0;
    border-left: 2px solid var(--cue);
    background: color-mix(in srgb, var(--cue) 70%, black);
    color: #fff;
    font: 600 9px/11px var(--mono);
    pointer-events: none;
  }
  /* A tempo change of the beat grid: a line with the new tempo at its foot. */
  .tempo-change {
    position: absolute;
    bottom: -3px;
    height: 11px;
    margin-left: -1px;
    padding: 0 2px;
    border-left: 2px solid var(--warning);
    border-radius: 0 3px 3px 0;
    background: color-mix(in srgb, var(--warning) 70%, black);
    color: #000;
    font: 600 9px/11px var(--mono);
    pointer-events: none;
  }
  .tempo-change::before {
    content: '';
    position: absolute;
    left: -2px;
    bottom: 11px;
    width: 1px;
    height: 24px;
    background: color-mix(in srgb, var(--warning) 70%, transparent);
  }
  .timeline:not(.wave) .tempo-change::before {
    height: 12px;
  }
  .timeline.wave .range {
    top: 0;
    height: 30px;
  }
  .timeline.wave .mark {
    top: 0;
    height: 32px;
  }
  .timeline.wave .knob {
    top: 0;
    width: 2px;
    height: 32px;
    margin-left: -1px;
    border-radius: 1px;
    opacity: 1;
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
  /* A marker is a line with a wider, invisible grip around it. */
  .mark {
    position: absolute;
    top: 2px;
    width: 10px;
    height: 16px;
    margin-left: -5px;
    cursor: ew-resize;
    touch-action: none;
    z-index: 1;
  }
  .mark::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent-2);
  }
  .mark:hover::before,
  .mark:focus-visible::before,
  .mark.dragging::before {
    left: 3px;
    width: 4px;
  }
  .mark:focus-visible {
    outline: none;
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
  .marks .length {
    color: var(--muted);
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
