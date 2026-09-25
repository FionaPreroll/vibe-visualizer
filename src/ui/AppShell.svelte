<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Exporter } from '../core/export/exporter';
  import { Player } from '../core/player/player';
  import { VisualAssets } from '../core/render/visual-assets';
  import AnalysisView from './AnalysisView.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import { provideExporter } from './exporter-context';
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
  const exporter = new Exporter();
  provideExporter(exporter);
  const app = player.store;
  let exportOpen = $state(false);
  let stage: HTMLElement;
  /** In fullscreen, the mouse cursor hides after a moment without movement (DS-01). */
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    clearTimeout(idleTimer);
    exporter.dispose();
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

  /**
   * Whether the focused element needs `key` itself: text fields take every key; buttons,
   * sliders and list items take Space and the arrow keys, but not letters (so I and O work
   * right after clicking Play).
   */
  function ownsKey(target: EventTarget | null, key: string): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const typing =
      target.isContentEditable ||
      target.closest(
        'textarea, select, input:not([type="range"], [type="checkbox"], [type="radio"], [type="color"], [type="file"])',
      ) !== null;
    if (typing) return true;
    if (key.length === 1 && key !== ' ') return false;
    return target.closest('input, button, [role="slider"], li') !== null;
  }

  onMount(() => {
    // Entering fullscreen starts the countdown for hiding the cursor, even without movement.
    const onFullscreen = () => onPointerMove();
    document.addEventListener('fullscreenchange', onFullscreen);
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || ownsKey(event.target, event.key))
        return;
      // A modal dialog (the export) has the keyboard to itself.
      if (document.querySelector('dialog[open]')) return;
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
        // In/out markers of the export range (TR-09); with Shift they are cleared.
        case 'i':
        case 'I':
          player.mark('in', event.shiftKey ? null : player.position);
          break;
        case 'o':
        case 'O':
          player.mark('out', event.shiftKey ? null : player.position);
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
  <TopBar onFullscreen={toggleFullscreen} onExport={() => (exportOpen = true)} />

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
      <VisualStage
        mode={$app.settings.visualMode}
        aspect={$app.settings.aspect}
        safeAreas={$app.settings.safeAreas}
        paused={$exporter.status === 'running'}
      />
    {/if}
    {#if $app.tracks.length === 0}
      <div class="welcome">
        <h1>Drop your music here</h1>
        <p>MP3, M4A, FLAC, Ogg, Opus or WAV. Several files make a queue.</p>
      </div>
    {/if}
    {#if !exportOpen && ['interrupted', 'done', 'failed'].includes($exporter.status)}
      <button class="export-note" onclick={() => (exportOpen = true)} data-testid="export-note">
        <Icon name="export" size={16} />
        {#if $exporter.status === 'interrupted'}
          An export was interrupted. Resume it…
        {:else if $exporter.status === 'done'}
          Your video is ready.
        {:else}
          The export stopped. Details…
        {/if}
      </button>
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
  <ExportDialog open={exportOpen} onclose={() => (exportOpen = false)} />
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
  .export-note {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 20%, var(--surface));
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
