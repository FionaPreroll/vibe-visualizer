<script lang="ts">
  import type { Snippet } from 'svelte';
  import { errorMessage } from '../core/util/format';
  import { reportProblem } from './problems';

  /**
   * Keeps an error in a part of the app (`where`) in that part (NF-10): it shows the error and
   * can be tried again, while the rest of the app goes on. The error is reported too.
   */
  let { where, children }: { where: string; children: Snippet } = $props();
</script>

<svelte:boundary onerror={(error) => reportProblem(error, where)}>
  {@render children()}

  {#snippet failed(error, reset)}
    <div class="failed" role="alert" data-testid="part-failed">
      <span>{where} failed: {errorMessage(error)}</span>
      <button onclick={reset}>Try again</button>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .failed {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px;
    padding: 10px 12px;
    border: 1px solid var(--fail);
    border-radius: 10px;
    background: color-mix(in srgb, var(--fail) 22%, var(--surface));
    font-size: 14px;
  }
</style>
