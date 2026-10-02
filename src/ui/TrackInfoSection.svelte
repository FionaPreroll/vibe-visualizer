<script lang="ts">
  import {
    DEFAULT_OVERLAY,
    OVERLAY_FONTS,
    OVERLAY_POSITIONS,
    OVERLAY_RANGES,
    type OverlayFont,
    type OverlayPosition,
    type OverlaySettings,
  } from '../core/render/overlay-settings';
  import { shownArtist, shownTitle, type Track } from '../core/state/app-state';
  import { percent } from './controls/format';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import { usePlayer } from './player-context';
  import TrackNameDialog from './TrackNameDialog.svelte';

  /**
   * The track overlay (LS-18, LS-19), for both modes: the title and artist of the track playing
   * over the visuals, with its progress and time on request.
   */
  const player = usePlayer();
  const app = player.store;
  const overlay = $derived($app.settings.overlay);
  const current = $derived($app.tracks.find((track) => track.id === $app.currentId) ?? null);
  let naming = $state<Track | null>(null);

  const set = (changes: Partial<OverlaySettings>) =>
    player.updateSettings({ overlay: { ...overlay, ...changes } });

  const FONT_NAMES: Record<OverlayFont, string> = {
    sans: 'Montserrat',
    condensed: 'Bebas Neue',
    serif: 'Playfair Display',
    mono: 'Space Mono',
    script: 'Pacifico',
    tech: 'Orbitron',
  };
  const POSITION_NAMES: Record<OverlayPosition, string> = {
    'top-left': 'Top left',
    top: 'Top',
    'top-right': 'Top right',
    left: 'Left',
    center: 'Centre',
    right: 'Right',
    'bottom-left': 'Bottom left',
    bottom: 'Bottom',
    'bottom-right': 'Bottom right',
  };
  const secondsText = (value: number) => `${value.toFixed(1)} s`;
</script>

<Section title="Track info">
  <label class="check">
    <input
      type="checkbox"
      checked={overlay.on}
      onchange={(event) => set({ on: event.currentTarget.checked })}
      data-testid="overlay-on"
    />
    Show the title and artist
  </label>
  {#if overlay.on}
    <div class="row">
      <label for="overlay-font">Font</label>
      <select
        id="overlay-font"
        value={overlay.font}
        onchange={(event) => set({ font: event.currentTarget.value as OverlayFont })}
        data-testid="overlay-font"
      >
        {#each OVERLAY_FONTS as font (font)}
          <option value={font}>{FONT_NAMES[font]}</option>
        {/each}
      </select>
    </div>
    <div class="row">
      <span class="label" id="overlay-position-label">Position</span>
      <div class="positions" role="radiogroup" aria-labelledby="overlay-position-label">
        {#each OVERLAY_POSITIONS as position (position)}
          <button
            role="radio"
            aria-checked={overlay.position === position}
            aria-label={POSITION_NAMES[position]}
            title={POSITION_NAMES[position]}
            class:on={overlay.position === position}
            onclick={() => set({ position })}
            data-testid="overlay-position-{position}"
          ></button>
        {/each}
      </div>
    </div>
    <div class="row">
      <label for="overlay-color">Colour</label>
      <input
        id="overlay-color"
        type="color"
        value={overlay.color}
        oninput={(event) => set({ color: event.currentTarget.value })}
      />
    </div>
    <Slider
      label="Size"
      value={overlay.size}
      min={OVERLAY_RANGES.size[0]}
      max={OVERLAY_RANGES.size[1]}
      step={0.05}
      format={percent}
      defaultValue={DEFAULT_OVERLAY.size}
      onchange={(size) => set({ size })}
    />
    <Slider
      label="Fade"
      value={overlay.fade}
      min={OVERLAY_RANGES.fade[0]}
      max={OVERLAY_RANGES.fade[1]}
      step={0.1}
      format={secondsText}
      defaultValue={DEFAULT_OVERLAY.fade}
      onchange={(fade) => set({ fade })}
    />
    <Slider
      label="Stays for"
      value={overlay.hold}
      min={OVERLAY_RANGES.hold[0]}
      max={OVERLAY_RANGES.hold[1]}
      step={1}
      format={(value) => (value === 0 ? 'Whole track' : `${Math.round(value)} s`)}
      defaultValue={DEFAULT_OVERLAY.hold}
      onchange={(hold) => set({ hold: Math.round(hold) })}
    />
    <label class="check">
      <input
        type="checkbox"
        checked={overlay.progress}
        onchange={(event) => set({ progress: event.currentTarget.checked })}
        data-testid="overlay-progress"
      />
      Progress bar
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={overlay.time}
        onchange={(event) => set({ time: event.currentTarget.checked })}
        data-testid="overlay-time"
      />
      Time
    </label>
    <p class="hint">
      It fades in at the start of each track, live and in exports, in both modes. Names come from
      the file; give a track others with ✎ in the queue.
    </p>
    {#if current}
      <div class="now">
        <span class="name" data-testid="overlay-now">
          {shownTitle(current)}{#if shownArtist(current)}
            · {shownArtist(current)}{/if}
        </span>
        <button onclick={() => (naming = current)} data-testid="overlay-rename">Rename…</button>
      </div>
    {/if}
  {/if}
</Section>

<TrackNameDialog track={naming} onclose={() => (naming = null)} />

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13px;
  }
  .row {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 36px;
  }
  .row label,
  .row .label {
    font-size: 13px;
    color: var(--muted);
  }
  select {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }
  .positions {
    display: grid;
    grid-template-columns: repeat(3, 30px);
    gap: 3px;
    padding: 3px;
    width: max-content;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .positions button {
    width: 30px;
    height: 18px;
    padding: 0;
    border-radius: 3px;
    background: var(--surface-2);
  }
  .positions button.on {
    border-color: var(--accent);
    background: var(--accent);
  }
  .hint {
    margin: 4px 0 6px;
    color: var(--muted);
    font-size: 12px;
  }
  .now {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
