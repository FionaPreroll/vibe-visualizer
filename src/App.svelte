<script lang="ts">
  import { missingRequirements } from './core/env/requirements';
  import AppShell from './ui/AppShell.svelte';
  import Unsupported from './ui/Unsupported.svelte';

  /** What this browser lacks of what the app cannot run without (NF-02). */
  const missing = missingRequirements();
</script>

{#if missing.length > 0}
  <Unsupported {missing} />
{:else}
  <AppShell />
{/if}
