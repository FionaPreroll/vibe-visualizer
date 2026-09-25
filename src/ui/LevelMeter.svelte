<script lang="ts">
  import { onMount } from 'svelte';
  import { F } from '../core/analysis/features';
  import { usePlayer } from './player-context';

  /**
   * Level of what the engine analyses (IN-03): RMS as a bar, the peak as a line that holds for a
   * moment, and a clip light. Read from the newest analysis frame, in dBFS.
   */
  const player = usePlayer();
  const FLOOR = -60;
  const HOLD_MS = 1500;
  const SCALE = [-48, -36, -24, -12, -6, 0];

  let rms = $state(FLOOR);
  let peak = $state(FLOOR);
  let hold = $state(FLOOR);
  let clipped = $state(false);

  const toDb = (value: number) => Math.max(FLOOR, 20 * Math.log10(Math.max(value, 1e-6)));
  const position = (db: number) => ((db - FLOOR) / -FLOOR) * 100;

  onMount(() => {
    const frame = new Float32Array(F.size);
    let holdUntil = 0;
    let clipUntil = 0;
    let request = 0;
    const tick = (now: number) => {
      const timeline = player.engine.timeline;
      const at = timeline.latestEngineFrame();
      if (at < 0 || timeline.sample(at, frame) === null) frame.fill(0);
      rms = toDb(frame[F.rms]!);
      peak = toDb(frame[F.peak]!);
      if (peak >= hold || now > holdUntil) {
        hold = peak;
        holdUntil = now + HOLD_MS;
      }
      if (frame[F.peak]! >= 0.99) clipUntil = now + HOLD_MS;
      clipped = now < clipUntil;
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  });
</script>

<div class="meter">
  <div
    class="bar"
    role="meter"
    aria-label="Input level"
    aria-valuemin={FLOOR}
    aria-valuemax={0}
    aria-valuenow={Math.round(peak)}
    aria-valuetext="{Math.round(peak)} dBFS"
    data-testid="level-meter"
    data-peak={peak.toFixed(1)}
  >
    <div class="peak" style:width="{position(peak)}%"></div>
    <div class="rms" style:clip-path="inset(0 {100 - position(rms)}% 0 0)"></div>
    <div class="hold" style:left="{position(hold)}%"></div>
  </div>
  <span class="clip" class:on={clipped} title="Clipping: turn the input gain down">CLIP</span>
  <div class="scale" aria-hidden="true">
    {#each SCALE as db (db)}
      <span style:left="{position(db)}%">{db}</span>
    {/each}
  </div>
</div>

<style>
  .meter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 8px;
    row-gap: 2px;
    align-items: center;
  }
  .bar {
    position: relative;
    height: 12px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .rms,
  .peak {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
  }
  /* Green up to -12 dB, yellow to -6 dB, red above; clipped to the level. */
  .rms {
    right: 0;
    background: linear-gradient(90deg, #2fcf62 0 80%, #ffc53d 80% 90%, #ff5c7a 90%);
  }
  .peak {
    background: rgba(255, 255, 255, 0.18);
  }
  .hold {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: #fff;
  }
  .clip {
    padding: 1px 6px;
    border-radius: 4px;
    font: 600 11px var(--mono);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .clip.on {
    color: #fff;
    background: var(--fail);
    border-color: var(--fail);
  }
  .scale {
    position: relative;
    height: 14px;
    font: 10px var(--mono);
    color: var(--muted);
  }
  .scale span {
    position: absolute;
    transform: translateX(-50%);
  }
  .scale span:last-child {
    transform: translateX(-100%);
  }
</style>
