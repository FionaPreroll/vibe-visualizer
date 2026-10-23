<script lang="ts">
  import { flushSync, getAllContexts, mount, onDestroy, onMount, unmount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { isClean } from '../core/audio/dsp/sound-settings';
  import { ControllerService } from '../core/control/controller-service';
  import { APP_NAME, DEFAULT_SETTINGS, PANEL_WIDTH_RANGE } from '../core/state/app-state';
  import { errorMessage } from '../core/util/format';
  import { isSoundFile } from '../core/export/export-job';
  import { Exporter, type ExportState } from '../core/export/exporter';
  import { Player } from '../core/player/player';
  import type { SceneKind } from '../core/render/render-protocol';
  import { VisualAssets } from '../core/render/visual-assets';
  import AnalysisView from './AnalysisView.svelte';
  import { provideControllers } from './controller-context';
  import ControllerDialog from './ControllerDialog.svelte';
  import { renderDefaultLogo } from './default-logo';
  import DetailWaveform from './DetailWaveform.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import Guard from './Guard.svelte';
  import HelpDialog from './HelpDialog.svelte';
  import LivePanel from './LivePanel.svelte';
  import NewVersionNotice from './NewVersionNotice.svelte';
  import { perfEnabled } from './perf';
  import PerfOverlay from './PerfOverlay.svelte';
  import { provideExporter } from './exporter-context';
  import { notifyExportEnd } from './export-notify';
  import Icon from './Icon.svelte';
  import { openMiniPlayerWindow, supportsMiniPlayer } from './mini-player';
  import MiniPlayerControls from './MiniPlayerControls.svelte';
  import { savePicture } from './picture';
  import {
    openSecondScreenWindow,
    placeOnOtherScreen,
    toggleWindowFullscreen,
  } from './second-screen';
  import SecondScreenControls from './SecondScreenControls.svelte';
  import { providePlayer } from './player-context';
  import { portal } from './portal';
  import ProblemNotice from './ProblemNotice.svelte';
  import QueuePanel from './QueuePanel.svelte';
  import SettingsDialog from './SettingsDialog.svelte';
  import { releasedShortcut, shortcutFor, type ShortcutActions } from './shortcuts';
  import { provideCapture, StageCapture } from './stage-capture';
  import SoundPanel from './SoundPanel.svelte';
  import TopBar from './TopBar.svelte';
  import TransportBar from './TransportBar.svelte';
  import VisualsPanel from './VisualsPanel.svelte';
  import VisualStage from './VisualStage.svelte';
  import WelcomeIntro from './WelcomeIntro.svelte';
  import { windowTitle, type UnseenOutcome } from './window-title';
  import { lookSettings } from './track-look';
  import type { KaleidoSettings } from '../core/render/kaleido-settings';
  import type { LogoSpectrumSettings } from '../core/render/visual-settings';
  import { provideAssets } from './visuals-context';

  const player = new Player();
  providePlayer(player);
  const assets = new VisualAssets();
  provideAssets(assets);
  const exporter = new Exporter();
  provideExporter(exporter);
  const controllers = new ControllerService(player);
  provideControllers(controllers);
  const capture = new StageCapture();
  provideCapture(capture);
  const captureReady = capture.ready;
  const { tracks, currentTrack, settings, sound, live, error, undo } = player.parts;
  let exportOpen = $state(false);
  let helpOpen = $state(false);
  let controllerOpen = $state(false);
  let settingsOpen = $state(false);
  /** The help's section: where it was left, or the shortcuts for "?". */
  let helpSection = $state('getting-started');
  let welcomeOpen = $state(false);
  let stage: HTMLElement;
  /** While the side panel's edge is dragged: the panel's width, stored when it is let go. */
  let dragWidth = $state<number | null>(null);
  const panelWidth = $derived(dragWidth ?? $settings.panelWidth);
  /** In a narrow window the side panel lies over the stage instead of beside it. */
  const panelOver = new MediaQuery('max-width: 1099px');
  /** In fullscreen, the mouse cursor hides after a moment without movement (DS-01). */
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  // The lettering of the default logo in the ring, which the user can change; the app's own
  // name, in the title and the notices, is always APP_NAME. Derived, so that the logo is drawn
  // again when the lettering changes, not with every change of the state (that takes a while).
  const logoText = $derived($settings.logoText);
  /** How an export ended while the tab was in the background, until the tab is seen again. */
  let unseen = $state<UnseenOutcome>(null);
  // The title says what an export is doing, so that it shows in the tab while the user works
  // elsewhere.
  const title = $derived(windowTitle(APP_NAME, $exporter, unseen));
  $effect(() => {
    document.title = title;
    if (outWindow) outWindow.document.title = title;
  });
  /** "Your video is ready.", or "Your sounds are ready." and so on. */
  function readyNote(count: number, fileName: string): string {
    const [one, many] = isSoundFile(fileName) ? ['sound', 'sounds'] : ['video', 'videos'];
    return count > 1 ? `Your ${many} are ready.` : `Your ${one} is ready.`;
  }
  // A track with a look of its own (PR-06): the visuals take it when it starts, or when the
  // look is given to the track playing. In the analysis, only the mode's settings change.
  const currentLook = $derived.by(() => {
    const track = $currentTrack;
    return track?.look ? `${track.id}|${track.look.mode}|${track.look.preset}` : null;
  });
  $effect(() => {
    if (!currentLook) return;
    untrack(() => {
      const track = $currentTrack;
      const look = lookSettings(track?.look ?? null);
      if (!track?.look || !look) return;
      if (track.look.mode === 'logoSpectrum') {
        player.replaceVisuals(look as LogoSpectrumSettings);
      } else {
        player.replaceKaleido(look as KaleidoSettings);
      }
      const mode = $settings.visualMode;
      if (mode !== 'analysis' && mode !== track.look.mode) {
        player.updateSettings({ visualMode: track.look.mode });
      }
    });
  });
  let exportStatus: ExportState['status'] = 'idle';
  $effect(() => {
    const state = $exporter;
    const was = exportStatus;
    exportStatus = state.status;
    if (was !== 'running' || document.visibilityState === 'visible') return;
    if (state.status !== 'done' && state.status !== 'failed') return;
    unseen = state.status;
    if (!untrack(() => $settings.exportNotify)) return;
    const name = APP_NAME;
    if (state.status === 'done') {
      const several = state.videos.length > 1;
      const [one, many] = isSoundFile(state.fileName) ? ['sound', 'sounds'] : ['video', 'videos'];
      notifyExportEnd(
        name,
        several ? `Your ${many} are ready` : `Your ${one} is ready`,
        several ? `${state.videos.length} ${many}` : state.fileName,
      );
    } else {
      notifyExportEnd(name, 'The export failed', state.message);
    }
  });
  $effect(() => {
    let current = true;
    void renderDefaultLogo(logoText).then((blob) => {
      if (current) assets.setDefaultLogo(blob);
    });
    return () => {
      current = false;
    };
  });

  /**
   * Stops the controllers, the export, the audio and the workers; the mini player or the second
   * screen goes.
   */
  function teardown() {
    clearTimeout(idleTimer);
    if (outWindow) {
      outWindow.removeEventListener('pagehide', bringBack);
      outWindow.close();
    }
    if (outControls) void unmount(outControls);
    outControls = null;
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

  /** Where the panel's edge was taken hold of, and the panel's width then. */
  let resizing: { x: number; width: number } | null = null;

  function withinPanelRange(width: number): number {
    return Math.round(Math.min(PANEL_WIDTH_RANGE.max, Math.max(PANEL_WIDTH_RANGE.min, width)));
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { x: event.clientX, width: panelWidth };
  }

  function resize(event: PointerEvent) {
    if (!resizing) return;
    // The edge is the panel's left one: to the left, the panel gets wider.
    dragWidth = withinPanelRange(resizing.width + resizing.x - event.clientX);
  }

  function endResize() {
    if (!resizing) return;
    resizing = null;
    if (dragWidth !== null) player.updateSettings({ panelWidth: dragWidth });
    dragWidth = null;
  }

  /** The arrow keys move the edge (with Shift, further); Home and End: narrowest and widest. */
  function resizeByKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 60 : 20;
    const width = {
      ArrowLeft: panelWidth + step,
      ArrowRight: panelWidth - step,
      Home: PANEL_WIDTH_RANGE.min,
      End: PANEL_WIDTH_RANGE.max,
    }[event.key];
    if (width === undefined) return;
    event.preventDefault();
    player.updateSettings({ panelWidth: withinPanelRange(width) });
  }

  /** Over the stage, the side panel closes with Escape or a click on the stage beside it. */
  function closePanelOver() {
    if (panelOver.current && $settings.panelOpen) player.updateSettings({ panelOpen: false });
  }

  function onPointerMove() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = document.fullscreenElement === stage), 2500);
  }

  /** Fullscreen, by a key or a button in `source`: the tab, or the window the visuals are in. */
  function toggleFullscreen(source: Window = window) {
    if (outKind === 'screen' && outWindow) {
      // The second screen's window goes fullscreen from a key or a click in it; from the tab,
      // the browser would refuse it: the window comes to the front, saying how.
      if (source === outWindow) toggleWindowFullscreen(outWindow);
      else outWindow.focus();
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (outWindow) {
      // The visuals come back from the mini player for it. From its window, the browser may
      // refuse the tab's fullscreen: the visuals are back in the tab then.
      closeOutside();
      stage.requestFullscreen().catch(() => undefined);
    } else {
      void stage.requestFullscreen();
    }
  }

  /**
   * The window the visuals are in while it is open, the mini player's (DS-06) or the second
   * screen's (DS-03), and where the stage goes in it.
   */
  let outWindow = $state<Window | null>(null);
  let outKind = $state<'mini' | 'screen' | null>(null);
  let outSlot = $state<HTMLElement | null>(null);
  /** Its controls: a Svelte root of their own, which also handles the events in that window. */
  let outControls: ReturnType<typeof mount> | null = null;
  let miniOpening = false;
  /** The player, the assets and the rest, for the controls in the other window. */
  const contexts = getAllContexts();

  /**
   * The visual mode on the stage. In the Analysis, the mini player goes on showing the visual
   * mode before it.
   */
  let lastScene: SceneKind = 'logoSpectrum';
  const stageMode = $derived.by(() => {
    const mode = $settings.visualMode;
    if (mode !== 'analysis') lastScene = mode;
    return lastScene;
  });

  /**
   * Opens the mini player (DS-06): the stage moves into a small window of its own, on top of the
   * other tabs and apps, with controls for the music.
   */
  async function openMiniPlayer() {
    if (outKind === 'mini' || miniOpening || !supportsMiniPlayer()) return;
    miniOpening = true;
    let view: Window | null = null;
    try {
      const opening = openMiniPlayerWindow($settings.aspect, title);
      // The second screen gives the visuals up; the browser asked for the window first.
      closeOutside();
      view = await opening;
      takeOutside(view, 'mini');
    } catch (error) {
      view?.close();
      player.reportError(`The mini player could not open: ${errorMessage(error)}`);
    } finally {
      miniOpening = false;
    }
  }

  /**
   * Opens the second screen (DS-03): the stage moves into a window of its own, for a projector
   * or another monitor, while the controls stay in the tab. Where the browser can, the window
   * moves onto the other screen by itself.
   */
  function openSecondScreen() {
    if (outKind === 'screen') return;
    let view: Window | null = null;
    try {
      view = openSecondScreenWindow(title);
      closeOutside();
      takeOutside(view, 'screen');
      void placeOnOtherScreen(view);
    } catch (error) {
      view?.close();
      player.reportError(`The second screen could not open: ${errorMessage(error)}`);
    }
  }

  /** The stage and the controls move into `view`, whose keys work as the tab's. */
  function takeOutside(view: Window, kind: 'mini' | 'screen') {
    const slot = view.document.createElement('div');
    slot.style.cssText = 'position: fixed; inset: 0';
    view.document.body.style.cssText = 'margin: 0; background: #000';
    view.document.body.append(slot);
    try {
      outControls =
        kind === 'mini'
          ? mount(MiniPlayerControls, {
              target: view.document.body,
              props: { onback: closeOutside },
              context: contexts,
            })
          : mount(SecondScreenControls, {
              target: view.document.body,
              props: { view, onback: closeOutside },
              context: contexts,
            });
    } catch (error) {
      outControls = null;
      throw error;
    }
    view.addEventListener('keydown', onKey);
    view.addEventListener('keyup', onKeyUp);
    view.addEventListener('blur', releaseNudge);
    // Its own close button, and the browser's "back to tab" or close.
    view.addEventListener('pagehide', bringBack, { once: true });
    outWindow = view;
    outKind = kind;
    outSlot = slot;
  }

  /** The stage comes back into the tab, before the other window goes. */
  function bringBack() {
    const view = outWindow;
    if (!view) return;
    outSlot = null;
    outWindow = null;
    outKind = null;
    flushSync();
    if (outControls) void unmount(outControls);
    outControls = null;
    view.removeEventListener('keydown', onKey);
    view.removeEventListener('keyup', onKeyUp);
    view.removeEventListener('blur', releaseNudge);
    view.removeEventListener('pagehide', bringBack);
  }

  /** The visuals come back into the tab, and the mini player's or second screen's window goes. */
  function closeOutside() {
    const view = outWindow;
    bringBack();
    view?.close();
  }

  function toggleMiniPlayer() {
    if (outKind === 'mini') closeOutside();
    else void openMiniPlayer();
  }

  function toggleSecondScreen() {
    if (outKind === 'screen') closeOutside();
    else openSecondScreen();
  }

  /** Saves the picture on the stage as a PNG (EX-10); not while an export renders. */
  function takePicture() {
    if (!$captureReady || $exporter.status === 'running' || $settings.visualsPaused) return;
    savePicture(player, capture).catch((error: unknown) =>
      player.reportError(`The picture could not be saved: ${errorMessage(error)}`),
    );
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
    if (target.closest('input[type="range"], [role="slider"], [role="separator"]')) {
      return SLIDER_KEYS.has(key);
    }
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

  /** What the keyboard shortcuts act on, besides the player. */
  const shortcutActions: ShortcutActions = {
    player,
    toggleFullscreen,
    toggleMiniPlayer,
    takePicture,
    openHelp: (section) => {
      helpSection = section;
      helpOpen = true;
    },
  };

  /**
   * The keyboard shortcuts (UI-04, in shortcuts.ts), in the tab and in the mini player's or
   * second screen's.
   */
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closePanelOver();
    const shortcut = shortcutFor(event);
    if (!shortcut) return;
    if (ownsKey(event.target, event.key)) return;
    // A modal dialog (the export) has the keyboard to itself.
    if (document.querySelector('dialog[open]')) return;
    if (shortcut.run?.(shortcutActions, event) !== false) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent) {
    releasedShortcut(event)?.release?.(shortcutActions);
  }

  /** A nudge held with a key ends when the window loses the keyboard. */
  function releaseNudge() {
    player.nudge(0);
  }

  onMount(() => {
    // A DJ controller connected before comes back by itself, where MIDI is still allowed.
    void controllers.resume();
    // Entering fullscreen starts the countdown for hiding the cursor, even without movement.
    const onFullscreen = () => onPointerMove();
    document.addEventListener('fullscreenchange', onFullscreen);
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
    window.addEventListener('blur', releaseNudge);
    window.addEventListener('click', onClick);
    window.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('keydown', onAnyKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseNudge);
      window.removeEventListener('click', onClick);
      window.removeEventListener('change', onChange);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  });
</script>

<!-- Back in the tab, how an export ended has been seen. -->
<svelte:document
  onvisibilitychange={() => {
    if (document.visibilityState === 'visible') unseen = null;
  }}
/>

<div
  class="shell"
  class:panel-open={$settings.panelOpen}
  class:panel-over={panelOver.current}
  style:--panel-width="{panelWidth}px"
>
  <TopBar
    onFullscreen={() => toggleFullscreen()}
    onPicture={takePicture}
    onExport={() => (exportOpen = true)}
    onSettings={() => (settingsOpen = true)}
    onHelp={() => (helpOpen = true)}
    onController={() => (controllerOpen = true)}
    miniPlayer={outKind === 'mini'}
    onMiniPlayer={toggleMiniPlayer}
    secondScreen={outKind === 'screen'}
    onSecondScreen={toggleSecondScreen}
  />

  <main
    class="stage"
    class:idle
    bind:this={stage}
    aria-label="Visual stage"
    onpointermove={onPointerMove}
    onpointerdown={(event) => {
      if (!(event.target as Element).closest('button, a, input, select')) closePanelOver();
    }}
  >
    <Guard where="The visuals">
      {#if $settings.visualMode === 'analysis'}
        <AnalysisView />
      {/if}
      <!-- The mini player's (DS-06) or the second screen's window (DS-03) takes the stage, also
           while the tab shows the Analysis. -->
      {#if $settings.visualMode !== 'analysis' || outWindow}
        <div class="stage-host" use:portal={outSlot}>
          <VisualStage
            mode={stageMode}
            aspect={$settings.aspect}
            safeAreas={$settings.safeAreas}
            paused={$exporter.status === 'running' || $settings.visualsPaused}
            resting={$settings.visualsPaused}
            view={outWindow ?? window}
          />
        </div>
      {/if}
    </Guard>
    {#if outWindow && $settings.visualMode !== 'analysis'}
      {@const mini = outKind === 'mini'}
      <div class="mini-note" data-testid={mini ? 'mini-note' : 'screen-note'}>
        <div class="card">
          <Icon name={mini ? 'miniPlayer' : 'secondScreen'} size={28} />
          <p>
            {mini
              ? 'The visuals play in the mini player.'
              : 'The visuals play in the window of the second screen.'}
          </p>
          {#if !mini}
            <p class="sub">There, F or a double-click shows them in fullscreen.</p>
          {/if}
          <button
            onclick={closeOutside}
            data-testid={mini ? 'mini-bring-back' : 'screen-bring-back'}>Bring them back</button
          >
        </div>
      </div>
    {/if}
    <!-- With the visuals in another window, the note says where they are; the queue says the rest. -->
    {#if $tracks.length === 0 && $live.status === 'off' && !outWindow}
      <div class="welcome" data-testid="empty-hint">
        <div class="card">
          <h1>Drop your music here</h1>
          <p>MP3, M4A, FLAC, Ogg, Opus or WAV. Several files make a queue.</p>
          <p>Or visualise music from another app or device: see the Live tab.</p>
        </div>
      </div>
    {/if}
    <div class="notes">
      <ProblemNotice />
      <NewVersionNotice />
      {#if $undo}
        <div class="undo" role="status" data-testid="undo-toast">
          <span>{$undo}</span>
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
            {readyNote($exporter.videos.length, $exporter.fileName)}
          {:else}
            The export stopped. Details…
          {/if}
        </button>
      {/if}
    </div>
    {#if $error}
      <div class="error" role="alert" data-testid="app-error">
        <Icon name="alert" size={18} />
        <span>{$error}</span>
        <button onclick={() => player.dismissError()} aria-label="Dismiss">
          <Icon name="close" size={16} />
        </button>
      </div>
    {/if}
  </main>

  {#if $settings.panelOpen}
    <aside class="panel">
      <!-- The panel's edge: dragged, or moved with the arrow keys, it makes the panel wider or
           narrower; a double-click gives it its usual width. A focusable separator with a value
           is a widget (the window splitter of the ARIA practices), which Svelte does not know. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="edge"
        class:dragging={dragWidth !== null}
        role="separator"
        aria-orientation="vertical"
        aria-label="Width of the side panel"
        aria-valuemin={PANEL_WIDTH_RANGE.min}
        aria-valuemax={PANEL_WIDTH_RANGE.max}
        aria-valuenow={panelWidth}
        tabindex="0"
        title="Drag to make the panel wider or narrower; a double-click gives it its usual width"
        onpointerdown={startResize}
        onpointermove={resize}
        onpointerup={endResize}
        onpointercancel={endResize}
        ondblclick={() => player.updateSettings({ panelWidth: DEFAULT_SETTINGS.panelWidth })}
        onkeydown={resizeByKey}
        data-testid="panel-edge"
      ></div>
      <div class="tabs" role="tablist" aria-label="Side panel">
        <button
          role="tab"
          aria-selected={$settings.panel === 'queue'}
          onclick={() => player.updateSettings({ panel: 'queue' })}
        >
          <Icon name="music" size={16} /> Queue
        </button>
        <button
          role="tab"
          aria-selected={$settings.panel === 'sound'}
          onclick={() => player.updateSettings({ panel: 'sound' })}
        >
          <Icon name="knob" size={16} /> Sound
          {#if !isClean($sound)}<span class="sound-dot" aria-label="(changed)"></span>{/if}
        </button>
        <button
          role="tab"
          aria-selected={$settings.panel === 'visuals'}
          onclick={() => player.updateSettings({ panel: 'visuals' })}
        >
          <Icon name="sliders" size={16} /> Visuals
        </button>
        <button
          role="tab"
          aria-selected={$settings.panel === 'live'}
          onclick={() => player.updateSettings({ panel: 'live' })}
        >
          <Icon name="live" size={16} /> Live
          {#if $live.status === 'on'}<span class="live-dot" aria-label="(on)"></span>{/if}
        </button>
      </div>
      <div class="panel-body" role="tabpanel">
        <Guard where="The side panel">
          {#if $settings.panel === 'queue'}
            <QueuePanel />
          {:else if $settings.panel === 'sound'}
            <SoundPanel />
          {:else if $settings.panel === 'visuals'}
            <VisualsPanel />
          {:else}
            <LivePanel />
          {/if}
        </Guard>
      </div>
    </aside>
  {/if}

  <!-- Also before a track plays, so switching it on shows where it goes; not for live input,
       which has no waveform of its own. -->
  {#if $settings.detailWaveform && $live.status === 'off'}
    <div class="detail-row">
      <Guard where="The waveform"><DetailWaveform /></Guard>
    </div>
  {/if}
  <Guard where="The transport bar"><TransportBar /></Guard>
  <ExportDialog open={exportOpen} onclose={() => (exportOpen = false)} />
  <ControllerDialog
    open={controllerOpen}
    onclose={() => (controllerOpen = false)}
    onhelp={() => {
      controllerOpen = false;
      helpSection = 'dj-controller';
      helpOpen = true;
    }}
  />
  <SettingsDialog
    open={settingsOpen}
    onclose={() => (settingsOpen = false)}
    onhelp={(section) => {
      settingsOpen = false;
      helpSection = section;
      helpOpen = true;
    }}
  />
  <HelpDialog
    open={helpOpen}
    bind:section={helpSection}
    onclose={() => (helpOpen = false)}
    onwelcome={() => (welcomeOpen = true)}
    onsettings={() => (settingsOpen = true)}
  />
  <DropOverlay />
  {#if perfEnabled}
    <!-- With ?perf in the address: the measurements on screen. -->
    <PerfOverlay />
  {/if}
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
    grid-template-columns: minmax(0, 1fr) var(--panel-width);
  }
  /* A narrow window: the panel lies over the stage on the right, and the stage keeps its width. */
  .shell.panel-over {
    grid-template-columns: minmax(0, 1fr);
  }
  .shell.panel-over .panel {
    grid-column: 1;
    justify-self: end;
    width: min(var(--panel-width), 100%);
    z-index: 5;
    box-shadow: -12px 0 32px rgb(0 0 0 / 0.55);
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
  /* The stage and the panel by their places: over the stage, the panel shares its cell. */
  .stage {
    grid-row: 2;
    grid-column: 1;
    position: relative;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 40%, #16162a 0%, var(--bg) 70%);
  }
  .stage.idle {
    cursor: none;
  }
  /* The stage's place: in the tab it adds no box, in the mini player's window it fills it. */
  .stage-host {
    display: contents;
  }
  .mini-note {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    pointer-events: none;
  }
  .mini-note .card {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 18px 26px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--muted);
    text-align: center;
    pointer-events: auto;
  }
  .mini-note p {
    margin: 0;
    color: var(--text);
  }
  .mini-note p.sub {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .panel {
    grid-row: 2;
    grid-column: 2;
    position: relative;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--border);
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -5px;
    z-index: 1;
    width: 9px;
    cursor: col-resize;
    touch-action: none;
  }
  /* A line along the edge where it can be taken hold of, and while it is dragged or focused. */
  .edge::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .edge:hover::after,
  .edge:focus-visible::after,
  .edge.dragging::after {
    opacity: 1;
  }
  .edge:focus-visible {
    outline: none;
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
    font-size: var(--text-sm);
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
    font-size: var(--text-2xl);
  }
  .welcome p {
    margin: 0;
    color: var(--muted);
  }
  .welcome p + p {
    margin-top: 4px;
    font-size: var(--text-md);
  }
  /* In a low window, with the detail waveform below the stage too, a smaller card stays below
     the logo; the notes still fit under it. */
  @media (max-height: 760px) {
    .welcome {
      bottom: 56px;
    }
    .welcome .card {
      padding: 8px 18px 10px;
    }
    .welcome h1 {
      margin-bottom: 2px;
      font-size: var(--text-xl);
    }
    .welcome p {
      font-size: var(--text-md);
    }
    .welcome p + p {
      margin-top: 2px;
      font-size: var(--text-sm);
    }
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
    font-size: var(--text-md);
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
