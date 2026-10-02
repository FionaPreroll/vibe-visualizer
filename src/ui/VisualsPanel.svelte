<script lang="ts">
  import { RENDER_SCALE_RANGE } from '../core/render/auto-quality';
  import { SYNC_OFFSET_RANGE } from '../core/state/app-state';
  import { percent } from './controls/format';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import KaleidoPanel from './KaleidoPanel.svelte';
  import LogoSpectrumPanel from './LogoSpectrumPanel.svelte';
  import { usePlayer } from './player-context';
  import { liveScale } from './render-quality';
  import SyncCalibration from './SyncCalibration.svelte';
  import TrackInfoSection from './TrackInfoSection.svelte';

  /**
   * The settings of the visual mode on the stage, and for all modes the track overlay (LS-18),
   * the display (VE-07) and the A/V sync (AN-06).
   */
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

{#if $app.settings.visualMode !== 'analysis'}
  <TrackInfoSection />
{/if}

<Section title="Display">
  <Slider
    label="Resolution"
    value={$app.settings.renderScale}
    min={RENDER_SCALE_RANGE.min}
    max={RENDER_SCALE_RANGE.max}
    step={0.05}
    format={percent}
    defaultValue={1}
    onchange={(value) => player.updateSettings({ renderScale: value })}
  />
  <label class="check">
    <input
      type="checkbox"
      checked={$app.settings.autoQuality}
      onchange={(event) => player.updateSettings({ autoQuality: event.currentTarget.checked })}
      data-testid="auto-quality"
    />
    Lower it while the visuals stutter
  </label>
  <label class="check">
    <input
      type="checkbox"
      checked={$app.settings.reduceFlashing}
      onchange={(event) => player.updateSettings({ reduceFlashing: event.currentTarget.checked })}
      data-testid="reduce-flashing"
    />
    Reduce flashing
  </label>
  <p class="hint">Damps sudden jumps in brightness, in exports too.</p>
  <p class="hint" data-testid="live-scale">
    Drawn at {percent($liveScale)} of the screen's resolution{#if $app.settings.autoQuality && $liveScale < $app.settings.renderScale - 1e-6}
      (lowered, the frame rate dropped){/if}. Exports always render at their own resolution.
  </p>
</Section>

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
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13px;
  }
</style>
