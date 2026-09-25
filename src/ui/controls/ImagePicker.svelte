<script lang="ts">
  import type { StoredImage } from '../../core/render/visual-assets';
  import { IMAGE_TYPES } from '../../core/render/visual-assets';
  import Icon from '../Icon.svelte';

  /** Shows the current image (or the default) with buttons to replace or remove it. */
  interface Props {
    label: string;
    image: StoredImage | null;
    round?: boolean;
    onpick: (file: File | null) => void;
    testid: string;
  }
  let { label, image, round = false, onpick, testid }: Props = $props();
  let input: HTMLInputElement;
</script>

<div class="picker">
  <div class="preview" class:round>
    {#if image}
      <img src={image.url} alt="" />
    {:else}
      <span>Default</span>
    {/if}
  </div>
  <div class="info">
    <span class="label">{label}</span>
    <span class="name" title={image?.name}>{image?.name ?? 'Neutral default'}</span>
    <div class="buttons">
      <button onclick={() => input.click()} data-testid={`${testid}-pick`}>
        <Icon name="image" size={16} />
        {image ? 'Replace' : 'Choose'}
      </button>
      {#if image}
        <button class="ghost" onclick={() => onpick(null)} data-testid={`${testid}-remove`}>
          Remove
        </button>
      {/if}
    </div>
  </div>
  <input
    bind:this={input}
    type="file"
    accept={IMAGE_TYPES.join(',')}
    hidden
    data-testid={`${testid}-input`}
    onchange={() => {
      const file = input.files?.[0];
      if (file) onpick(file);
      input.value = '';
    }}
  />
</div>

<style>
  .picker {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 4px 0 8px;
  }
  .preview {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 72px;
    height: 48px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    font-size: 11px;
    color: var(--muted);
  }
  .preview.round {
    width: 56px;
    height: 56px;
    border-radius: 50%;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .label {
    font-size: 13px;
    color: var(--muted);
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .buttons {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .buttons button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 13px;
  }
  .ghost {
    background: transparent;
  }
</style>
