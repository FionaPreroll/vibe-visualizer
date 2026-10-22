<script lang="ts">
  import { onMount } from 'svelte';
  import { APP_VERSION } from '../core/env/version';
  import { perf, type PerfSnapshot } from './perf';

  /**
   * The measurements of `?perf` on screen, to look into a stutter on a real computer (the perf
   * workflow has no graphics card): over the last ten seconds, the frames of the page (and a
   * strip of the last ones, those that came late in red), the work of each live part of the UI
   * and how evenly the playhead moves on; since the last reset, the long frames and the scripts
   * in them; and the memory and the frame rate of the visuals. Copy puts all of it on the
   * clipboard, for a bug report.
   */

  /** Frames the measurements look back on: ten seconds at 60 a second. */
  const WINDOW = 600;
  /** Frames the strip shows. */
  const BARS = 240;
  /** Height of the strip's scale (ms): a frame this long fills it. */
  const SCALE_MS = 50;
  /** A frame that took more than this many times the usual is drawn as late. */
  const LATE = 1.5;

  let snapshot = $state<PerfSnapshot | null>(null);
  let open = $state(true);
  let copied = $state(false);
  let canvas: HTMLCanvasElement | undefined = $state();

  const fps = $derived(snapshot && snapshot.frames.p50 > 0 ? 1000 / snapshot.frames.p50 : null);
  const parts = $derived(
    snapshot
      ? Object.entries(snapshot.parts)
          .filter(([, spread]) => spread.count > 0)
          .sort((a, b) => b[1].p95 - a[1].p95)
      : [],
  );
  const topScript = $derived(
    snapshot ? (Object.entries(snapshot.longFrames.scripts)[0] ?? null) : null,
  );

  function ms(value: number, digits = 1): string {
    return `${value.toFixed(digits)} ms`;
  }

  /** The strip of the last frames: a bar each, as high as the frame took, late ones red. */
  function drawStrip(): void {
    if (!canvas || !perf) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const frames = perf.recentFrames(BARS);
    const usual = snapshot?.frames.p50 ?? 16.7;
    const bar = width / BARS;
    frames.forEach((frame, index) => {
      const barHeight = Math.min(1, frame / SCALE_MS) * height;
      context.fillStyle = frame > LATE * usual ? '#ff5c7a' : '#3fd9ff';
      context.fillRect(
        (BARS - frames.length + index) * bar,
        height - barHeight,
        Math.max(1, bar - ratio),
        barHeight,
      );
    });
    // The usual frame time, as a line.
    context.fillStyle = 'rgba(233,233,243,0.45)';
    context.fillRect(0, height - Math.min(1, usual / SCALE_MS) * height, width, ratio);
  }

  function update(): void {
    if (!perf) return;
    snapshot = perf.snapshot(WINDOW);
    drawStrip();
  }

  async function copy(): Promise<void> {
    if (!perf) return;
    const report = {
      version: APP_VERSION,
      browser: navigator.userAgent,
      screen: `${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
      lastTenSeconds: perf.snapshot(WINDOW),
      sinceReset: perf.snapshot(),
      recentFrames: perf.recentFrames(BARS).map((frame) => Math.round(frame * 10) / 10),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // No clipboard (an insecure page, or refused): nothing to copy to.
    }
  }

  onMount(() => {
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  });
</script>

<section class="perf" class:closed={!open} aria-label="Performance" data-testid="perf-overlay">
  <header>
    <button class="title" onclick={() => (open = !open)} aria-expanded={open}>
      {open ? '▾' : '▸'} Performance
      {#if fps !== null}<span class="fps" data-testid="perf-fps">{Math.round(fps)} fps</span>{/if}
    </button>
    {#if open}
      <button onclick={() => perf?.reset()} data-testid="perf-reset">Reset</button>
      <button onclick={copy} data-testid="perf-copy">{copied ? 'Copied' : 'Copy'}</button>
    {/if}
  </header>
  {#if open && snapshot}
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    <dl>
      <dt>Frames (10 s)</dt>
      <dd data-testid="perf-frames">
        p95 {snapshot.frames.p95.toFixed(1)} / p99 {ms(snapshot.frames.p99)} · {snapshot.frames
          .dropped} late
      </dd>
      <dt>UI work / frame</dt>
      <dd>p95 {ms(snapshot.work.p95, 2)}</dd>
      {#each parts as [label, spread] (label)}
        <dt class="part">{label}</dt>
        <dd>p95 {ms(spread.p95, 2)}</dd>
      {/each}
      <dt>Playhead</dt>
      <dd data-testid="perf-playhead">
        {#if snapshot.playhead}
          off by {ms(snapshot.playhead.shown.sd, 2)}
          <span class="sub">(published: {ms(snapshot.playhead.published.sd, 2)})</span>
        {:else}
          not playing
        {/if}
      </dd>
      <dt>Long frames</dt>
      <dd data-testid="perf-long">
        {snapshot.longFrames.count}{snapshot.longFrames.count > 0
          ? ` · worst ${snapshot.longFrames.worstMs} ms`
          : ''}
        {#if topScript}<span class="sub script" title={topScript[0]}>{topScript[0]}</span>{/if}
      </dd>
      {#if snapshot.heapMB !== null}
        <dt>Memory</dt>
        <dd>{snapshot.heapMB} MB</dd>
      {/if}
      {#if snapshot.visualsFps !== null}
        <dt>Visuals</dt>
        <dd>{snapshot.visualsFps} fps</dd>
      {/if}
    </dl>
  {/if}
</section>

<style>
  .perf {
    position: fixed;
    top: 66px;
    left: 12px;
    z-index: 50;
    width: 300px;
    padding: 6px 8px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgb(11 11 18 / 0.88);
    font: 11px/1.45 var(--mono);
    color: var(--text);
  }
  .perf.closed {
    width: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  header button {
    padding: 1px 7px;
    font: inherit;
  }
  .title {
    flex: 1;
    border-color: transparent;
    background: transparent;
    text-align: left;
    font-weight: 600;
  }
  .fps {
    margin-left: 6px;
    font-weight: 400;
    color: var(--accent-2);
  }
  canvas {
    display: block;
    width: 100%;
    height: 40px;
    margin: 6px 0 4px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.04);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 8px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dt.part {
    padding-left: 8px;
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  .sub {
    color: var(--muted);
  }
  .script {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
