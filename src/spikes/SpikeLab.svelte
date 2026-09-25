<script lang="ts">
  import { buildMarkdownReport } from './report-markdown';
  import { lab } from './report.svelte';
  import S1Streaming from './s1-streaming/S1Streaming.svelte';
  import S2KeyLock from './s2-keylock/S2KeyLock.svelte';
  import S3Encoding from './s3-encoding/S3Encoding.svelte';
  import S4Rendering from './s4-rendering/S4Rendering.svelte';
  import S5LongRender from './s5-long-render/S5LongRender.svelte';
  import EnvPanel from './ui/EnvPanel.svelte';

  let copied = $state(false);

  // Persist every change, so results survive a reload.
  $effect(() => {
    lab.save();
  });

  async function copyReport() {
    const report = buildMarkdownReport();
    try {
      await navigator.clipboard.writeText(report);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }));
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: 'spike-lab-report.md',
      });
      link.click();
      URL.revokeObjectURL(url);
    }
  }
</script>

<main>
  <header>
    <div>
      <h1>Vibe Visualizer <span>Spike Lab</span></h1>
      <p>
        Phase P0: small prototypes that test the risky parts on this machine before we build the
        app. Run the spikes, then copy the report and paste it into the chat.
      </p>
    </div>
    <div class="actions">
      <button class="primary" onclick={copyReport} data-testid="copy-report">
        {copied ? 'Copied ✔' : 'Copy report'}
      </button>
      <button onclick={() => lab.clear()} data-testid="clear-results">Clear results</button>
    </div>
  </header>

  <EnvPanel />
  <S1Streaming />
  <S2KeyLock />
  <S3Encoding />
  <S4Rendering />
  <S5LongRender />
</main>

<style>
  main {
    max-width: 980px;
    margin: 0 auto;
    padding: 32px 16px 64px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
  }
  h1 span {
    color: var(--accent);
    font-weight: 500;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  header p {
    margin: 6px 0 0;
    color: var(--muted);
    max-width: 640px;
  }
</style>
