<script lang="ts">
  import type { NumberFormat, ParamSpec, ParamValue } from '../../core/render/kaleido-settings';
  import { degrees, integer, percent, perMinute, plain, seconds, times } from './format';
  import Slider from './Slider.svelte';

  /** A control generated from a parameter spec (KA-01). */
  interface Props {
    spec: ParamSpec;
    value: ParamValue;
    onchange: (value: ParamValue) => void;
  }
  let { spec, value, onchange }: Props = $props();

  const FORMATS: Record<NumberFormat, (value: number) => string> = {
    percent,
    seconds,
    perMinute,
    degrees,
    times,
    integer,
    plain,
  };
  const id = `param-${Math.random().toString(36).slice(2)}`;
</script>

{#if spec.kind === 'number'}
  <div title={spec.hint}>
    <Slider
      label={spec.label}
      min={spec.min}
      max={spec.max}
      step={spec.integer ? 1 : (spec.max - spec.min) / 200}
      value={value as number}
      defaultValue={spec.default}
      format={FORMATS[spec.format]}
      onchange={(next) => onchange(next)}
    />
  </div>
{:else if spec.kind === 'boolean'}
  <label class="row check" title={spec.hint}>
    <input
      type="checkbox"
      checked={value as boolean}
      onchange={(event) => onchange(event.currentTarget.checked)}
    />
    {spec.label}
  </label>
{:else if spec.kind === 'select'}
  <div class="row">
    <label for={id}>{spec.label}</label>
    <select {id} value={value as string} onchange={(event) => onchange(event.currentTarget.value)}>
      {#each spec.options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>
{:else if spec.kind === 'color'}
  <div class="row">
    <label for={id}>{spec.label}</label>
    <input
      {id}
      type="color"
      value={value as string}
      oninput={(event) => onchange(event.currentTarget.value)}
    />
  </div>
{:else if spec.kind === 'gradient'}
  {@const colors = value as string[]}
  <div class="gradient">
    <span class="label">{spec.label}</span>
    <span class="preview" style:background={`linear-gradient(90deg, ${colors.join(', ')})`}></span>
    <div class="stops">
      {#each colors as color, index (index)}
        <input
          type="color"
          value={color}
          aria-label={`${spec.label}: colour ${index + 1}`}
          oninput={(event) => {
            const next = [...colors];
            next[index] = event.currentTarget.value;
            onchange(next);
          }}
        />
      {/each}
    </div>
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 32px;
    font-size: 13px;
  }
  .row label,
  .label {
    font-size: 13px;
    color: var(--muted);
  }
  .check {
    display: flex;
    gap: 8px;
    color: var(--text);
  }
  select {
    width: 100%;
  }
  input[type='color'] {
    width: 64px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
  }
  .gradient {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 8px;
  }
  .preview {
    display: block;
    height: 12px;
    border-radius: 6px;
  }
  .stops {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
  }
  .stops input {
    width: 100%;
  }
</style>
