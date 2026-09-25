<script lang="ts">
  import { onMount } from 'svelte';
  import { probeCapabilities } from '../../core/env/capabilities';
  import { formatBytes } from '../../core/util/format';
  import { lab } from '../report.svelte';

  let error = $state<string | null>(null);

  onMount(() => {
    probeCapabilities()
      .then((report) => {
        lab.env = report;
      })
      .catch((e: unknown) => {
        error = String(e);
      });
  });

  const env = $derived(lab.env);
  const yesNo = (value: boolean) => (value ? 'yes' : 'no');
</script>

<section class="panel" data-testid="env-panel" data-ready={env !== null}>
  <h2>Environment</h2>
  {#if error}
    <p class="bad">{error}</p>
  {:else if !env}
    <p class="muted">Probing browser features…</p>
  {:else}
    <dl>
      <dt>Browser</dt>
      <dd>{env.userAgent}</dd>
      <dt>Machine</dt>
      <dd>
        {env.platform} · {env.cpuThreads} threads · {env.deviceMemoryGb ?? '?'} GB RAM (reported)
      </dd>
      <dt>Cross-origin isolated</dt>
      <dd class:bad={!env.crossOriginIsolated} data-testid="isolated">
        {yesNo(env.crossOriginIsolated)}
      </dd>
      <dt>WebGL2</dt>
      <dd class:bad={!env.webgl2.colorBufferFloat}>
        {env.webgl2.renderer} · float targets {yesNo(env.webgl2.colorBufferFloat)} · max texture
        {env.webgl2.maxTextureSize}
      </dd>
      <dt>Storage</dt>
      <dd>
        OPFS {yesNo(env.opfs)} · save dialog {yesNo(env.fileSystemAccess)} · quota
        {formatBytes(env.storageQuotaBytes ?? NaN)}
      </dd>
      <dt>Other</dt>
      <dd>
        WebGPU {yesNo(env.webgpu)} · wake lock {yesNo(env.wakeLock)} · memory measurement
        {yesNo(env.measureMemory)}
      </dd>
    </dl>
    <table>
      <thead>
        <tr><th>Encoder</th><th>Supported</th><th>Hardware</th></tr>
      </thead>
      <tbody>
        {#each [...env.videoEncoders, ...env.audioEncoders] as encoder (encoder.label)}
          <tr>
            <td>{encoder.label}</td>
            <td class:bad={!encoder.supported}>{yesNo(encoder.supported)}</td>
            <td>{encoder.hardware === null ? '–' : yesNo(encoder.hardware)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 22px;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 19px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 0 0 14px;
    font-size: 14px;
  }
  dt,
  .muted {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  table {
    border-collapse: collapse;
    font-size: 14px;
  }
  th,
  td {
    text-align: left;
    padding: 4px 14px 4px 0;
    border-top: 1px solid var(--border);
  }
  th {
    color: var(--muted);
    font-weight: 500;
  }
  .bad {
    color: var(--fail);
  }
</style>
