<script lang="ts">
  import { ASPECT_RATIOS, isAspectRatio } from '../core/export/video-format';
  import { APP_NAME_LENGTH, DEFAULT_APP_NAME, type VisualMode } from '../core/state/app-state';
  import { useControllers } from './controller-context';
  import { useExporter } from './exporter-context';
  import Icon, { type IconName } from './Icon.svelte';
  import { usePlayer } from './player-context';
  import { useCapture } from './stage-capture';

  interface Props {
    onFullscreen: () => void;
    /** Saves the picture on the stage (EX-10). */
    onPicture: () => void;
    onExport: () => void;
    onHelp: () => void;
    onController: () => void;
  }
  let { onFullscreen, onPicture, onExport, onHelp, onController }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  const exporter = useExporter();
  const captureReady = useCapture().ready;
  const controllers = useControllers();
  const controllerOn = $derived(
    $controllers.status === 'on' && $controllers.devices.some((device) => device.profile),
  );

  /** Renaming the app (a double-click on its name): the name being typed. */
  let renaming = $state(false);
  let draft = $state('');
  let nameInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (renaming) nameInput?.select();
  });

  function startRenaming() {
    draft = $app.settings.appName;
    renaming = true;
  }

  function finishRenaming(save: boolean) {
    if (!renaming) return;
    renaming = false;
    if (!save) return;
    const name = draft.trim().slice(0, APP_NAME_LENGTH);
    player.updateSettings({ appName: name || DEFAULT_APP_NAME });
  }

  const MODES: { id: VisualMode; label: string; title: string; icon: IconName }[] = [
    { id: 'logoSpectrum', label: 'Logo Spectrum', title: 'Logo Spectrum visuals', icon: 'ring' },
    { id: 'kaleidoscope', label: 'Kaleidoscope', title: 'Kaleidoscope visuals', icon: 'kaleido' },
    { id: 'analysis', label: 'Analysis', title: 'What the visuals react to', icon: 'wave' },
  ];
</script>

<header class="topbar">
  <div class="brand">
    <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="brand-gradient">
          <stop offset="0" stop-color="#3fd9ff" />
          <stop offset="1" stop-color="#b370ff" />
        </radialGradient>
      </defs>
      <path
        d="M32 6 L39 25 L58 32 L39 39 L32 58 L25 39 L6 32 L25 25 Z"
        fill="url(#brand-gradient)"
      />
    </svg>
    {#if renaming}
      <input
        class="name"
        bind:this={nameInput}
        bind:value={draft}
        maxlength={APP_NAME_LENGTH}
        aria-label="Name of the app"
        onkeydown={(event) => {
          if (event.key === 'Enter') finishRenaming(true);
          else if (event.key === 'Escape') finishRenaming(false);
        }}
        onblur={() => finishRenaming(true)}
        data-testid="app-name-input"
      />
    {:else}
      <button
        class="name"
        ondblclick={startRenaming}
        title="Double-click to rename the app"
        data-testid="app-name"
      >
        {$app.settings.appName}
      </button>
    {/if}
  </div>
  <nav>
    <div class="modes" role="group" aria-label="Visual mode">
      {#each MODES as mode (mode.id)}
        <button
          class="toggle"
          class:on={$app.settings.visualMode === mode.id}
          aria-pressed={$app.settings.visualMode === mode.id}
          onclick={() => player.updateSettings({ visualMode: mode.id })}
          title={mode.title}
        >
          <Icon name={mode.icon} size={18} />
          {mode.label}
        </button>
      {/each}
    </div>
    <select
      class="aspect"
      value={$app.settings.aspect}
      onchange={(event) => {
        const aspect = event.currentTarget.value;
        if (isAspectRatio(aspect)) player.updateSettings({ aspect });
      }}
      aria-label="Aspect ratio"
      title="Aspect ratio of the visuals and the video"
      data-testid="aspect-select"
    >
      {#each ASPECT_RATIOS as entry (entry.id)}
        <option value={entry.id}>{entry.id} · {entry.hint}</option>
      {/each}
    </select>
    <button
      class="toggle"
      class:on={$app.settings.safeAreas}
      onclick={() => player.updateSettings({ safeAreas: !$app.settings.safeAreas })}
      aria-pressed={$app.settings.safeAreas}
      title="Safe areas"
    >
      <Icon name="safe" size={18} />
    </button>
    <button class="toggle" onclick={onFullscreen} title="Fullscreen (F)">
      <Icon name="fullscreen" size={18} />
    </button>
    <button
      class="toggle"
      onclick={onPicture}
      disabled={!$captureReady || $exporter.status === 'running'}
      title="Save the picture as a PNG, e.g. as a thumbnail (C)"
      aria-label="Save the picture"
      data-testid="picture-button"
    >
      <Icon name="camera" size={18} />
    </button>
    <button
      class="toggle"
      class:on={$app.settings.panelOpen}
      onclick={() => player.updateSettings({ panelOpen: !$app.settings.panelOpen })}
      aria-pressed={$app.settings.panelOpen}
      title="Side panel"
    >
      <Icon name="panel" size={18} />
    </button>
    <button
      class="toggle controller"
      class:on={controllerOn}
      onclick={onController}
      title={controllerOn ? 'DJ controller: connected' : 'DJ controller'}
      aria-label="DJ controller"
      data-testid="controller-button"
    >
      <Icon name="controller" size={18} />
      {#if controllerOn}<span class="dot"></span>{/if}
    </button>
    <button class="primary export" onclick={onExport} data-testid="export-button">
      <Icon name="export" size={18} />
      {#if $exporter.status === 'running'}
        {@const job = $exporter.job}
        {job.paused ? 'Paused' : 'Exporting'}
        {#if job.batch}{job.batch.index + 1}/{job.batch.count} ·{/if}
        {Math.floor(job.progress * 100)} %
      {:else}
        Export
      {/if}
    </button>
    <button
      class="toggle help"
      onclick={onHelp}
      aria-label="Help"
      title="Help and keyboard shortcuts (?)"
      data-testid="shortcuts-button"
    >
      ?
    </button>
    <!-- The Spike Lab (P0 prototypes) is for development; built apps reach it at #/lab. -->
    {#if import.meta.env.DEV}<a class="lab" href="#/lab">Spike Lab</a>{/if}
  </nav>
</header>

<style>
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
  }
  .name {
    padding: 2px 4px;
    margin-left: -4px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  button.name:hover {
    border-color: var(--border);
  }
  input.name {
    width: 14em;
    border-color: var(--accent);
    background: var(--surface-2);
  }
  nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .modes {
    display: flex;
    gap: 2px;
    margin-right: 8px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: transparent;
    border-color: transparent;
    color: var(--muted);
  }
  .toggle:hover,
  .toggle.on {
    color: var(--text);
    border-color: var(--border);
  }
  .toggle.on {
    background: var(--surface-2);
  }
  .controller {
    position: relative;
  }
  .controller .dot {
    position: absolute;
    top: 4px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
  }
  .help {
    width: 32px;
    justify-content: center;
    font-weight: 700;
  }
  .aspect {
    margin-right: 2px;
    padding: 4px 6px;
    font-size: 13px;
  }
  .export {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
    padding: 5px 12px;
    font-variant-numeric: tabular-nums;
  }
  .lab {
    margin-left: 8px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
