<script lang="ts">
  import type { Snippet } from 'svelte';
  import { lab, type SpikeId } from '../report.svelte';

  interface Props {
    id: SpikeId;
    title: string;
    question: string;
    criteria: string[];
    children: Snippet;
  }

  let { id, title, question, criteria, children }: Props = $props();
  const result = $derived(lab.results[id]);
  const statusLabel = $derived(
    {
      idle: 'not run',
      running: 'running…',
      done: 'done',
      error: 'error',
      interrupted: 'interrupted by a reload',
    }[result.status],
  );
</script>

<section class="card" data-testid="spike-{id}" data-status={result.status}>
  <header>
    <h2><span class="id">{id}</span> {title}</h2>
    <span class="status {result.status}">{statusLabel}</span>
  </header>
  <p class="question">{question}</p>
  <ul class="criteria">
    {#each criteria as criterion (criterion)}
      <li>{criterion}</li>
    {/each}
  </ul>

  <div class="controls">{@render children()}</div>

  {#if result.error}
    <p class="error" role="alert">{result.error}</p>
  {/if}

  {#if result.checks.length > 0}
    <table class="checks">
      <tbody>
        {#each result.checks as check (check.label)}
          <tr data-state={check.state}>
            <td class="mark">{check.state === 'pass' ? '✔' : check.state === 'fail' ? '✘' : 'ℹ'}</td
            >
            <td>{check.label}</td>
            <td class="detail">{check.detail}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if Object.keys(result.metrics).length > 0}
    <dl class="metrics">
      {#each Object.entries(result.metrics) as [name, value] (name)}
        <dt>{name}</dt>
        <dd>{value}</dd>
      {/each}
    </dl>
  {/if}

  {#if result.log.length > 0}
    <details>
      <summary>Log ({result.log.length} lines)</summary>
      <pre>{result.log.join('\n')}</pre>
    </details>
  {/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 22px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
  }
  .id {
    color: var(--accent);
    font-family: var(--mono);
    margin-right: 6px;
  }
  .status {
    font-size: 13px;
    color: var(--muted);
  }
  .status.running {
    color: var(--accent-2);
  }
  .status.done {
    color: var(--pass);
  }
  .status.error {
    color: var(--fail);
  }
  .status.interrupted {
    color: var(--info);
  }
  .question {
    margin: 8px 0 4px;
  }
  .criteria {
    margin: 0 0 14px;
    padding-left: 20px;
    color: var(--muted);
    font-size: 14px;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .error {
    color: var(--fail);
    margin: 12px 0 0;
  }
  .checks {
    width: 100%;
    margin-top: 14px;
    border-collapse: collapse;
    font-size: 14px;
  }
  .checks td {
    padding: 5px 8px;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  .mark {
    width: 24px;
    text-align: center;
  }
  tr[data-state='pass'] .mark {
    color: var(--pass);
  }
  tr[data-state='fail'] .mark {
    color: var(--fail);
  }
  tr[data-state='info'] .mark {
    color: var(--info);
  }
  .detail {
    color: var(--muted);
  }
  .metrics {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 16px;
    margin: 14px 0 0;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-family: var(--mono);
    font-size: 13px;
  }
  details {
    margin-top: 12px;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 14px;
  }
  pre {
    max-height: 240px;
    overflow: auto;
    background: var(--bg);
    padding: 10px;
    border-radius: 8px;
    white-space: pre-wrap;
  }
</style>
