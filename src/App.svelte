<script lang="ts">
  import { onMount } from 'svelte';
  import { missingRequirements } from './core/env/requirements';
  import SpikeLab from './spikes/SpikeLab.svelte';
  import AppShell from './ui/AppShell.svelte';
  import Unsupported from './ui/Unsupported.svelte';

  /** What this browser lacks of what the app cannot run without (NF-02). */
  const missing = missingRequirements();

  let route = $state(location.hash);

  onMount(() => {
    const update = () => (route = location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  });
</script>

{#if route === '#/lab'}
  <SpikeLab />
{:else if missing.length > 0}
  <Unsupported {missing} />
{:else}
  <AppShell />
{/if}
