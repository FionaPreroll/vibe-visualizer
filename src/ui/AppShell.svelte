<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Player } from '../core/player/player';
  import { VisualAssets } from '../core/render/visual-assets';
  import AnalysisView from './AnalysisView.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import Icon from './Icon.svelte';
  import PhotosensitivityNotice from './PhotosensitivityNotice.svelte';
  import { providePlayer } from './player-context';
  import QueuePanel from './QueuePanel.svelte';
  import TopBar from './TopBar.svelte';
  import TransportBar from './TransportBar.svelte';
  import VisualsPanel from './VisualsPanel.svelte';
  import VisualStage from './VisualStage.svelte';
  import { provideAssets } from './visuals-context';

  const player = new Player();
  providePlayer(player);
  provideAssets(new VisualAssets());
  const app = player.store;
  let stage: HTMLElement;
  /** In fullscreen, the mouse cursor hides after a moment without movement (DS-01). */
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    clearTimeout(idleTimer);
    player.dispose();
  });

  function onPointerMove() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = document.fullscreenElement === stage), 2500);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen();
  }

  /** Keys that should not trigger shortcuts: typing, buttons, sliders and list items. */
  function ownsKeys(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.closest('input, textarea, select, button, [role="slider"], li') !== null ||
        target.isContentEditable)
    );
  }

  onMount(() => {
    // Entering fullscreen starts the countdown for hiding the cursor, even without movement.
    const onFullscreen = () => onPointerMove();
    document.addEventListener('fullscreenchange', onFullscreen);
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || ownsKeys(event.target)) return;
      const step = event.shiftKey ? 30 : 5;
      switch (event.key) {
        case ' ':
          void player.toggle();
          break;
        case 'ArrowLeft':
          void player.seek(player.position - step);
          break;
        case 'ArrowRight':
          void player.seek(player.position + step);
          break;
        case 'n':
          void player.next();
          break;
        case 'p':
          void player.previous();
          break;
        case 'f':
          toggleFullscreen();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  });
</script>

<div class="shell" class:panel-open={$app.settings.panelOpen}>
  <TopBar onFullscreen={toggleFullscreen} />

  <main
    class="stage"
    class:idle
    bind:this={stage}
    aria-label="Visual stage"
    onpointermove={onPointerMove}
  >
    {#if $app.settings.visualMode === 'analysis'}
      <AnalysisView />
    {:else}
      <VisualStage mode={$app.settings.visualMode} />
    {/if}
    {#if $app.tracks.length === 0}
      <div class="welcome">
        <h1>Drop your music here</h1>
        <p>MP3, M4A, FLAC, Ogg, Opus or WAV. Several files make a queue.</p>
      </div>
    {/if}
    {#if $app.error}
      <div class="error" role="alert">
        <Icon name="alert" size={18} />
        <span>{$app.error}</span>
        <button onclick={() => player.dismissError()} aria-label="Dismiss">
          <Icon name="close" size={16} />
        </button>
      </div>
    {/if}
  </main>

  {#if $app.settings.panelOpen}
    <aside class="panel">
      <div class="tabs" role="tablist" aria-label="Side panel">
        <button
          role="tab"
          aria-selected={$app.settings.panel === 'queue'}
          onclick={() => player.updateSettings({ panel: 'queue' })}
        >
          <Icon name="music" size={16} /> Queue
        </button>
        <button
          role="tab"
          aria-selected={$app.settings.panel === 'visuals'}
          onclick={() => player.updateSettings({ panel: 'visuals' })}
        >
          <Icon name="sliders" size={16} /> Visuals
        </button>
      </div>
      <div class="panel-body" role="tabpanel">
        {#if $app.settings.panel === 'queue'}
          <QueuePanel />
        {:else}
          <VisualsPanel />
        {/if}
      </div>
    </aside>
  {/if}

  <TransportBar />
  <DropOverlay />
  <PhotosensitivityNotice />
</div>

<style>
  .shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
  }
  .shell.panel-open {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
  .shell > :global(.topbar),
  .shell > :global(.transport) {
    grid-column: 1 / -1;
  }
  .stage {
    position: relative;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 40%, #16162a 0%, var(--bg) 70%);
  }
  .stage.idle {
    cursor: none;
  }
  .panel {
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    background: transparent;
    color: var(--muted);
  }
  .tabs button[aria-selected='true'] {
    background: var(--surface-2);
    border-color: var(--border);
    color: var(--text);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .welcome {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: none;
  }
  .welcome h1 {
    margin: 0 0 8px;
    font-size: 32px;
  }
  .welcome p {
    margin: 0;
    color: var(--muted);
  }
  .error {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(90%, 720px);
    padding: 10px 12px 10px 16px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--fail) 22%, var(--surface));
    border: 1px solid var(--fail);
  }
  .error button {
    display: grid;
    place-items: center;
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
</style>
