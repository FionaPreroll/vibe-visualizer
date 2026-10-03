<script lang="ts">
  import type { Requirement } from '../core/env/requirements';

  /**
   * Shown instead of the app when this browser lacks a feature the app cannot run without
   * (NF-02): which ones, and what to do.
   */
  let { missing }: { missing: Requirement[] } = $props();
  const graphics = $derived(missing.some((requirement) => requirement.feature === 'WebGL 2'));
</script>

<main class="unsupported" data-testid="unsupported">
  <div class="card">
    <h1>FibeStation cannot run in this browser</h1>
    <p>It needs these, which this browser does not offer:</p>
    <ul>
      {#each missing as requirement (requirement.feature)}
        <li><strong>{requirement.feature}</strong>: {requirement.use}.</li>
      {/each}
    </ul>
    <p>Please open it in a current Chrome, Edge or Firefox on a computer.</p>
    {#if graphics}
      <p>
        If this is one already, turn on graphics acceleration (hardware acceleration) in the
        browser's settings, then reload the page.
      </p>
    {/if}
  </div>
</main>

<style>
  .unsupported {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--bg);
  }
  .card {
    max-width: 560px;
    padding: 24px 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  h1 {
    margin: 0 0 12px;
    font-size: 20px;
  }
  p,
  li {
    color: var(--muted);
    line-height: 1.5;
  }
  strong {
    color: var(--text);
  }
</style>
