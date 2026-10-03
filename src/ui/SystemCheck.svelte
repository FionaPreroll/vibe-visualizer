<script lang="ts">
  import { onMount } from 'svelte';
  import { probeCapabilities, type CapabilityReport } from '../core/env/capabilities';
  import { capabilityRows, capabilityText } from '../core/env/capability-report';
  import { usePlayer } from './player-context';

  /**
   * The system check in the help (NF-10): what this browser offers the app (graphics, the
   * encoders, storage), to copy into a bug report. It looks when it is shown.
   */
  const app = usePlayer().store;
  let report = $state.raw<CapabilityReport | null>(null);
  let copied = $state(false);

  onMount(() => {
    void probeCapabilities().then((result) => (report = result));
  });

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(capabilityText(report, $app.settings.appName));
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // No clipboard: the rows can be selected and copied by hand.
    }
  }
</script>

<section class="check" data-testid="system-check">
  <h4>System check</h4>
  {#if report}
    <dl>
      {#each capabilityRows(report) as row (row.label)}
        <dt>{row.label}</dt>
        <dd>{row.value}</dd>
      {/each}
    </dl>
    <button onclick={copy} data-testid="system-check-copy">
      {copied ? 'Copied' : 'Copy the report'}
    </button>
  {:else}
    <p>Looking at this browser…</p>
  {/if}
</section>

<style>
  .check {
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
  }
  h4 {
    margin: 0 0 8px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 14px;
    margin: 0 0 12px;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
