<script lang="ts">
  import { onMount } from 'svelte';
  import SpikeLab from './spikes/SpikeLab.svelte';
  import AppShell from './ui/AppShell.svelte';

  let route = $state(location.hash);

  onMount(() => {
    const update = () => (route = location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  });
</script>

{#if route === '#/lab'}
  <SpikeLab />
{:else}
  <AppShell />
{/if}
