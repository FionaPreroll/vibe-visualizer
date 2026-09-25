<script lang="ts">
  import type { ImageKind } from '../core/render/logo-spectrum';
  import {
    BUILT_IN_PRESETS,
    DEFAULT_LOGO_SPECTRUM,
    layerColors,
    MAX_LAYERS,
    PALETTE_NAMES,
    PALETTES,
    RANGES,
    RESPONSIVENESS,
    type LogoSpectrumSettings,
    type PaletteName,
    type ResponsivenessName,
    type VisualPreset,
  } from '../core/render/visual-settings';
  import { loadPresets, savePresets } from '../core/state/persistence';
  import { errorMessage } from '../core/util/format';
  import Icon from './Icon.svelte';
  import ImagePicker from './controls/ImagePicker.svelte';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import { usePlayer } from './player-context';
  import { useAssets } from './visuals-context';

  /** Controls of the Logo Spectrum mode (LS-*) and its presets (PR-01). */

  const player = usePlayer();
  const assets = useAssets();
  const app = player.store;
  const v = $derived($app.visuals);

  let userPresets = $state<VisualPreset[]>(loadPresets());
  let presetName = $state('');
  let imageError = $state<string | null>(null);

  const presets = $derived([...BUILT_IN_PRESETS, ...userPresets]);
  /** The preset that matches the current settings exactly, if any. */
  const activePreset = $derived(
    presets.find((preset) => JSON.stringify(preset.settings) === JSON.stringify(v))?.name ?? '',
  );

  type NumberKey = keyof typeof RANGES;
  const set = (changes: Partial<LogoSpectrumSettings>) => player.updateVisuals(changes);

  function slider(key: NumberKey, label: string, format?: (value: number) => string) {
    const [min, max] = RANGES[key];
    const integer = key === 'layers' || key === 'particles';
    return {
      label,
      min,
      max,
      step: integer ? 1 : (max - min) / 200,
      value: v[key],
      defaultValue: DEFAULT_LOGO_SPECTRUM[key],
      format: format ?? (integer ? (x: number) => String(x) : undefined),
      onchange: (value: number) => set({ [key]: value }),
    };
  }

  const percent = (value: number) => `${Math.round(value * 100)} %`;
  const seconds = (value: number) =>
    value < 0.1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
  const hertz = (value: number) =>
    value >= 1000 ? `${(value / 1000).toFixed(1)} k` : `${Math.round(value)}`;
  const degrees = (value: number) => `${Math.round(value)}°`;
  const perMinute = (value: number) => `${value.toFixed(1)}/min`;

  function applyPreset(name: string) {
    const preset = presets.find((entry) => entry.name === name);
    if (preset) player.replaceVisuals(preset.settings);
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const others = userPresets.filter((preset) => preset.name !== name);
    userPresets = [...others, { name, settings: v, builtIn: false }];
    savePresets(userPresets);
    presetName = '';
  }

  function deletePreset(name: string) {
    userPresets = userPresets.filter((preset) => preset.name !== name);
    savePresets(userPresets);
  }

  function choosePalette(palette: PaletteName) {
    // Switching to custom starts from the colours shown now.
    if (palette === 'custom') set({ palette, customColors: [...layerColors(v)] });
    else set({ palette });
  }

  function setCustomColor(index: number, color: string) {
    const customColors = [...v.customColors];
    customColors[index] = color;
    set({ customColors });
  }

  async function pickImage(kind: ImageKind, file: File | null) {
    imageError = null;
    try {
      await assets.set(kind, file);
    } catch (error) {
      imageError = errorMessage(error);
    }
  }

  const responsiveness = Object.keys(RESPONSIVENESS) as ResponsivenessName[];
  const activeResponsiveness = $derived(
    responsiveness.find((name) =>
      Object.entries(RESPONSIVENESS[name]).every(
        ([key, value]) => v[key as keyof LogoSpectrumSettings] === value,
      ),
    ),
  );
  const swatch = (name: PaletteName) =>
    `linear-gradient(90deg, ${(name === 'custom' ? v.customColors : PALETTES[name]).join(', ')})`;
