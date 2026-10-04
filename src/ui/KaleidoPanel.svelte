<script lang="ts">
  import {
    BUILT_IN_KALEIDO_PRESETS,
    COMMON_PARAMS,
    KALEIDO_PALETTES,
    KALEIDO_SCENES,
    sceneById,
    sceneDefaults,
    type KaleidoPaletteName,
    type KaleidoSceneId,
    type KaleidoSettings,
    type ParamGroup,
    type ParamSpec,
    type ParamValue,
    sanitizeKaleido,
  } from '../core/render/kaleido-settings';
  import AutoPresetsSection from './AutoPresetsSection.svelte';
  import CoverColorsOption from './CoverColorsOption.svelte';
  import ParamControl from './controls/ParamControl.svelte';
  import PresetBar from './controls/PresetBar.svelte';
  import Section from './controls/Section.svelte';
  import { usePlayer } from './player-context';
  import { kaleidoPresets } from './preset-store';

  /**
   * Controls of the Kaleidoscope mode, generated from the parameter specs of the common
   * parameters and of the current scene (KA-01), with presets (PR-01). With `behind`, they
   * set up the Kaleidoscope behind the Logo Spectrum (VE-08), a look of the Logo Spectrum's
   * own, and the Logo Spectrum's preset switching applies.
   */
  interface Props {
    behind?: boolean;
  }
  let { behind = false }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  const k = $derived(behind ? ($app.visuals.layerLook ?? $app.kaleido) : $app.kaleido);
  const scene = $derived(sceneById(k.scene));
  const edit = $derived(
    behind
      ? {
          scene: (id: KaleidoSceneId) => player.setLayerScene(id),
          param: (scope: 'common' | KaleidoSceneId, key: string, value: ParamValue) =>
            player.setLayerParam(scope, key, value),
          replace: (settings: KaleidoSettings) => player.replaceLayer(settings),
        }
      : {
          scene: (id: KaleidoSceneId) => player.setKaleidoScene(id),
          param: (scope: 'common' | KaleidoSceneId, key: string, value: ParamValue) =>
            player.setKaleidoParam(scope, key, value),
          replace: (settings: KaleidoSettings) => player.replaceKaleido(settings),
        },
  );

  const GROUPS: { group: ParamGroup; title: string; open: boolean }[] = [
    { group: 'symmetry', title: 'Symmetry', open: true },
    { group: 'motion', title: 'Motion and trails', open: true },
    { group: 'colour', title: 'Colour', open: true },
    { group: 'reaction', title: 'Reaction to the music', open: false },
    { group: 'post', title: 'Glow', open: false },
  ];

  function visible(spec: ParamSpec, values: Record<string, ParamValue>): boolean {
    return !spec.visibleWhen || values[spec.visibleWhen.key] === spec.visibleWhen.equals;
  }

  const palettes = [...Object.keys(KALEIDO_PALETTES), 'custom'] as KaleidoPaletteName[];
  const swatch = (name: KaleidoPaletteName) =>
    `linear-gradient(90deg, ${(name === 'custom' ? (k.common['gradient'] as string[]) : KALEIDO_PALETTES[name]).join(', ')})`;

  function choosePalette(name: KaleidoPaletteName) {
    // Your own colours start from the palette shown now.
    if (name === 'custom' && k.common['palette'] !== 'custom') {
      const current = KALEIDO_PALETTES[k.common['palette'] as keyof typeof KALEIDO_PALETTES];
      edit.param('common', 'gradient', [...current]);
    }
    edit.param('common', 'palette', name);
  }
</script>

<section
  class="kaleido"
  aria-label={behind ? 'Settings of the Kaleidoscope behind' : 'Kaleidoscope settings'}
>
  <div class="scenes" role="radiogroup" aria-label="Scene">
    {#each KALEIDO_SCENES as entry (entry.id)}
      <button
        role="radio"
        aria-checked={k.scene === entry.id}
        class:on={k.scene === entry.id}
        onclick={() => edit.scene(entry.id)}
        data-testid={`scene-${entry.id}`}
      >
        <span class="name">{entry.name}</span>
        <span class="description">{entry.description}</span>
      </button>
    {/each}
  </div>

  <PresetBar
    mode="kaleidoscope"
    builtIn={BUILT_IN_KALEIDO_PRESETS}
    store={kaleidoPresets}
    current={k}
    onapply={(settings) => edit.replace(settings)}
    favourites={$app.settings.favourites.kaleidoscope}
    onfavourites={(names) =>
      player.updateSettings({ favourites: { ...$app.settings.favourites, kaleidoscope: names } })}
    sanitize={sanitizeKaleido}
  />
  {#if !behind}
    <AutoPresetsSection />
  {/if}

  {#each GROUPS as { group, title, open } (group)}
    <Section {title} {open}>
      {#if group === 'colour'}
        <div class="palettes" role="radiogroup" aria-label="Palette">
          {#each palettes as name (name)}
            <button
              role="radio"
              aria-checked={k.common['palette'] === name}
              class:on={k.common['palette'] === name}
              onclick={() => choosePalette(name)}
              title={name}
            >
              <span class="swatch" style:background={swatch(name)}></span>
              <span class="label">{name}</span>
            </button>
          {/each}
        </div>
        <!-- Behind the Logo Spectrum, its own colour settings hold the switch. -->
        {#if !behind}
          <CoverColorsOption />
        {/if}
      {/if}
      {#each COMMON_PARAMS.filter((spec) => spec.group === group && spec.key !== 'palette') as spec (spec.key)}
        {#if visible(spec, k.common)}
          <ParamControl
            {spec}
            value={k.common[spec.key]!}
            onchange={(value) => edit.param('common', spec.key, value)}
          />
        {/if}
      {/each}
    </Section>
    {#if group === 'colour'}
      <Section title={scene.name} open>
        {#each scene.params as spec (spec.key)}
          <ParamControl
            {spec}
            value={k.scenes[scene.id][spec.key]!}
            onchange={(value) => edit.param(scene.id, spec.key, value)}
          />
        {/each}
      </Section>
    {/if}
  {/each}

  <div class="footer">
    <button onclick={() => edit.replace(sceneDefaults(k.scene))}>
      Reset {scene.name}
    </button>
    <span class="hint">Double-click a slider's label to reset it</span>
  </div>
</section>

<style>
  .kaleido {
    display: flex;
    flex-direction: column;
  }
  .scenes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 14px 16px 0;
  }
  .scenes button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px;
    text-align: left;
    background: transparent;
  }
  .scenes button.on {
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .scenes .name {
    font-weight: 600;
  }
  .scenes .description {
    font-size: 12px;
    color: var(--muted);
  }
  .palettes {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
  .palettes .label {
    font-size: 12px;
    text-transform: capitalize;
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
