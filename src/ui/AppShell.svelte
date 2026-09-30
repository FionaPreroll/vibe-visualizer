<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { isClean } from '../core/audio/dsp/sound-settings';
  import { ControllerService } from '../core/control/controller-service';
  import { REPEAT_MODES } from '../core/state/app-state';
  import { Exporter } from '../core/export/exporter';
  import { Player } from '../core/player/player';
  import { VisualAssets } from '../core/render/visual-assets';
  import AnalysisView from './AnalysisView.svelte';
  import { provideControllers } from './controller-context';
  import ControllerDialog from './ControllerDialog.svelte';
  import { renderDefaultLogo } from './default-logo';
  import DetailWaveform from './DetailWaveform.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import HelpDialog from './HelpDialog.svelte';
  import LivePanel from './LivePanel.svelte';
  import { provideExporter } from './exporter-context';
  import Icon from './Icon.svelte';
  import { providePlayer } from './player-context';
  import QueuePanel from './QueuePanel.svelte';
  import { nextVisualMode, stepPreset } from './shortcuts';
  import SoundPanel from './SoundPanel.svelte';
  import TopBar from './TopBar.svelte';
  import TransportBar from './TransportBar.svelte';
  import VisualsPanel from './VisualsPanel.svelte';
  import VisualStage from './VisualStage.svelte';
  import WelcomeIntro from './WelcomeIntro.svelte';
  import { provideAssets } from './visuals-context';

  const player = new Player();
  providePlayer(player);
  const assets = new VisualAssets();
  provideAssets(assets);
  const exporter = new Exporter();
  provideExporter(exporter);
  const controllers = new ControllerService(player);
  provideControllers(controllers);
  const app = player.store;
  let exportOpen = $state(false);
  let helpOpen = $state(false);
  let controllerOpen = $state(false);
  /** The help's section: where it was left, or the shortcuts for "?". */
  let helpSection = $state('getting-started');
  let welcomeOpen = $state(false);
  let stage: HTMLElement;
  /** In fullscreen, the mouse cursor hides after a moment without movement (DS-01). */
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  // The name the user gave the app shows in the window title too, and in the default logo.
  // Derived, so that the effects run when the name changes, not with every change of the state
  // (drawing the logo takes a while).
  const appName = $derived($app.settings.appName);
  $effect(() => {
    document.title = appName;
  });
  $effect(() => {
    let current = true;
    void renderDefaultLogo(appName).then((blob) => {
      if (current) assets.setDefaultLogo(blob);
    });
    return () => {
      current = false;
    };
  });

  /** Stops the controllers, the export, the audio and the workers. */
  function teardown() {
    clearTimeout(idleTimer);
    controllers.dispose();
    exporter.dispose();
    player.dispose();
  }

  /**
   * Leaving the page (a reload, another page): everything stops first, as when the app goes.
   * Chromium sometimes hung when it tore the render worker (WebGL in a worker) down with the page
   * itself, after the audio had started: the next page never loaded.
   */
  function onPageHide(event: PageTransitionEvent) {
    if (!event.persisted) teardown();
  }

  onMount(() => {
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  });

  onDestroy(teardown);

  function onPointerMove() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = document.fullscreenElement === stage), 2500);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen();
  }

  /** Keys a focused slider takes for itself. */
  const SLIDER_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]);

  /**
   * Whether the focused element needs `key` itself. Text fields and selects take every key,
   * sliders the arrows, Home, End and Page Up/Down, and checkboxes and radio buttons Space (radio
   * buttons the arrows too). Everything else leaves the keys to the app: Space plays and pauses
   * also while a button has the focus (Enter still presses it), and letters work right after a
   * click.
   */
  function ownsKey(target: EventTarget | null, key: string): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const typing =
      target.isContentEditable ||
      target.closest(
        'textarea, select, input:not([type="range"], [type="checkbox"], [type="radio"], [type="color"], [type="file"])',
      ) !== null;
    if (typing) return true;
    if (target.closest('input[type="range"], [role="slider"]')) return SLIDER_KEYS.has(key);
    if (target.matches('input[type="checkbox"]')) return key === ' ';
    if (target.matches('input[type="radio"]')) return key === ' ' || key.startsWith('Arrow');
    return false;
  }

  /** Controls that keep the focus after a click, although a mouse user needs none. */
  const CLICKED = 'button, summary, input[type="checkbox"], input[type="radio"]';

  /**
   * A control used with the mouse lets go of the focus, so no focus ring shows up on it at the
   * next key and the keys go on to the app. Controls reached with Tab keep it, and so does
   * whatever is in a dialog.
   */
  function releaseFocus(control: Element | null | undefined): void {
    if (!(control instanceof HTMLElement) || control !== document.activeElement) return;
    if (control.closest('dialog')) return;
    control.blur();
  }

  onMount(() => {
    // A DJ controller connected before comes back by itself, where MIDI is still allowed.
    void controllers.resume();
    // Entering fullscreen starts the countdown for hiding the cursor, even without movement.
    const onFullscreen = () => onPointerMove();
    document.addEventListener('fullscreenchange', onFullscreen);
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+Z (Cmd+Z) undoes a removal or deletion; text fields keep their own undo.
      const command = event.metaKey || event.ctrlKey;
      if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (ownsKey(event.target, event.key) || document.querySelector('dialog[open]')) return;
        if (player.state.undo) {
          player.undo();
          event.preventDefault();
        }
        return;
      }
      // Brackets need AltGr or Option on some layouts (German, for one).
      const bracket = event.key === '[' || event.key === ']';
      if (event.metaKey || ((event.ctrlKey || event.altKey) && !bracket)) return;
      if (ownsKey(event.target, event.key)) return;
      // A modal dialog (the export) has the keyboard to itself.
      if (document.querySelector('dialog[open]')) return;
      // Hot cues (TR-04): 1–8 jump to a cue or set an empty one; with Shift they are deleted.
      // By key position, so Shift works on every keyboard layout.
      const digit = /^Digit([1-8])$/.exec(event.code);
      if (digit) {
        const index = Number(digit[1]) - 1;
        if (event.shiftKey) player.setCue(index, null);
        else void player.cue(index);
        event.preventDefault();
        return;
      }
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
        case 'w':
          player.updateSettings({ detailWaveform: !player.state.settings.detailWaveform });
          break;
        case 's':
          player.updateSettings({ shuffle: !player.state.settings.shuffle });
          break;
        case 'q':
          player.updateSettings({ quantize: !player.state.settings.quantize });
          break;
        case 'r': {
          const index = REPEAT_MODES.indexOf(player.state.settings.repeat);
          player.updateSettings({ repeat: REPEAT_MODES[(index + 1) % REPEAT_MODES.length]! });
          break;
        }
        case 'v':
          nextVisualMode(player);
          break;
        case '[':
          stepPreset(player, -1);
          break;
        case ']':
          stepPreset(player, 1);
          break;
        case '?':
          helpSection = 'keyboard-shortcuts';
          helpOpen = true;
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
        // Tempo in fine steps, and nudging while the key is held (TMP-03).
        case '-':
          player.stepTempo(-1);
          break;
        case '+':
        case '=':
          player.stepTempo(1);
          break;
        case ',':
          if (!event.repeat) player.nudge(-1);
          break;
        case '.':
          if (!event.repeat) player.nudge(1);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ',' || event.key === '.') player.nudge(0);
    };
    const release = () => player.nudge(0);
    // Whether the last input came from a pointer (a select chosen with the mouse lets go too).
    let pointing = false;
    const onPointerDown = () => (pointing = true);
    const onAnyKey = () => (pointing = false);
    // A click from the keyboard has no count (detail 0).
    const onClick = (event: MouseEvent) => {
      if (event.detail > 0) releaseFocus((event.target as Element | null)?.closest(CLICKED));
    };
    const onChange = (event: Event) => {
      if (pointing && event.target instanceof HTMLSelectElement) releaseFocus(event.target);
    };
    window.addEventListener('keydown', onAnyKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    window.addEventListener('click', onClick);
    window.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('keydown', onAnyKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      window.removeEventListener('click', onClick);
      window.removeEventListener('change', onChange);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  });