</script>

<section class="visuals" aria-label="Visual settings">
  <div class="presets">
    <label for="preset-select">Preset</label>
    <div class="row">
      <select
        id="preset-select"
        value={activePreset}
        onchange={(event) => applyPreset(event.currentTarget.value)}
        data-testid="preset-select"
      >
        <option value="" disabled>Custom settings</option>
        <optgroup label="Built in">
          {#each BUILT_IN_PRESETS as preset (preset.name)}
            <option value={preset.name}>{preset.name}</option>
          {/each}
        </optgroup>
        {#if userPresets.length > 0}
          <optgroup label="Yours">
            {#each userPresets as preset (preset.name)}
              <option value={preset.name}>{preset.name}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
      {#if userPresets.some((preset) => preset.name === activePreset)}
        <button
          class="icon"
          onclick={() => deletePreset(activePreset)}
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
        savePreset();
      }}
    >
      <input
        type="text"
        placeholder="Name for your preset"
        bind:value={presetName}
        maxlength="40"
        aria-label="Preset name"
        data-testid="preset-name"
      />
      <button type="submit" disabled={!presetName.trim()} data-testid="preset-save">
        <Icon name="save" size={16} /> Save
      </button>
    </form>
  </div>

  {#if imageError}
    <p class="error" role="alert">{imageError}</p>
  {/if}

  <Section title="Spectrum ring" open>
    <div class="palettes" role="radiogroup" aria-label="Palette">
      {#each PALETTE_NAMES as name (name)}
        <button
          role="radio"
          aria-checked={v.palette === name}
          class:on={v.palette === name}
          onclick={() => choosePalette(name)}
          title={name}
        >
          <span class="swatch" style:background={swatch(name)}></span>
          <span class="name">{name}</span>
        </button>
      {/each}
    </div>
    {#if v.palette === 'custom'}
      <div class="colors">
        {#each v.customColors as color, index (index)}
          <input
            type="color"
            value={color}
            aria-label={`Layer ${index + 1} colour`}
            oninput={(event) => setCustomColor(index, event.currentTarget.value)}
          />
        {/each}
      </div>
    {/if}
    <div class="color-row">
      <label for="top-color">Top layer</label>
      <input
        id="top-color"
        type="color"
        value={v.topColor}
        oninput={(event) => set({ topColor: event.currentTarget.value })}
      />
      <label class="check">
        <input
          type="checkbox"
          checked={v.mirror}
          onchange={(event) => set({ mirror: event.currentTarget.checked })}
        />
        Mirror
      </label>
    </div>
    <Slider {...slider('layers', 'Colour layers')} />
    <Slider {...slider('layerDelay', 'Layer trail', seconds)} />
    <Slider {...slider('layerSpread', 'Layer spread', percent)} />
    <Slider {...slider('hueCycle', 'Hue cycle', perMinute)} />
    <Slider {...slider('ringRadius', 'Radius', percent)} />
    <Slider {...slider('amplitude', 'Height', percent)} />
    <Slider {...slider('minFrequency', 'Lowest (Hz)', hertz)} />
    <Slider {...slider('maxFrequency', 'Highest (Hz)', hertz)} />
    <Slider {...slider('rotation', 'Rotation', degrees)} />
    <Slider {...slider('spin', 'Spin', perMinute)} />
    <Slider {...slider('glow', 'Glow', percent)} />
    <Slider {...slider('glowRadius', 'Glow reach', percent)} />
    <Slider {...slider('bloom', 'Bloom', percent)} />
  </Section>

  <Section title="Responsiveness" open>
    <div class="quick" role="group" aria-label="Quick settings">
      {#each responsiveness as name (name)}
        <button
          class:on={activeResponsiveness === name}
          aria-pressed={activeResponsiveness === name}
          onclick={() => set(RESPONSIVENESS[name])}
        >
          {name[0]!.toUpperCase() + name.slice(1)}
        </button>
      {/each}
    </div>
    <Slider {...slider('sensitivity', 'Sensitivity')} />
    <Slider {...slider('attack', 'Attack', seconds)} />
    <Slider {...slider('release', 'Release', seconds)} />
    <Slider {...slider('smoothing', 'Smoothing', percent)} />
    <Slider {...slider('threshold', 'Noise floor', percent)} />
    <Slider {...slider('tilt', 'Bass ↔ treble')} />
  </Section>

  <Section title="Logo">
    <ImagePicker
      label="Logo image"
      image={$assets.logo}
      round
      testid="logo"
      onpick={(file) => pickImage('logo', file)}
    />
    <Slider {...slider('logoSize', 'Size', percent)} />
    <Slider {...slider('logoZoom', 'Zoom', (x) => `${x.toFixed(2)}×`)} />
    <Slider {...slider('logoPanX', 'Position X')} />
    <Slider {...slider('logoPanY', 'Position Y')} />
    <Slider {...slider('rimWidth', 'Rim', percent)} />
    <div class="color-row">
      <label for="rim-color">Rim colour</label>
      <input
        id="rim-color"
        type="color"
        value={v.rimColor}
        oninput={(event) => set({ rimColor: event.currentTarget.value })}
      />
    </div>
    <Slider {...slider('logoShadow', 'Shadow', percent)} />
    <Slider {...slider('bassPulse', 'Bass pulse', percent)} />
    <Slider {...slider('centerX', 'Ring position X', percent)} />
    <Slider {...slider('centerY', 'Ring position Y', percent)} />
  </Section>

  <Section title="Background">
    <ImagePicker
      label="Background image"
      image={$assets.background}
      testid="background"
      onpick={(file) => pickImage('background', file)}
    />
    <div class="color-row">
      <span class="label">Fit</span>
      <div class="quick" role="radiogroup" aria-label="Background fit">
        {#each ['cover', 'contain'] as const as fit (fit)}
          <button
            role="radio"
            aria-checked={v.backgroundFit === fit}
            class:on={v.backgroundFit === fit}
            onclick={() => set({ backgroundFit: fit })}
          >
            {fit === 'cover' ? 'Fill' : 'Fit inside'}
          </button>
        {/each}
      </div>
    </div>
    <Slider {...slider('backgroundBlur', 'Blur', percent)} />
    <Slider {...slider('backgroundDim', 'Darken', percent)} />
    <Slider {...slider('backgroundPulse', 'Bass zoom', percent)} />
    <Slider {...slider('backgroundX', 'Position X')} />
    <Slider {...slider('backgroundY', 'Position Y')} />
  </Section>

  <Section title="Particles">
    <Slider {...slider('particles', 'Count')} />
    <Slider {...slider('particleSize', 'Size', (x) => `${x.toFixed(1)}×`)} />
    <Slider {...slider('particleSpeed', 'Speed', (x) => `${x.toFixed(1)}×`)} />
  </Section>

  <div class="footer">
    <button onclick={() => player.replaceVisuals(DEFAULT_LOGO_SPECTRUM)}>Reset to defaults</button>
    <span class="hint">Up to {MAX_LAYERS} layers · double-click a label to reset it</span>
  </div>
</section>

<style>
  .visuals {
    display: flex;
    flex-direction: column;
  }
  .presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .presets label {
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
  .error {
    margin: 8px 16px 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--fail);
    background: color-mix(in srgb, var(--fail) 18%, var(--surface));
    font-size: 13px;
  }
  .palettes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 8px;
  }
  .palettes button {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: transparent;
    text-align: left;
  }
  .palettes button.on {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .swatch {
    display: block;
    height: 10px;
    border-radius: 4px;
  }
  .palettes .name {
    font-size: 12px;
    text-transform: capitalize;
  }
  .colors {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 4px;
    margin-bottom: 8px;
  }
  .colors input,
  .color-row input[type='color'] {
    width: 100%;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
  }
  .color-row {
    display: grid;
    grid-template-columns: 104px 64px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .color-row label,
  .color-row .label {
    font-size: 13px;
    color: var(--muted);
  }
  .color-row .quick {
    grid-column: 2 / 4;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-self: end;
  }
  .quick {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
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
  .footer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px 16px 20px;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }
</style>
