<script lang="ts" generics="S">
  import type { Writable } from 'svelte/store';
  import Icon from '../Icon.svelte';

  /**
   * Preset picker for a visual mode (PR-01, PR-03, PR-04): built-in presets and your own, which
   * you can save from the current settings, delete, mark as favourites, pick at random, and
   * export to a file or import from one. The preset shown is the one that matches the current
   * settings exactly; any change turns it into "Custom settings".
   */
  interface Preset {
    name: string;
    settings: S;
    builtIn: boolean;
  }
  interface Props {
    /** The mode, as named in preset files. */
    mode: 'logoSpectrum' | 'kaleidoscope';
    builtIn: readonly Preset[];
    /** Your presets of this mode (kept in storage). */
    store: Writable<Preset[]>;
    current: S;
    onapply: (settings: S) => void;
    favourites: readonly string[];
    onfavourites: (names: string[]) => void;
    /** Valid settings of this mode from a file (defaults where it has none). */
    sanitize: (value: unknown) => S;
  }
  let { mode, builtIn, store, current, onapply, favourites, onfavourites, sanitize }: Props =
    $props();

  let name = $state('');
  let message = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  const all = $derived([...builtIn, ...$store]);
  const active = $derived(
    all.find((preset) => JSON.stringify(preset.settings) === JSON.stringify(current))?.name ?? '',
  );
  const favourite = $derived(favourites.includes(active));
  const star = (presetName: string) => (favourites.includes(presetName) ? '★ ' : '');

  function apply(presetName: string) {
    const preset = all.find((entry) => entry.name === presetName);
    if (preset) onapply(preset.settings);
  }

  function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) return;
    store.update((presets) => [
      ...presets.filter((preset) => preset.name !== trimmed),
      { name: trimmed, settings: current, builtIn: false },
    ]);
    name = '';
  }

  function remove(presetName: string) {
    store.update((presets) => presets.filter((preset) => preset.name !== presetName));
    if (favourites.includes(presetName)) {
      onfavourites(favourites.filter((entry) => entry !== presetName));
    }
  }

  function toggleFavourite() {
    if (!active) return;
    onfavourites(
      favourite ? favourites.filter((entry) => entry !== active) : [...favourites, active],
    );
  }

  /** Any other preset, from the favourites when there are two or more. */
  function random() {
    const pool = all.filter((preset) => favourites.includes(preset.name));
    const choices = (pool.length > 1 ? pool : all).filter((preset) => preset.name !== active);
    const pick = choices[Math.floor(Math.random() * choices.length)];
    if (pick) onapply(pick.settings);
  }

  /** Your presets of this mode as a file (PR-04). */
  function exportPresets() {
    const file = {
      app: 'vibe-visualizer',
      kind: 'presets',
      mode,
      version: 1,
      presets: $store.map((preset) => ({ name: preset.name, settings: preset.settings })),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${mode === 'logoSpectrum' ? 'logo-spectrum' : 'kaleidoscope'}-presets.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Adds the presets of a file to yours; names already taken get a number. */
  async function importPresets(file: File) {
    message = null;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (parsed['kind'] !== 'presets' || !Array.isArray(parsed['presets'])) {
        throw new Error('This is not a preset file.');
      }
      if (parsed['mode'] !== mode) {
        const other = parsed['mode'] === 'kaleidoscope' ? 'Kaleidoscope' : 'Logo Spectrum';
        throw new Error(`These are ${other} presets: switch to the ${other} to import them.`);
      }
      const taken = all.map((preset) => preset.name);
      const added: Preset[] = [];
      for (const entry of parsed['presets'] as unknown[]) {
        const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
          string,
          unknown
        >;
        const base = (typeof item['name'] === 'string' ? item['name'] : '').trim().slice(0, 40);
        let unique = base || 'Imported';
        for (let n = 2; taken.includes(unique); n++) unique = `${base || 'Imported'} (${n})`;
        taken.push(unique);
        added.push({ name: unique, settings: sanitize(item['settings']), builtIn: false });
      }
      if (added.length === 0) throw new Error('The file holds no presets.');
      store.update((presets) => [...presets, ...added]);
      message = `Imported ${added.length} preset${added.length === 1 ? '' : 's'}.`;
    } catch (error) {
      message =
        error instanceof SyntaxError
          ? 'This file is not valid JSON.'
          : error instanceof Error
            ? error.message
            : String(error);
    }
  }
</script>

<div class="presets">
  <label for="preset-select">Preset</label>
  <div class="row">
    <select
      id="preset-select"
      value={active}
      onchange={(event) => apply(event.currentTarget.value)}
      data-testid="preset-select"
    >
      <option value="" disabled>Custom settings</option>
      <optgroup label="Built in">
        {#each builtIn as preset (preset.name)}
          <option value={preset.name}>{star(preset.name)}{preset.name}</option>
        {/each}
      </optgroup>
      {#if $store.length > 0}
        <optgroup label="Yours">
          {#each $store as preset (preset.name)}
            <option value={preset.name}>{star(preset.name)}{preset.name}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
    <button
      class="icon"
      class:on={favourite}
      disabled={!active}
      onclick={toggleFavourite}
      aria-pressed={favourite}
      aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
      title={favourite ? 'Remove from favourites' : 'Add to favourites'}
      data-testid="preset-favourite"
    >
      <Icon name={favourite ? 'star' : 'starOutline'} size={16} />
    </button>
    <button
      class="icon"
      onclick={random}
      aria-label="Random preset"
      title="Random preset (from your favourites, if you have two or more)"
      data-testid="preset-random"
    >
      <Icon name="shuffle" size={16} />
    </button>
    {#if $store.some((preset) => preset.name === active)}
      <button
        class="icon"
        onclick={() => remove(active)}
        aria-label="Delete this preset"
        title="Delete this preset"
      >
        <Icon name="trash" size={16} />
      </button>
    {/if}
  </div>
  <form
    class="row"
    onsubmit={(event) => {
      event.preventDefault();
      saveCurrent();
    }}
  >
    <input
      type="text"
      placeholder="Name for your preset"
      bind:value={name}
      maxlength="40"
      aria-label="Preset name"
      data-testid="preset-name"
    />
    <button type="submit" disabled={!name.trim()} data-testid="preset-save">
      <Icon name="save" size={16} /> Save
    </button>
  </form>
  <div class="row files">
    <button
      onclick={exportPresets}
      disabled={$store.length === 0}
      title={$store.length === 0 ? 'Save a preset first' : 'Save your presets to a file'}
      data-testid="preset-export"
    >
      <Icon name="export" size={16} /> Export yours
    </button>
    <button onclick={() => fileInput?.click()} data-testid="preset-import">
      <Icon name="import" size={16} /> Import
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,application/json"
      hidden
      data-testid="preset-import-input"
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void importPresets(file);
      }}
    />
  </div>
  {#if message}
    <p class="message" role="status" data-testid="preset-message">{message}</p>
  {/if}
</div>

<style>
  .presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  label {
    font-size: 13px;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row select,
  .row input {
    flex: 1;
    min-width: 0;
  }
  input[type='text'] {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 8px;
  }
  .row button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
  }
  .files button {
    flex: 1;
    justify-content: center;
    font-size: 13px;
  }
  .icon {
    padding: 5px 8px;
  }
  .icon.on {
    color: #ffd23d;
  }
  .message {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