</script>

<div class="shell" class:panel-open={$app.settings.panelOpen}>
  <TopBar
    onFullscreen={toggleFullscreen}
    onExport={() => (exportOpen = true)}
    onHelp={() => (helpOpen = true)}
    onController={() => (controllerOpen = true)}
  />

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
    {#if $app.tracks.length === 0 && $app.live.status === 'off'}
      <div class="welcome" data-testid="empty-hint">
        <div class="card">
          <h1>Drop your music here</h1>
          <p>MP3, M4A, FLAC, Ogg, Opus or WAV. Several files make a queue.</p>
          <p>Or visualise music from another app or device: see the Live tab.</p>
        </div>
      </div>
    {/if}
    <div class="notes">
      {#if $app.undo}
        <div class="undo" role="status" data-testid="undo-toast">
          <span>{$app.undo}</span>
          <button onclick={() => player.undo()} title="Undo (Ctrl+Z)" data-testid="undo">
            Undo
          </button>
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
    </div>
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
          aria-selected={$app.settings.panel === 'sound'}
          onclick={() => player.updateSettings({ panel: 'sound' })}
        >
          <Icon name="knob" size={16} /> Sound
          {#if !isClean($app.sound)}<span class="sound-dot" aria-label="(changed)"></span>{/if}
        </button>
        <button
          role="tab"
          aria-selected={$app.settings.panel === 'visuals'}
          onclick={() => player.updateSettings({ panel: 'visuals' })}
        >
          <Icon name="sliders" size={16} /> Visuals
        </button>
        <button
          role="tab"
          aria-selected={$app.settings.panel === 'live'}
          onclick={() => player.updateSettings({ panel: 'live' })}
        >
          <Icon name="live" size={16} /> Live
          {#if $app.live.status === 'on'}<span class="live-dot" aria-label="(on)"></span>{/if}
        </button>
      </div>
      <div class="panel-body" role="tabpanel">
        {#if $app.settings.panel === 'queue'}
          <QueuePanel />
        {:else if $app.settings.panel === 'sound'}
          <SoundPanel />
        {:else if $app.settings.panel === 'visuals'}
          <VisualsPanel />
        {:else}
          <LivePanel />
        {/if}
      </div>
    </aside>
  {/if}

  {#if $app.settings.detailWaveform && $app.currentId !== null && $app.live.status === 'off'}
    <div class="detail-row"><DetailWaveform /></div>
  {/if}
  <TransportBar />
  <ExportDialog open={exportOpen} onclose={() => (exportOpen = false)} />
  <ControllerDialog open={controllerOpen} onclose={() => (controllerOpen = false)} />
  <HelpDialog
    open={helpOpen}
    bind:section={helpSection}
    onclose={() => (helpOpen = false)}
    onwelcome={() => (welcomeOpen = true)}
  />
  <DropOverlay />
  <WelcomeIntro
    bind:open={welcomeOpen}
    onhelp={() => {
      helpSection = 'getting-started';
      helpOpen = true;
    }}
  />
</div>

<style>
  .shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-columns: minmax(0, 1fr);
  }
  .shell.panel-open {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
  .shell > :global(.topbar),
  .shell > :global(.transport),
  .detail-row {
    grid-column: 1 / -1;
  }
  /* Without the detail waveform its row stays empty; the transport keeps the last row. */
  .shell > :global(.transport) {
    grid-row: 4;
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
    gap: 2px;
    padding: 8px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 8px;
    font-size: 13px;
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
  .live-dot,
  .sound-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fail);
  }
  .sound-dot {
    background: var(--accent);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  /* Below the logo, on a card of its own, so neither covers the other. */
  .welcome {
    position: absolute;
    left: 0;
    right: 0;
    bottom: max(7%, 64px);
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .welcome .card {
    max-width: min(560px, calc(100% - 32px));
    padding: 14px 24px 16px;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    border-radius: 14px;
    background: rgb(11 11 18 / 0.72);
    backdrop-filter: blur(10px);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
    text-align: center;
  }
  .welcome h1 {
    margin: 0 0 6px;
    font-size: 26px;
  }
  .welcome p {
    margin: 0;
    color: var(--muted);
  }
  .welcome p + p {
    margin-top: 4px;
    font-size: 14px;
  }
  .notes {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .undo {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    font-size: 14px;
    white-space: nowrap;
  }
  .undo button {
    padding: 4px 12px;
    border-color: var(--accent);
    color: var(--accent);
    background: transparent;
  }
  .export-note {
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
