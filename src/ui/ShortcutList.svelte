<script lang="ts">
  import { SHORTCUTS } from './shortcuts';

  /** The keyboard shortcuts (UI-04), grouped, as the help shows them. */
</script>

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

<style>
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
