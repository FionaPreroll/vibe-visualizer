<script lang="ts">
  import { usePlayer } from './player-context';

  /**
   * The switch for the colours of the track (VE-12): those of the track playing's cover art, or
   * as set for the track, instead of the look's palette, in both modes, live and in exports. An
   * app setting, as the cover as the logo is: the looks and their presets keep their palettes.
   */
  const player = usePlayer();
  const app = player.store;
</script>

<label class="option">
  <input
    type="checkbox"
    checked={$app.settings.coverColors}
    onchange={(event) => player.updateSettings({ coverColors: event.currentTarget.checked })}
    data-testid="cover-colors"
  />
  The colours of the track playing
</label>
{#if $app.settings.coverColors}
  <p class="hint" data-testid="cover-colors-hint">
    From its cover art, or as you set them with ✎ in the queue, instead of the palette; live and in
    videos. Tracks without either keep the palette.
  </p>
{/if}

<style>
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
