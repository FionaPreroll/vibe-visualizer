<script lang="ts">
  import { SYNC_OFFSET_RANGE } from '../core/state/app-state';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import KaleidoPanel from './KaleidoPanel.svelte';
  import LogoSpectrumPanel from './LogoSpectrumPanel.svelte';
  import { usePlayer } from './player-context';
  import SyncCalibration from './SyncCalibration.svelte';

  /** The settings of the visual mode on the stage, and the A/V sync of all modes (AN-06). */
  const player = usePlayer();
  const app = player.store;
  let calibrating = $state(false);
</script>

{#if $app.settings.visualMode === 'kaleidoscope'}
  <KaleidoPanel />
{:else if $app.settings.visualMode === 'logoSpectrum'}
  <LogoSpectrumPanel />
{:else}
  <p class="note">
    The analysis view shows what the visuals react to. It has no settings; switch to Logo Spectrum
    or Kaleidoscope in the top bar to set up the visuals.
  </p>
{/if}

<Section title="A/V sync">
  <Slider
    label="Visuals later by"
    value={$app.settings.syncOffset}
    min={SYNC_OFFSET_RANGE.min}
    max={SYNC_OFFSET_RANGE.max}
    step={5}
    format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)} ms`}
    defaultValue={0}
    onchange={(value) => player.updateSettings({ syncOffset: Math.round(value) })}
  />
  <p class="hint">
    For sound that comes late, over Bluetooth for example. Only what you see while playing; exports
    are always in sync.
  </p>
  <button onclick={() => (calibrating = true)} data-testid="sync-calibrate">Calibrate…</button>
</Section>

<SyncCalibration open={calibrating} onclose={() => (calibrating = false)} />

<style>
  .note {
    margin: 16px;
    color: var(--muted);
    font-size: 14px;
  }
  .hint {
    margin: 4px 0 10px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
