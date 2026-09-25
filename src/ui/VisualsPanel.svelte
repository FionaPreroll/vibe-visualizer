<script lang="ts">
  import KaleidoPanel from './KaleidoPanel.svelte';
  import LogoSpectrumPanel from './LogoSpectrumPanel.svelte';
  import { usePlayer } from './player-context';

  /** The settings of the visual mode on the stage. */
  const player = usePlayer();
  const app = player.store;
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

<style>
  .note {
    margin: 16px;
    color: var(--muted);
    font-size: 14px;
  }
</style>
