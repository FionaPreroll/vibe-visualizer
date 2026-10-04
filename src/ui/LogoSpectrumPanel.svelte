<script lang="ts">
  import type { ImageKind } from '../core/render/logo-spectrum';
  import {
    BUILT_IN_PRESETS,
    DEFAULT_LOGO_SPECTRUM,
    layerColors,
    MAX_LAYERS,
    PALETTE_NAMES,
    PALETTES,
    PARTICLE_STYLES,
    RANGES,
    RECORD_SPEEDS,
    RESPONSIVENESS,
    RING_DIRECTIONS,
    RING_STYLES,
    type LogoSpectrumSettings,
    type PaletteName,
    type ParticleStyle,
    type ResponsivenessName,
    type RingDirection,
    type RingStyle,
    sanitizeSettings,
  } from '../core/render/visual-settings';
  import AutoPresetsSection from './AutoPresetsSection.svelte';
  import { errorMessage } from '../core/util/format';
  import CoverColorsOption from './CoverColorsOption.svelte';
  import { degrees, hertz, percent, perMinute, seconds } from './controls/format';
  import ImagePicker from './controls/ImagePicker.svelte';
  import PresetBar from './controls/PresetBar.svelte';
  import Section from './controls/Section.svelte';
  import Slider from './controls/Slider.svelte';
  import { usePlayer } from './player-context';
  import { logoSpectrumPresets } from './preset-store';
  import { useAssets } from './visuals-context';

  /** Controls of the Logo Spectrum mode (LS-*) and its presets (PR-01). */
  interface Props {
    /** Opens the settings of the Kaleidoscope behind (VE-08). */
    oneditbehind?: () => void;
  }
  let { oneditbehind }: Props = $props();

  const player = usePlayer();
  const assets = useAssets();
  const app = player.store;
  const v = $derived($app.visuals);

  let imageError = $state<string | null>(null);

  type NumberKey = keyof typeof RANGES;
  const set = (changes: Partial<LogoSpectrumSettings>) => player.updateVisuals(changes);

  function slider(key: NumberKey, label: string, format?: (value: number) => string) {
    const [min, max] = RANGES[key];
    const integer = key === 'layers' || key === 'particles' || key === 'bars';
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

  /** The background image; with the Kaleidoscope behind, one picked shows under it at once. */
  async function pickImageUnder(file: File | null) {
    await pickImage('background', file);
    if (file && v.backgroundSource === 'kaleidoscope' && v.layerImage === 0) {
      set({ layerImage: 0.5 });
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
  const STYLE_NAMES: Record<RingStyle, string> = {
    blob: 'Filled',
    bars: 'Bars',
    lines: 'Lines',
    dots: 'Dots',
  };
  const DIRECTION_NAMES: Record<RingDirection, string> = {
    outward: 'Outward',
    inward: 'Inward',
    both: 'Both',
  };
  const PARTICLE_STYLE_NAMES: Record<ParticleStyle, string> = { stars: 'Stars', rain: 'Rain' };
  /** The record speed shown: the one nearest to the setting (LS-16). */
  const recordSpeed = $derived(
    RECORD_SPEEDS.reduce((best, speed) =>
      Math.abs(speed.rpm - v.logoSpin) < Math.abs(best.rpm - v.logoSpin) ? speed : best,
    ).rpm,
  );
  const swatch = (name: PaletteName) =>
    `linear-gradient(90deg, ${(name === 'custom' ? v.customColors : PALETTES[name]).join(', ')})`;
</script>

<section class="visuals" aria-label="Logo Spectrum settings">
  <PresetBar
    mode="logoSpectrum"
    builtIn={BUILT_IN_PRESETS}
    store={logoSpectrumPresets}
    current={v}
    onapply={(settings) => player.replaceVisuals(settings)}
    favourites={$app.settings.favourites.logoSpectrum}
    onfavourites={(names) =>
      player.updateSettings({ favourites: { ...$app.settings.favourites, logoSpectrum: names } })}
    sanitize={sanitizeSettings}
  />
  <AutoPresetsSection />

  {#if imageError}
    <p class="error" role="alert">{imageError}</p>
  {/if}

  <Section title="Spectrum ring" open>
    <div class="choice">
      <span class="label">Style</span>
      <div class="quick" role="radiogroup" aria-label="Ring style">
        {#each RING_STYLES as style (style)}
          <button
            role="radio"
            aria-checked={v.ringStyle === style}
            class:on={v.ringStyle === style}
            onclick={() => set({ ringStyle: style })}
          >
            {STYLE_NAMES[style]}
          </button>
        {/each}
      </div>
    </div>
    <div class="choice">
      <span class="label">Direction</span>
      <div class="quick" role="radiogroup" aria-label="Ring direction">
        {#each RING_DIRECTIONS as direction (direction)}
          <button
            role="radio"
            aria-checked={v.ringDirection === direction}
            class:on={v.ringDirection === direction}
            onclick={() => set({ ringDirection: direction })}
          >
            {DIRECTION_NAMES[direction]}
          </button>
        {/each}
      </div>
    </div>
    {#if v.ringStyle === 'bars' || v.ringStyle === 'dots'}
      <Slider {...slider('bars', 'Bars')} />
    {/if}
    {#if v.ringStyle !== 'blob'}
      <Slider {...slider('thickness', 'Thickness', percent)} />
    {/if}
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
    <CoverColorsOption />
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
      fallback={$assets.logo ? null : assets.shown.logo}
      fallbackName="Default: the app's name"
      round
      testid="logo"
      onpick={(file) => pickImage('logo', file)}
    />
    <label class="option">
      <input
        type="checkbox"
        checked={$app.settings.coverLogo}
        onchange={(event) => player.updateSettings({ coverLogo: event.currentTarget.checked })}
        data-testid="cover-logo"
      />
      Show the cover art of the track playing
    </label>
    {#if $app.settings.coverLogo}
      <p class="hint" data-testid="cover-logo-hint">
        Tracks without cover art show the logo image. Zoom and position apply to the logo image.
      </p>
    {/if}
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
    <div class="color-row">
      <label for="logo-spin">Spin like a record</label>
      <select
        id="logo-spin"
        value={recordSpeed}
        onchange={(event) => set({ logoSpin: Number(event.currentTarget.value) })}
        data-testid="logo-spin"
      >
        {#each RECORD_SPEEDS as speed (speed.rpm)}
          <option value={speed.rpm}>{speed.label}</option>
        {/each}
      </select>
    </div>
    {#if v.logoSpin > 0}
      <p class="hint">
        It turns with the music: it stands while paused, and turns faster or slower with the tempo.
      </p>
    {/if}
    <Slider {...slider('centerX', 'Ring position X', percent)} />
    <Slider {...slider('centerY', 'Ring position Y', percent)} />
  </Section>

  <Section title="Background">
    <div class="color-row">
      <span class="label">Shows</span>
      <div class="quick" role="radiogroup" aria-label="Background shows">
        {#each [['image', 'Image'], ['kaleidoscope', 'Kaleidoscope']] as const as [source, label] (source)}
          <button
            role="radio"
            aria-checked={v.backgroundSource === source}
            class:on={v.backgroundSource === source}
            onclick={() => set({ backgroundSource: source })}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
    {#if v.backgroundSource === 'kaleidoscope'}
      <p class="hint" data-testid="background-layer-hint">
        The Kaleidoscope, live behind the ring, with a look of its own that belongs to this one:
        presets and the preset switching carry it. Darken and tint apply to it; it costs about as
        much as the Kaleidoscope itself. An image can show under it.
      </p>
      {#if oneditbehind}
        <button class="edit-behind" onclick={oneditbehind} data-testid="background-layer-edit">
          Set up the Kaleidoscope behind…
        </button>
      {/if}
    {/if}
    <ImagePicker
      label={v.backgroundSource === 'kaleidoscope' ? 'Image under it' : 'Background image'}
      image={$assets.background}
      testid="background"
      onpick={(file) => pickImageUnder(file)}
    />
    {#if v.backgroundSource === 'kaleidoscope'}
      <Slider {...slider('layerImage', 'Image under it', percent)} />
    {/if}
    {#if v.backgroundSource === 'image' || v.layerImage > 0}
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
    {/if}
    <Slider {...slider('backgroundDim', 'Darken', percent)} />
    <div class="color-row">
      <label for="background-tint">Tint</label>
      <input
        id="background-tint"
        type="color"
        value={v.backgroundTint}
        oninput={(event) => set({ backgroundTint: event.currentTarget.value })}
      />
    </div>
    <Slider {...slider('backgroundTintAmount', 'Tint amount', percent)} />
    <Slider {...slider('backgroundX', 'Position X')} />
    <Slider {...slider('backgroundY', 'Position Y')} />
  </Section>

  <Section title="Motion">
    <Slider {...slider('backgroundPulse', 'Bass zoom', percent)} />
    <Slider {...slider('shake', 'Camera shake', percent)} />
    <Slider {...slider('drift', 'Drift', percent)} />
  </Section>

  <Section title="Particles">
    <div class="choice">
      <span class="label">Style</span>
      <div class="quick" role="radiogroup" aria-label="Particle style">
        {#each PARTICLE_STYLES as style (style)}
          <button
            role="radio"
            aria-checked={v.particleStyle === style}
            class:on={v.particleStyle === style}
            onclick={() => set({ particleStyle: style })}
          >
            {PARTICLE_STYLE_NAMES[style]}
          </button>
        {/each}
      </div>
    </div>
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
  .choice .quick {
    margin-bottom: 0;
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
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13px;
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
