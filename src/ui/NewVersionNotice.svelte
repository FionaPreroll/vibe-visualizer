<script lang="ts">
  import { onMount } from 'svelte';
  import { newerBuild } from '../core/env/version';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * Says when a newer build of the app is out (NF-09). It looks when the tab comes into view
   * again, and every half hour while it stays in view; a reload takes the new build.
   */
  const CHECK_MS = 30 * 60_000;
  /** Not more often than this, however often the tab is shown. */
  const QUIET_MS = 5 * 60_000;
  const app = usePlayer().store;
  let newer = $state(false);
  let dismissed = $state(false);
  let checked = -Infinity;

  async function check() {
    if (newer || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - checked < QUIET_MS) return;
    checked = now;
    newer = (await newerBuild()) === true;
  }

  onMount(() => {
    const onVisibility = () => void check();
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(onVisibility, CHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
    };
  });
</script>

{#if newer && !dismissed}
  <div class="update" role="status" data-testid="new-version">
    <span>A new version of {$app.settings.appName} is out.</span>
    <button onclick={() => location.reload()}>Reload</button>
    <button class="close" onclick={() => (dismissed = true)} aria-label="Dismiss">
      <Icon name="close" size={16} />
    </button>
  </div>
{/if}

<style>
  .update {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--surface);
    font-size: 14px;
    white-space: nowrap;
  }
  button {
    padding: 4px 12px;
    border-color: var(--accent);
    color: var(--accent);
    background: transparent;
  }
  .close {
    display: grid;
    place-items: center;
    padding: 4px;
    border-color: transparent;
    color: inherit;
  }
</style>
