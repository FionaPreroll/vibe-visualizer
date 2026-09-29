<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SYNC_OFFSET_RANGE } from '../core/state/app-state';
  import Slider from './controls/Slider.svelte';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * Calibrates the A/V sync (AN-06): a tick every second, and a flash when the visuals take it
   * to be heard. Moving the offset until both come together puts the visuals in sync with what
   * you hear, whatever the output (Bluetooth headphones, a TV, a Mac that reports nothing).
   */
  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  const engine = player.engine;
  /** Seconds between the ticks, and how long a flash lasts. */
  const INTERVAL = 1;
  const FLASH = 0.12;

  let dialog: HTMLDialogElement | undefined = $state();
  let flash = $state(0);
  let reported = $state<number | null>(null);
  let frame = 0;
  let ticks: number[] = [];
  let next = 0;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void start();
    } else if (!open && dialog.open) {
      stop();
      dialog.close();
    }
  });

  onDestroy(stop);

  async function start() {
    player.pause();
    await engine.start();
    reported = engine.reportedLatency;
    ticks = [];
    next = engine.contextTime + 0.4;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    flash = 0;
  }

  function loop() {
    frame = requestAnimationFrame(loop);
    // The ticks are scheduled a little ahead, on the audio clock.
    while (next < engine.contextTime + 0.25) {
      engine.beep(next);
      ticks = [...ticks.slice(-3), next];
      next += INTERVAL;
    }
    const clock = engine.outputClock();
    if (!clock) return;
    const now = performance.timeOrigin + performance.now();
    const heard = clock.contextTime + (now - clock.performanceTime) / 1000;
    const last = ticks.findLast((tick) => tick <= heard);
    flash = last === undefined ? 0 : Math.max(0, 1 - (heard - last) / FLASH);
  }

  function setOffset(value: number) {
    const { min, max } = SYNC_OFFSET_RANGE;
    player.updateSettings({ syncOffset: Math.max(min, Math.min(max, Math.round(value))) });
  }

  const reportedMs = $derived(reported === null ? null : Math.round(reported * 1000));
</script>

<dialog bind:this={dialog} aria-labelledby="sync-title" {onclose} data-testid="sync-dialog">
  <header>
    <h2 id="sync-title">A/V sync</h2>
    <button class="close" onclick={onclose} aria-label="Close">
      <Icon name="close" size={18} />
    </button>
  </header>
  <p>
    You hear a tick every second, and the circle flashes when the visuals take it to be heard. Move
    the slider until both come together.
  </p>
  <div class="stage">
    <div class="flash" style:opacity={0.12 + 0.88 * flash} data-testid="sync-flash"></div>
  </div>
  <Slider
    label="Visuals later by"
    value={$app.settings.syncOffset}
    min={SYNC_OFFSET_RANGE.min}
    max={SYNC_OFFSET_RANGE.max}
    step={5}
    format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)} ms`}
    defaultValue={0}
    onchange={setOffset}
  />
  <div class="steps">
    <button onclick={() => setOffset($app.settings.syncOffset - 10)}>−10 ms</button>
    <button onclick={() => setOffset($app.settings.syncOffset + 10)}>+10 ms</button>
  </div>
  <p class="note" data-testid="sync-reported">
    {#if reportedMs === null}
      Starting the audio…
    {:else if reportedMs > 0}
      The browser reports {reportedMs} ms of output latency; the visuals wait for it already.
    {:else}
      The browser reports no output latency. Over Bluetooth, or in Chrome on a Mac, the sound comes
      later: calibrate here.
    {/if}
    Exports are always in sync.
  </p>
  <footer>
    <button class="primary" onclick={onclose}>Done</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(480px, 94vw);
    padding: 20px 24px 24px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgba(5, 5, 10, 0.7);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .close {
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
  p {
    font-size: 14px;
  }
  .stage {
    display: grid;
    place-items: center;
    height: 160px;
    margin: 8px 0 16px;
    border-radius: 10px;
    background: var(--bg);
  }
  .flash {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0%, var(--accent-2) 55%, var(--accent) 100%);
  }
  .steps {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 8px;
  }
  .note {
    color: var(--muted);
    font-size: 13px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
