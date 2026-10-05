<script module lang="ts">
  const KEY = 'vibe-visualizer:welcome:v1';

  /** Whether the welcome was seen (it shows once; the help opens it again). */
  function seen(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }
</script>

<script lang="ts">
  import { APP_NAME } from '../core/state/app-state';
  import { onMount } from 'svelte';
  import { bugReportLink, BUG_EMAIL } from './app-info';
  import { LOGO_FONT, loadLogoFont } from './default-logo';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import { useAssets } from './visuals-context';

  /**
   * The first look (VE-05, UI-10): what the app does in three steps, that it is a work in
   * progress and where bug reports go, where it works best, and the warning about flashing
   * visuals. Shown once, before the first visuals; `open` from the help shows it again.
   */
  let { open = $bindable(false), onhelp }: { open?: boolean; onhelp?: () => void } = $props();

  const player = usePlayer();
  const app = player.store;
  const assets = useAssets();
  let dialog: HTMLDialogElement | undefined = $state();
  let logo = $state<string | null>(null);
  let fontReady = $state(false);

  onMount(() => {
    if (!seen()) open = true;
    void loadLogoFont().then((loaded) => (fontReady = loaded));
    return assets.subscribe(() => (logo = assets.shown.logo?.url ?? null));
  });

  $effect(() => {
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  });

  function start() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Not stored: the welcome shows again next time.
    }
    open = false;
  }

  function help() {
    start();
    onhelp?.();
  }
</script>

{#if open}
  <dialog
    bind:this={dialog}
    aria-labelledby="welcome-title"
    oncancel={(event) => {
      event.preventDefault();
      start();
    }}
    data-testid="welcome"
  >
    <header>
      <div class="logo" class:empty={!logo}>
        {#if logo}<img src={logo} alt="" />{/if}
      </div>
      <div>
        <p class="hello">Welcome to</p>
        <h2
          id="welcome-title"
          class:script={fontReady}
          style:font-family={fontReady ? `"${LOGO_FONT}", cursive` : null}
        >
          {APP_NAME}
        </h2>
        <p class="tagline">Music visuals for your videos and DJ sets, right in the browser.</p>
      </div>
    </header>

    <ol class="steps">
      <li>
        <span class="icon"><Icon name="music" size={18} /></span>
        <div>
          <strong>Drop your music</strong>
          <span
            >MP3, M4A, FLAC, Ogg, Opus or WAV; several files make a queue. Or play from another app
            or device in the Live tab.</span
          >
        </div>
      </li>
      <li>
        <span class="icon"><Icon name="ring" size={18} /></span>
        <div>
          <strong>Pick a look</strong>
          <span
            >Logo Spectrum or Kaleidoscope, with presets, your logo and your background in the
            Visuals tab. Everything follows the beat.</span
          >
        </div>
      </li>
      <li>
        <span class="icon"><Icon name="export" size={18} /></span>
        <div>
          <strong>Export or perform</strong>
          <span
            >An MP4 for YouTube or TikTok, the whole track or a clip between two markers; or
            fullscreen (F) for a live set.</span
          >
        </div>
      </li>
    </ol>

    <ul class="notes">
      <li>
        <strong>Work in progress.</strong> Expect rough edges. Bugs and ideas are very welcome:
        <a href={bugReportLink(APP_NAME)} data-testid="welcome-bug-email">{BUG_EMAIL}</a>
      </li>
      <li>
        <strong>Works best in Chrome</strong> on a computer with a good graphics card, above all for the
        Kaleidoscope.
      </li>
      <li class="warning">
        <Icon name="alert" size={16} />
        <span>
          <strong>Flashing visuals.</strong> The visuals move fast, flash and use strong contrasts.
          If you or anyone watching may be sensitive to flashing light (photosensitive epilepsy),
          please take care.
          <label class="calm">
            <input
              type="checkbox"
              checked={$app.settings.reduceFlashing}
              onchange={(event) =>
                player.updateSettings({ reduceFlashing: event.currentTarget.checked })}
              data-testid="welcome-reduce-flashing"
            />
            Reduce flashing (also in Visuals → Display)
          </label>
        </span>
      </li>
    </ul>

    <footer>
      {#if onhelp}
        <button class="ghost" onclick={help} data-testid="welcome-help">How it works</button>
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <button class="primary" onclick={start} autofocus data-testid="welcome-start">Let's go</button
      >
    </footer>
  </dialog>
{/if}

<style>
  dialog {
    width: min(600px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 24px 26px 20px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background:
      radial-gradient(120% 80% at 0% 0%, rgb(63 217 255 / 0.1), transparent 60%),
      radial-gradient(120% 80% at 100% 100%, rgb(179 112 255 / 0.12), transparent 60%),
      var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.6);
  }
  dialog::backdrop {
    background: rgb(5 5 10 / 0.72);
    backdrop-filter: blur(4px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 20px;
  }
  .logo {
    flex: none;
    width: 104px;
    height: 104px;
    border-radius: 50%;
    border: 3px solid #fff;
    overflow: hidden;
    background: radial-gradient(circle at 50% 40%, #231842, #07070d);
    box-shadow:
      0 0 24px rgb(63 217 255 / 0.45),
      0 0 60px rgb(179 112 255 / 0.3);
    animation: pulse 2.4s ease-in-out infinite;
  }
  .logo img {
    display: block;
    width: 100%;
    height: 100%;
    animation: appear 0.6s ease-out;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      transform: scale(1.04);
      box-shadow:
        0 0 32px rgb(63 217 255 / 0.6),
        0 0 80px rgb(179 112 255 / 0.4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .logo {
      animation: none;
    }
  }
  .hello {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  h2 {
    margin: 2px 0 4px;
    font-size: 30px;
    line-height: 1.2;
  }
  h2.script {
    font-size: 36px;
    font-weight: normal;
    background: linear-gradient(90deg, var(--accent-2), var(--accent));
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 0 10px rgb(120 200 255 / 0.35));
  }
  .tagline {
    margin: 0;
    color: var(--muted);
  }
  .steps {
    display: grid;
    gap: 10px;
    margin: 0 0 18px;
    padding: 0;
    list-style: none;
  }
  .steps li {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: rgb(255 255 255 / 0.02);
  }
  .steps .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: linear-gradient(135deg, rgb(63 217 255 / 0.25), rgb(179 112 255 / 0.25));
    color: var(--text);
  }
  .steps div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .steps span {
    color: var(--muted);
  }
  .notes {
    display: grid;
    gap: 6px;
    margin: 0 0 20px;
    padding: 0;
    list-style: none;
    font-size: 13px;
    color: var(--muted);
  }
  .notes strong {
    color: var(--text);
  }
  .notes a {
    color: var(--accent-2);
  }
  .warning {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    color: color-mix(in srgb, var(--warning) 70%, var(--text));
  }
  .warning :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .calm {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: var(--text);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
