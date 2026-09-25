<script lang="ts">
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  interface Props {
    onFullscreen: () => void;
  }
  let { onFullscreen }: Props = $props();

  const player = usePlayer();
  const app = player.store;
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
    <span>Vibe Visualizer</span>
  </div>
  <nav>
    <button
      class="toggle"
      class:on={$app.settings.analysisView}
      onclick={() => player.updateSettings({ analysisView: !$app.settings.analysisView })}
      aria-pressed={$app.settings.analysisView}
      title="Analysis view"
    >
      <Icon name="wave" size={18} /> Analysis
    </button>
    <button class="toggle" onclick={onFullscreen} title="Fullscreen (F)">
      <Icon name="fullscreen" size={18} />
    </button>
    <button
      class="toggle"
      class:on={$app.settings.panelOpen}
      onclick={() => player.updateSettings({ panelOpen: !$app.settings.panelOpen })}
      aria-pressed={$app.settings.panelOpen}
      title="Queue panel"
    >
      <Icon name="panel" size={18} />
    </button>
    <a class="lab" href="#/lab">Spike Lab</a>
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
  nav {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .lab {
    margin-left: 8px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
