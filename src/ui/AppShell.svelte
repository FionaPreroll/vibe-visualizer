<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Player } from '../core/player/player';
  import AnalysisView from './AnalysisView.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import Icon from './Icon.svelte';
  import { providePlayer } from './player-context';
  import QueuePanel from './QueuePanel.svelte';
  import TopBar from './TopBar.svelte';
  import TransportBar from './TransportBar.svelte';

  const player = new Player();
  providePlayer(player);
  const app = player.store;
  let stage: HTMLElement;

  onDestroy(() => player.dispose());

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
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="shell" class:panel-open={$app.settings.panelOpen}>
  <TopBar onFullscreen={toggleFullscreen} />

  <main class="stage" bind:this={stage} aria-label="Visual stage">
    {#if $app.settings.analysisView}
      <AnalysisView />
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
      <QueuePanel />
    </aside>
  {/if}

  <TransportBar />
  <DropOverlay />
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
  .panel {
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--border);
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
