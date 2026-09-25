<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A collapsible group of controls. */
  interface Props {
    title: string;
    open?: boolean;
    children: Snippet;
  }
  let { title, open = false, children }: Props = $props();
</script>

<details {open}>
  <summary>{title}</summary>
  <div class="content">
    {@render children()}
  </div>
</details>

<style>
  details {
    border-bottom: 1px solid var(--border);
  }
  summary {
    padding: 12px 16px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
  }
  summary:hover {
    color: var(--accent-2);
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 16px 14px;
  }
</style>
