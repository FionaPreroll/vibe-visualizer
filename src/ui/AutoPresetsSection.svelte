<script lang="ts">
  import {
    AUTO_RANGES,
    AUTO_TRIGGERS,
    DEFAULT_AUTO_PRESETS,
    type AutoPresets,
    type AutoTrigger,
  } from '../core/render/preset-director';
  import { seconds } from './controls/format';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import { usePlayer } from './player-context';

  /**
   * Automatic preset switching (PR-02) for the visual mode shown: every so many seconds, bars
   * or on the drops, to the next preset or a random one, with a morph. Exports switch the same
   * way.
   */
  const player = usePlayer();
  const app = player.store;
  const auto = $derived($app.settings.autoPresets);
  const mode = $derived(
    $app.settings.visualMode === 'kaleidoscope' ? 'kaleidoscope' : 'logoSpectrum',
  );
  const favourites = $derived($app.settings.favourites[mode].length);

  const set = (changes: Partial<AutoPresets>) =>
    player.updateSettings({ autoPresets: { ...auto, ...changes } });

  const TRIGGER_NAMES: Record<AutoTrigger, string> = {
    seconds: 'Seconds',
    bars: 'Bars',
    drops: 'Drops',
  };
</script>

<Section title="Preset switching">
  <label class="check">
    <input
      type="checkbox"
      checked={auto.on}
      onchange={(event) => set({ on: event.currentTarget.checked })}
      data-testid="auto-presets"
    />
    Switch presets automatically
  </label>
  <div class="choice">
    <span class="label">Every</span>
    <div class="quick" role="radiogroup" aria-label="Switch every">
      {#each AUTO_TRIGGERS as trigger (trigger)}
        <button
          role="radio"
          aria-checked={auto.trigger === trigger}
          class:on={auto.trigger === trigger}
          onclick={() => set({ trigger })}
        >
          {TRIGGER_NAMES[trigger]}
        </button>
      {/each}
    </div>
  </div>
  {#if auto.trigger === 'seconds'}
    <Slider
      label="Seconds"
      value={auto.seconds}
      min={AUTO_RANGES.seconds[0]}
      max={AUTO_RANGES.seconds[1]}
      step={5}
      defaultValue={DEFAULT_AUTO_PRESETS.seconds}
      format={(value) => `${value.toFixed(0)} s`}
      onchange={(value) => set({ seconds: value })}
    />
  {:else if auto.trigger === 'bars'}
    <Slider
      label="Bars"
      value={auto.bars}
      min={AUTO_RANGES.bars[0]}
      max={AUTO_RANGES.bars[1]}
      step={1}
      defaultValue={DEFAULT_AUTO_PRESETS.bars}
      format={(value) => value.toFixed(0)}
      onchange={(value) => set({ bars: Math.round(value) })}
    />
  {:else}
    <p class="hint">On each drop: when the bass and the kick come back after a quieter part.</p>
  {/if}
  <Slider
    label="Morph"
    value={auto.transition}
    min={AUTO_RANGES.transition[0]}
    max={AUTO_RANGES.transition[1]}
    step={0.25}
    defaultValue={DEFAULT_AUTO_PRESETS.transition}
    format={seconds}
    onchange={(value) => set({ transition: value })}
  />
  <div class="choice">
    <span class="label">Next</span>
    <div class="quick" role="radiogroup" aria-label="Next preset">
      {#each [['sequence', 'In order'], ['random', 'Random']] as const as [order, label] (order)}
        <button
          role="radio"
          aria-checked={auto.order === order}
          class:on={auto.order === order}
          onclick={() => set({ order })}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>
  <div class="choice">
    <span class="label">From</span>
    <div class="quick" role="radiogroup" aria-label="Presets that take part">
      {#each [['all', 'All'], ['favourites', 'Favourites']] as const as [pool, label] (pool)}
        <button
          role="radio"
          aria-checked={auto.pool === pool}
          class:on={auto.pool === pool}
          onclick={() => set({ pool })}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>
  {#if auto.pool === 'favourites' && favourites < 2}
    <p class="hint">Fewer than two favourites: all presets take part. Mark some with the star.</p>
  {/if}
  <p class="hint">Exports switch the same way.</p>
</Section>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13px;
  }
  .choice {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .choice .label {
    font-size: 13px;
    color: var(--muted);
  }
  .quick {
    display: flex;
    gap: 6px;
  }
  .quick button {
    flex: 1;
    padding: 4px 8px;
    font-size: 13px;
    background: transparent;
  }
  .quick button.on {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .hint {
    margin: 4px 0 8px;
    font-size: 12px;
    color: var(--muted);
  }
</style>
