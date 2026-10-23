<script lang="ts">
  import {
    ASPECT_RATIOS,
    EXPORT_PRESETS,
    FADE_CHOICES,
    frameSize,
    FRAME_RATES,
    QUALITIES,
    RESOLUTIONS,
    type AspectRatio,
    type ExportOptions,
    type FadeSeconds,
    type VideoFormat,
  } from '../../core/export/video-format';
  import { usePlayer } from '../player-context';
  import type { ExportChoices } from './export-choices.svelte';

  /**
   * What the export makes (EX-03, EX-04, EX-11, EX-16): a video or only its sound; the format,
   * from a preset or chosen; the quality, and the fades.
   */
  let {
    choices,
    fitted,
    format,
    aspect,
    soundOnly,
  }: {
    choices: ExportChoices;
    /** The options fitted to the stage's aspect ratio. */
    fitted: ExportOptions;
    format: VideoFormat;
    aspect: AspectRatio;
    soundOnly: boolean;
  } = $props();

  const player = usePlayer();
  const options = $derived(choices.options);

  function choosePreset(id: ExportOptions['preset']) {
    options.preset = id;
    choices.problem = null;
    const preset = EXPORT_PRESETS.find((entry) => entry.id === id);
    // The stage shows what will be exported.
    if (preset?.aspect && preset.aspect !== aspect)
      player.updateSettings({ aspect: preset.aspect });
  }

  function chooseAspect(value: AspectRatio) {
    options.preset = 'custom';
    player.updateSettings({ aspect: value });
  }
</script>

<div class="content" role="radiogroup" aria-label="What to make">
  <label class:on={!soundOnly}>
    <input
      type="radio"
      name="content"
      checked={!soundOnly}
      onchange={() => (options.content = 'video')}
      data-testid="export-content-video"
    />
    A video
  </label>
  <label class:on={soundOnly}>
    <input
      type="radio"
      name="content"
      checked={soundOnly}
      onchange={() => (options.content = 'sound')}
      data-testid="export-content-sound"
    />
    Only the sound (WAV)
  </label>
</div>
<fieldset hidden={soundOnly}>
  <legend>Format</legend>
  <div class="choices">
    {#each EXPORT_PRESETS as preset (preset.id)}
      <label class="choice" class:on={fitted.preset === preset.id}>
        <input
          type="radio"
          name="preset"
          checked={fitted.preset === preset.id}
          onchange={() => choosePreset(preset.id)}
        />
        <span class="name">{preset.label}</span>
        <span class="detail">
          {frameSize(preset.aspect ?? aspect, preset.resolution).join('×')} · {preset.fps} fps
        </span>
      </label>
    {/each}
    <label class="choice" class:on={fitted.preset === 'custom'}>
      <input
        type="radio"
        name="preset"
        checked={fitted.preset === 'custom'}
        onchange={() => choosePreset('custom')}
      />
      <span class="name">Custom</span>
      <span class="detail">Any aspect ratio, size and frame rate</span>
    </label>
  </div>
  {#if fitted.preset === 'custom'}
    <div class="custom">
      <div class="aspects" role="radiogroup" aria-label="Aspect ratio">
        {#each ASPECT_RATIOS as entry (entry.id)}
          <button
            role="radio"
            aria-checked={aspect === entry.id}
            class:on={aspect === entry.id}
            onclick={() => chooseAspect(entry.id)}
            title={entry.hint}
          >
            {entry.id}
          </button>
        {/each}
      </div>
      <label>
        Size
        <select
          value={options.resolution}
          onchange={(event) =>
            (options.resolution = Number(event.currentTarget.value) as ExportOptions['resolution'])}
          data-testid="export-resolution"
        >
          {#each RESOLUTIONS as resolution (resolution)}
            <option value={resolution}>{frameSize(aspect, resolution).join(' × ')}</option>
          {/each}
        </select>
      </label>
      <label>
        Frame rate
        <select
          value={options.fps}
          onchange={(event) =>
            (options.fps = Number(event.currentTarget.value) as ExportOptions['fps'])}
          data-testid="export-fps"
        >
          {#each FRAME_RATES as fps (fps)}
            <option value={fps}>{fps} fps</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}
</fieldset>

<div class="row">
  <label>
    Quality
    <select
      value={options.quality}
      onchange={(event) =>
        (options.quality = event.currentTarget.value as ExportOptions['quality'])}
    >
      {#each QUALITIES as quality (quality.id)}
        <option value={quality.id}>{quality.label}</option>
      {/each}
    </select>
  </label>
  <span class="detail">{(format.videoBitrate / 1e6).toFixed(1)} Mbit/s video</span>
  <label
    title="The picture fades from and to black at the start and the end, and the sound with it"
  >
    Fade in and out
    <select
      value={options.fade}
      onchange={(event) => (options.fade = Number(event.currentTarget.value) as FadeSeconds)}
      data-testid="export-fade"
    >
      {#each FADE_CHOICES as fade (fade)}
        <option value={fade}>{fade === 0 ? 'No fades' : `${fade} s`}</option>
      {/each}
    </select>
  </label>
</div>
