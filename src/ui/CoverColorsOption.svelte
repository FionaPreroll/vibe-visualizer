<script lang="ts">
  import { usePlayer } from './player-context';

  /**
   * The switch for the colours of the cover art (VE-12): the palette of the track playing's
   * cover instead of the look's, in both modes, live and in exports. An app setting, as the
   * cover as the logo is: the looks and their presets keep their palettes.
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
  Colours from the cover art of the track playing
</label>
{#if $app.settings.coverColors}
  <p class="hint" data-testid="cover-colors-hint">
    Instead of the palette, live and in videos; tracks without cover art keep the palette.
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
