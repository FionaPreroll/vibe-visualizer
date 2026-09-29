<script lang="ts">
  import Icon from './Icon.svelte';
  import { SHORTCUTS } from './shortcuts';

  /** The keyboard shortcuts at a glance (UI-04); "?" opens it. */
  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="shortcuts-title"
  {onclose}
  onclick={(event) => event.target === dialog && onclose()}
  data-testid="shortcut-help"
>
  <header>
    <h2 id="shortcuts-title">Keyboard shortcuts</h2>
    <button class="close" onclick={onclose} aria-label="Close">
      <Icon name="close" size={18} />
    </button>
  </header>
  <div class="groups">
    {#each SHORTCUTS as group (group.title)}
      <section>
        <h3>{group.title}</h3>
        <dl>
          {#each group.keys as [keys, action] (action)}
            <dt>
              {#each keys as combination (combination)}
                <span class="combination">
                  {#each combination.split(' + ') as key, index (index)}
                    {#if index > 0}<span class="joint">+</span>{/if}
                    <kbd>{key}</kbd>
                  {/each}
                </span>
              {/each}
            </dt>
            <dd>{action}</dd>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    width: min(760px, 94vw);
    max-height: 90vh;
    padding: 20px 24px 24px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgba(5, 5, 10, 0.7);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .close {
    padding: 4px;
    background: transparent;
    border-color: transparent;
  }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 8px 32px;
  }
  h3 {
    margin: 12px 0 6px;
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 14px;
    margin: 0;
    align-items: center;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .combination {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  dd {
    margin: 0;
    font-size: 14px;
  }
  kbd {
    min-width: 22px;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface-2);
    font: 12px var(--mono);
    text-align: center;
  }
  .joint {
    color: var(--muted);
    font-size: 12px;
  }
</style>
