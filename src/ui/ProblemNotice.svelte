<script lang="ts">
  import { bugReportLink } from './app-info';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import { problem } from './problems';

  /**
   * An error nobody handled (NF-10): what it says, its details to copy, and a bug report
   * with them.
   */
  const app = usePlayer().store;
  let copied = $state(false);

  async function copy(details: string) {
    try {
      await navigator.clipboard.writeText(details);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // No clipboard: the report link carries the details too.
    }
  }
</script>

{#if $problem}
  <div class="problem" role="alert" data-testid="problem">
    <Icon name="alert" size={18} />
    <span class="message">
      Something went wrong{$problem.count > 1 ? ` (${$problem.count} times)` : ''}: {$problem.message}
    </span>
    <button onclick={() => copy($problem.details)} data-testid="problem-copy">
      {copied ? 'Copied' : 'Copy details'}
    </button>
    <a href={bugReportLink($app.settings.appName, $problem.details)} data-testid="problem-report"
      >Report…</a
    >
    <button class="close" onclick={() => problem.set(null)} aria-label="Dismiss">
      <Icon name="close" size={16} />
    </button>
  </div>
{/if}

<style>
  .problem {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(90vw, 720px);
    padding: 8px 8px 8px 14px;
    border: 1px solid var(--fail);
    border-radius: 10px;
    background: color-mix(in srgb, var(--fail) 22%, var(--surface));
    font-size: 14px;
  }
  .message {
    overflow-wrap: anywhere;
  }
  button,
  a {
    flex: none;
    padding: 4px 10px;
    white-space: nowrap;
  }
  .close {
    display: grid;
    place-items: center;
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
</style>
