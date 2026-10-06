<script lang="ts">
  import { onMount } from 'svelte';
  import { beatBefore } from '../core/analysis/beat-grid';
  import { isGridEdited } from '../core/analysis/grid-edit';
  import { CUE_COUNT } from '../core/state/app-state';
  import { formatDuration } from '../core/util/format';
  import { usePlayer } from './player-context';
  import { onFrame } from './frame-clock';
  import { CUE_COLOURS, WaveformStrip } from './waveform-draw';

  /**
   * The detail view around the playhead (TR-08): the waveform of the seconds before and after,
   * zoomable, with the beat grid (the first beat of each bar stronger), the cues and the in/out
   * markers; drag it to move, click to jump, drag a marker to move it (it snaps to the beat
   * while quantizing). A button switches the waveform style (TR-10); others correct the beat
   * grid (TR-11): the beat at the playhead starts its bar, the bars a beat earlier or later, the
   * grid a few milliseconds earlier or later, or Shift+drag to move it. On the left the eight
   * hot cues (TR-04): click to jump to one, or to set an empty one at the playhead; Shift+click
   * or the right button deletes it. The keys 1–8 do the same.
   */
  const player = usePlayer();
  const app = player.store;
  const analyses = player.analysis;

  /** Seconds shown across the view. */
  const ZOOMS = [2, 4, 8, 16, 32, 64];
  let zoom = $state(2);
  let canvas: HTMLCanvasElement | undefined = $state();
  /** While dragging: where the drag started and the position then. */
  let drag: { x: number; at: number; moved: boolean; pointer: number } | null = null;
  let dragOffset = 0;
  /** While dragging a marker: which one, and where it would go. */
  let markDrag: { mark: 'in' | 'out'; seconds: number } | null = null;
  /** How close to a marker (CSS pixels) a press grabs it. */
  const GRAB = 6;
  /** While the beat grid is dragged (Shift+drag): where the drag started, the shift then and now. */
  let gridDrag = $state<{ x: number; from: number; shift: number } | null>(null);
  /** Steps of the grid buttons, in seconds (with Shift the fine one). */
  const GRID_STEP = 0.005;
  const GRID_FINE_STEP = 0.001;

  const current = $derived($app.tracks.find((track) => track.id === $app.currentId) ?? null);
  const cues = $derived(current?.cues ?? []);
  const hasGrid = $derived(
    current?.fingerprint ? ($analyses.get(current.fingerprint)?.grid ?? null) !== null : false,
  );
  /** A shift of the grid in milliseconds, to a tenth: "+5 ms", "-1.5 ms", "0 ms". */
  function formatShift(seconds: number): string {
    const ms = Math.round(seconds * 10000) / 10;
    return `${ms > 0 ? '+' : ''}${ms || 0} ms`;
  }

  /** The grid's shift as shown: as dragged, or as corrected. */
  const gridShift = $derived(gridDrag?.shift ?? current?.gridEdit.shift ?? 0);

  onMount(() => onFrame(render, 'detail waveform'));

  /**
   * Seconds at the middle of the view (the playhead, moved by a drag) at `now`, moving on
   * smoothly between the audio callbacks.
   */
  function centre(now?: number): number {
    return player.displayPosition(now) + dragOffset;
  }

  function span(): number {
    return ZOOMS[zoom]!;
  }

  /** The waveform drawn once into a strip, which each frame copies as the view moves. */
  const strip = new WaveformStrip();

  /** What the last frame was drawn from: an unchanged view (paused, say) is not drawn again. */
  let drawn: readonly unknown[] = [];

  /** True if `inputs` differ from those of the last frame drawn; they are kept then. */
  function changed(inputs: readonly unknown[]): boolean {
    if (inputs.length === drawn.length && inputs.every((value, i) => value === drawn[i])) {
      return false;
    }
    drawn = inputs;
    return true;
  }

  /** Draws the view of the frame at `now` (its time, as the animation frame gives it). */
  function render(now?: number): void {
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (width === 0 || height === 0) return;
    const track = player.currentTrack;
    const analysis = player.analysisOf(track);
    const at = centre(now);
    const style = $app.settings.waveformStyle;
    // The track (its cues and markers), its analysis (growing while analysed, its grid as
    // corrected), the view and a marker dragged: all a frame shows.
    const inputs = [width, height, ratio, track, analysis, at, zoom, style, markDrag];
    if (!changed(inputs)) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const from = at - span() / 2;
    const to = at + span() / 2;
    const x = (time: number) => ((time - from) / (to - from)) * width;
    strip.draw(
      context,
      analysis?.waveform ?? null,
      { from, to, played: at, available: analysis?.seconds ?? 0 },
      width,
      height,
      style,
    );
    // Beat grid: a line on every beat, stronger where the beat is clear; bar lines (on the
    // first beat of each bar, AN-11) wider and brighter, with a mark at the top.
    const grid = analysis?.grid;
    if (grid) {
      let index = Math.max(0, beatBefore(grid, from));
      for (; index < grid.beats.length && grid.beats[index]! <= to; index++) {
        const confidence = grid.confidence[index]!;
        const position = Math.round(x(grid.beats[index]!));
        if (grid.beatInBar?.[index] === 0) {
          context.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * confidence})`;
          context.fillRect(position - Math.round(ratio / 2), 0, 2 * ratio, height);
          context.fillRect(position - 3 * ratio, 0, 6 * ratio, 3 * ratio);
        } else {
          context.fillStyle = `rgba(255,255,255,${0.06 + 0.18 * confidence})`;
          context.fillRect(position, 0, Math.max(1, ratio), height);
        }
      }
    }
    // The play and export range and its markers (as dragged, while a marker is dragged).
    const marks = shownMarks();
    if (marks && (marks.in !== null || marks.out !== null)) {
      const start = x(marks.in ?? 0);
      const end = x(marks.out ?? track?.duration ?? to);
      context.fillStyle = 'rgba(79,209,197,0.12)';
      context.fillRect(start, 0, end - start, height);
      context.fillStyle = '#4fd1c5';
      if (marks.in !== null) context.fillRect(Math.round(start), 0, 2 * ratio, height);
      if (marks.out !== null) context.fillRect(Math.round(end) - 2 * ratio, 0, 2 * ratio, height);
    }
    // Cues: a line and a numbered flag.
    const cueList = track?.cues ?? [];
    context.font = `600 ${Math.round(10 * ratio)}px ui-monospace, monospace`;
    context.textBaseline = 'middle';
    for (let index = 0; index < cueList.length; index++) {
      const cue = cueList[index];
      if (cue === null || cue === undefined || cue < from || cue > to) continue;
      const position = Math.round(x(cue));
      context.fillStyle = CUE_COLOURS[index]!;
      context.fillRect(position, 0, Math.max(1, ratio), height);
      context.fillRect(position, 0, 13 * ratio, 13 * ratio);
      context.fillStyle = '#000';
      context.fillText(String(index + 1), position + 3 * ratio, 7 * ratio);
    }
    // The playhead, once there is a track.
    if (!track) return;
    context.fillStyle = '#fff';
    context.fillRect(Math.round(width / 2) - ratio, 0, 2 * ratio, height);
  }

  function secondsPerPixel(): number {
    return canvas ? span() / canvas.clientWidth : 0;
  }

  /** The current track's markers, with the one being dragged where it would go. */
  function shownMarks() {
    const marks = player.currentTrack?.marks;
    if (!marks || !markDrag) return marks;
    return { ...marks, [markDrag.mark]: markDrag.seconds };
  }

  /** Seconds under the pointer. */
  function secondsAt(event: PointerEvent): number {
    const rect = canvas!.getBoundingClientRect();
    return centre() + (event.clientX - rect.left - rect.width / 2) * secondsPerPixel();
  }

  /** The marker within reach of the pointer, if any. */
  function markerAt(event: PointerEvent): 'in' | 'out' | null {
    const marks = player.currentTrack?.marks;
    if (!marks || !canvas) return null;
    const reach = GRAB * secondsPerPixel();
    const at = secondsAt(event);
    for (const mark of ['in', 'out'] as const) {
      const seconds = marks[mark];
      if (seconds !== null && Math.abs(seconds - at) <= reach) return mark;
    }
    return null;
  }

  /** Where a dragged marker goes: on the beat, within the track and on its side of the other. */
  function markTarget(mark: 'in' | 'out', event: PointerEvent): number {
    const track = player.currentTrack;
    const duration = track?.duration ?? Infinity;
    let seconds = Math.max(0, Math.min(duration, player.snap(secondsAt(event))));
    const other = mark === 'in' ? track?.marks.out : track?.marks.in;
    if (other !== null && other !== undefined) {
      seconds = mark === 'in' ? Math.min(seconds, other - 0.1) : Math.max(seconds, other + 0.1);
    }
    return Math.max(0, seconds);
  }

  function onPointerDown(event: PointerEvent) {
    if (!canvas || !player.currentTrack || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    if (event.shiftKey && hasGrid) {
      const shift = player.currentTrack.gridEdit.shift;
      gridDrag = { x: event.clientX, from: shift, shift };
      return;
    }
    const mark = markerAt(event);
    if (mark) {
      markDrag = { mark, seconds: markTarget(mark, event) };
      return;
    }
    drag = { x: event.clientX, at: player.position, moved: false, pointer: event.pointerId };
  }

  function onPointerMove(event: PointerEvent) {
    if (gridDrag) {
      const shift = gridDrag.from + (event.clientX - gridDrag.x) * secondsPerPixel();
      gridDrag = { ...gridDrag, shift };
      player.shiftGrid(shift, false);
      return;
    }
    if (markDrag) {
      markDrag = { mark: markDrag.mark, seconds: markTarget(markDrag.mark, event) };
      return;
    }
    if (!drag) {
      if (canvas) {
        canvas.style.cursor =
          event.shiftKey && hasGrid ? 'col-resize' : markerAt(event) ? 'ew-resize' : '';
      }
      return;
    }
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    // Dragging moves the waveform under the playhead.
    if (drag.moved) dragOffset = drag.at - player.position - dx * secondsPerPixel();
  }

  function onPointerUp(event: PointerEvent) {
    if (gridDrag) {
      player.shiftGrid(gridDrag.shift, true);
      gridDrag = null;
      return;
    }
    if (markDrag) {
      player.mark(markDrag.mark, markTarget(markDrag.mark, event), false);
      markDrag = null;
      return;
    }
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const target = drag.moved
      ? player.position + dragOffset
      : player.position + (event.clientX - rect.left - rect.width / 2) * secondsPerPixel();
    drag = null;
    dragOffset = 0;
    void player.seek(target);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom + (event.deltaY > 0 ? 1 : -1)));
  }

  function onCue(index: number, event: MouseEvent) {
    if (event.shiftKey) player.setCue(index, null);
    else void player.cue(index);
  }
</script>

<section class="detail" aria-label="Detail waveform" data-testid="detail-waveform">
  <div class="cues" role="group" aria-label="Hot cues">
    {#each Array.from({ length: CUE_COUNT }, (_, index) => index) as index (index)}
      {@const cue = cues[index] ?? null}
      <button
        class:set={cue !== null}
        style:--cue={CUE_COLOURS[index]}
        onclick={(event) => onCue(index, event)}
        oncontextmenu={(event) => {
          event.preventDefault();
          player.setCue(index, null);
        }}
        disabled={!current}
        title={cue !== null
          ? `Cue ${index + 1} at ${formatDuration(cue)}: click to jump, Shift+click to delete (key ${index + 1})`
          : `Set cue ${index + 1} at the playhead (key ${index + 1})`}
        aria-label={cue !== null
          ? `Cue ${index + 1} at ${formatDuration(cue)}`
          : `Set cue ${index + 1}`}
        data-testid="cue-pad"
        data-set={cue !== null}
      >
        {index + 1}
      </button>
    {/each}
  </div>
  <div class="view">
    <canvas
      bind:this={canvas}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={() => {
        drag = null;
        dragOffset = 0;
        markDrag = null;
        if (gridDrag) player.shiftGrid(gridDrag.from, false);
        gridDrag = null;
      }}
      onwheel={onWheel}
    ></canvas>
    {#if !current}
      <p class="empty" data-testid="detail-empty">
        The waveform of the track playing shows here, with its beat grid and hot cues.
      </p>
    {/if}
    <div
      class="grid-tools"
      class:hidden={!current}
      role="group"
      aria-label="Beat grid"
      data-testid="grid-tools"
    >
      <button
        onclick={() => player.setDownbeat()}
        disabled={!hasGrid}
        title="Beat 1 here: the beat at the playhead starts its bar"
        data-testid="grid-downbeat">1 here</button
      >
      <span class="pair">
        <button
          onclick={() => player.moveBars(-1)}
          disabled={!hasGrid}
          aria-label="Bars one beat earlier"
          title="The bars start one beat earlier"
          data-testid="grid-bars-earlier">◂</button
        >
        <span>bar</span>
        <button
          onclick={() => player.moveBars(1)}
          disabled={!hasGrid}
          aria-label="Bars one beat later"
          title="The bars start one beat later"
          data-testid="grid-bars-later">▸</button
        >
      </span>
      <span class="pair">
        <button
          onclick={(event) => player.nudgeGrid(-(event.shiftKey ? GRID_FINE_STEP : GRID_STEP))}
          disabled={!hasGrid}
          aria-label="Beat grid earlier"
          title="Move the beat grid 5 ms earlier (Shift: 1 ms), or Shift+drag the waveform"
          data-testid="grid-earlier">◂</button
        >
        <span data-testid="grid-shift">{formatShift(gridShift)}</span>
        <button
          onclick={(event) => player.nudgeGrid(event.shiftKey ? GRID_FINE_STEP : GRID_STEP)}
          disabled={!hasGrid}
          aria-label="Beat grid later"
          title="Move the beat grid 5 ms later (Shift: 1 ms), or Shift+drag the waveform"
          data-testid="grid-later">▸</button
        >
      </span>
      {#if current && isGridEdited(current.gridEdit)}
        <button
          onclick={() => player.resetGrid()}
          aria-label="Reset the beat grid"
          title="The beat grid as the analysis found it"
          data-testid="grid-reset">↺</button
        >
      {/if}
    </div>
    <button
      class="style"
      onclick={() =>
        player.updateSettings({
          waveformStyle: $app.settings.waveformStyle === 'bands' ? 'rgb' : 'bands',
        })}
      title={$app.settings.waveformStyle === 'bands'
        ? 'Three bands: lows blue, mids orange, highs white. Click for RGB'
        : 'RGB: coloured by the bands. Click for three bands'}
      data-testid="waveform-style"
      data-style={$app.settings.waveformStyle}
    >
      {$app.settings.waveformStyle === 'bands' ? '3 bands' : 'RGB'}
    </button>
  </div>
  <div class="zoom" role="group" aria-label="Zoom">
    <button
      onclick={() => (zoom = Math.max(0, zoom - 1))}
      disabled={zoom === 0}
      aria-label="Zoom in"
      title="Zoom in (or the mouse wheel)">+</button
    >
    <span data-testid="detail-span">{ZOOMS[zoom]} s</span>
    <button
      onclick={() => (zoom = Math.min(ZOOMS.length - 1, zoom + 1))}
      disabled={zoom === ZOOMS.length - 1}
      aria-label="Zoom out"
      title="Zoom out">−</button
    >
  </div>
</section>

<style>
  .detail {
    display: flex;
    align-items: stretch;
    gap: 8px;
    height: 72px;
    padding: 6px 12px;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }
  .cues {
    display: grid;
    grid-template-columns: repeat(4, 26px);
    gap: 4px;
    align-content: center;
  }
  .cues button {
    height: 26px;
    padding: 0;
    border-radius: 5px;
    font: 600 11px var(--mono);
    color: var(--muted);
    border-color: color-mix(in srgb, var(--cue) 40%, var(--border));
  }
  .cues button.set {
    background: var(--cue);
    border-color: var(--cue);
    color: #000;
  }
  .view {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 6px;
    background: #0b0b14;
    cursor: grab;
    touch-action: none;
  }
  .style {
    position: absolute;
    right: 4px;
    bottom: 4px;
    padding: 0 5px;
    border-color: transparent;
    border-radius: 4px;
    background: rgb(11 11 20 / 0.7);
    font: 10px/16px var(--mono);
    color: var(--muted);
    opacity: 0.6;
  }
  .view:hover .style,
  .style:focus-visible {
    opacity: 1;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 0 12px;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    pointer-events: none;
  }
  .grid-tools.hidden {
    display: none;
  }
  .grid-tools {
    position: absolute;
    left: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
    font: 10px/16px var(--mono);
    color: var(--muted);
    opacity: 0.6;
  }
  .view:hover .grid-tools,
  .grid-tools:focus-within {
    opacity: 1;
  }
  .grid-tools button {
    padding: 0 5px;
    border-color: transparent;
    border-radius: 4px;
    background: rgb(11 11 20 / 0.7);
    font: inherit;
    color: inherit;
  }
  .grid-tools button:hover:not(:disabled) {
    color: var(--text);
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 1px;
    border-radius: 4px;
    background: rgb(11 11 20 / 0.7);
  }
  .pair button {
    background: transparent;
  }
  canvas:active {
    cursor: grabbing;
  }
  .zoom {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font: 11px var(--mono);
    color: var(--muted);
  }
  .zoom button {
    width: 26px;
    height: 22px;
    padding: 0;
  }
</style>
