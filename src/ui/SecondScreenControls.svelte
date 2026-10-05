<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { toggleWindowFullscreen } from './second-screen';

  /**
   * The second screen's controls (DS-03), at the bottom of its window: how to put it on the
   * projector, fullscreen, and back to the tab. They show while the pointer moves in the window,
   * and for a few seconds after it opened; then they and the pointer hide, so the audience sees
   * only the visuals. A double-click also switches fullscreen.
   */
  let { view, onback }: { view: Window; onback: () => void } = $props();

  let fullscreen = $state(false);
  let shown = $state(true);

  onMount(() => {
    const doc = view.document;
    let timer = setTimeout(() => (shown = false), 4000);
    const wake = () => {
      shown = true;
      clearTimeout(timer);
      timer = setTimeout(() => (shown = false), 2500);
    };
    const onFullscreen = () => (fullscreen = doc.fullscreenElement !== null);
    const onDoubleClick = (event: MouseEvent) => {
      // Not on its buttons. An element of the other window is no `Element` of this one.
      const target = event.target as Element | null;
      if (!target?.closest?.('button')) toggleWindowFullscreen(view);
    };
    doc.addEventListener('pointermove', wake);
    doc.addEventListener('pointerdown', wake);
    doc.addEventListener('fullscreenchange', onFullscreen);
    doc.addEventListener('dblclick', onDoubleClick);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener('pointermove', wake);
      doc.removeEventListener('pointerdown', wake);
      doc.removeEventListener('fullscreenchange', onFullscreen);
      doc.removeEventListener('dblclick', onDoubleClick);
    };
  });

  // The pointer hides with the controls.
  $effect(() => {
    view.document.body.classList.toggle('screen-idle', !shown);
  });
</script>

<div class="controls" class:shown data-testid="screen-controls">
  <p class="hint">
    {fullscreen
      ? 'Esc leaves fullscreen.'
      : 'Move this window to the projector or second screen, then show it in fullscreen.'}
  </p>
  <button
    onclick={() => toggleWindowFullscreen(view)}
    title="Fullscreen (F, or a double-click)"
    data-testid="screen-fullscreen"
  >
    <Icon name="fullscreen" />
    {fullscreen ? 'Leave fullscreen' : 'Fullscreen'}
  </button>
  <button onclick={onback} title="The visuals back into the tab" data-testid="screen-back">
    <Icon name="backToTab" />
    Back to the tab
  </button>
</div>

<style>
  :global(body.screen-idle) {
    cursor: none;
  }
  .controls {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 36px 16px 14px;
    background: linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0));
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
  }
  .controls.shown,
  .controls:has(:focus-visible) {
    opacity: 1;
    pointer-events: auto;
  }
  .hint {
    flex: 1 1 240px;
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
