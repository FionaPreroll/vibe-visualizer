<script lang="ts" generics="S">
  import { untrack } from 'svelte';
  import Icon from '../Icon.svelte';

  /**
   * Preset picker for a visual mode (PR-01): built-in presets and your own, which you can save
   * from the current settings and delete. The preset shown is the one that matches the current
   * settings exactly; any change turns it into "Custom settings".
   */
  interface Preset {
    name: string;
    settings: S;
    builtIn: boolean;
  }
  interface Props {
    builtIn: readonly Preset[];
    load: () => Preset[];
    save: (presets: Preset[]) => void;
    current: S;
    onapply: (settings: S) => void;
  }
  let { builtIn, load, save, current, onapply }: Props = $props();

  // Your presets are read once; afterwards this component keeps them in sync with storage.
  let user = $state<Preset[]>(untrack(() => load()));
  let name = $state('');

  const all = $derived([...builtIn, ...user]);
  const active = $derived(
    all.find((preset) => JSON.stringify(preset.settings) === JSON.stringify(current))?.name ?? '',
  );

  function apply(presetName: string) {
    const preset = all.find((entry) => entry.name === presetName);
    if (preset) onapply(preset.settings);
  }

  function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) return;
    user = [
      ...user.filter((preset) => preset.name !== trimmed),
      { name: trimmed, settings: current, builtIn: false },
    ];
    save(user);
    name = '';
  }

  function remove(presetName: string) {
    user = user.filter((preset) => preset.name !== presetName);
    save(user);
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
          <option value={preset.name}>{preset.name}</option>
        {/each}
      </optgroup>
      {#if user.length > 0}
        <optgroup label="Yours">
          {#each user as preset (preset.name)}
            <option value={preset.name}>{preset.name}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
    {#if user.some((preset) => preset.name === active)}
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
  .icon {
    padding: 5px 8px;
  }
</style>
