<script lang="ts">
  import { APP_NAME } from '../core/state/app-state';
  import { onMount } from 'svelte';

  /**
   * The parts of others in the app, with their licences (About → Licences): the list the build
   * makes (vite-plugins/third-party-notices.ts), with each licence text to open, and all of it as
   * licenses.txt.
   */
  interface Notice {
    name: string;
    version: string;
    license: string;
    url: string | null;
    note?: string;
    texts: { file: string; text: string }[];
  }

  let notices: Notice[] | null = $state(null);
  let failed = $state(false);

  onMount(() => {
    void (async () => {
      try {
        const response = await fetch('/licenses.json');
        if (!response.ok) throw new Error(String(response.status));
        notices = (await response.json()) as Notice[];
      } catch {
        failed = true;
      }
    })();
  });

  /** A note in its paragraphs, with its web addresses as links. */
  function pieces(paragraph: string): { text: string; href?: string }[] {
    return paragraph
      .split(/(https:\/\/[^\s,;)]+[^\s,;).])/)
      .filter((part) => part !== '')
      .map((part) => (part.startsWith('https://') ? { text: part, href: part } : { text: part }));
  }
</script>

<div class="licences" data-testid="licences">
  <p>
    {APP_NAME} contains these parts of others. Each keeps its own licence: its text opens below it, and
    all of them are in <a href="/licenses.txt" target="_blank">licenses.txt</a>.
  </p>
  {#if failed}
    <p class="muted">The list comes with the built app; it is not there in development.</p>
  {:else if notices === null}
    <p class="muted">Loading…</p>
  {:else}
    <ul>
      {#each notices as notice (notice.name)}
        <li data-testid="licence" data-name={notice.name}>
          <div class="head">
            <strong>{notice.name}</strong>
            {#if notice.version}<span class="version">{notice.version}</span>{/if}
            <span class="license">{notice.license}</span>
            {#if notice.url}
              <a href={notice.url} target="_blank" rel="noreferrer">Source</a>
            {/if}
          </div>
          {#if notice.note}
            {#each notice.note.split('\n\n') as paragraph, index (index)}
              <p class="note">
                {#each pieces(paragraph) as piece, at (at)}
                  {#if piece.href}<a href={piece.href} target="_blank" rel="noreferrer"
                      >{piece.text}</a
                    >{:else}{piece.text}{/if}
                {/each}
              </p>
            {/each}
          {/if}
          {#each notice.texts as text (text.file)}
            <details>
              <summary>{text.file}</summary>
              <pre>{text.text}</pre>
            </details>
          {/each}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .licences > p {
    margin: 0 0 12px;
    color: color-mix(in srgb, var(--text) 85%, var(--muted));
  }
  .muted {
    color: var(--muted);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }
  .version,
  .license {
    color: var(--muted);
    font-size: 13px;
  }
  .license {
    font-family: var(--mono);
  }
  .head a {
    margin-left: auto;
    font-size: 13px;
  }
  a {
    color: var(--accent-2);
  }
  .note {
    margin: 8px 0 0;
    font-size: 13px;
    color: color-mix(in srgb, var(--text) 85%, var(--muted));
    overflow-wrap: anywhere;
  }
  details {
    margin-top: 6px;
    font-size: 13px;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
  }
  pre {
    max-height: 320px;
    margin: 6px 0 0;
    padding: 10px;
    overflow: auto;
    border-radius: 8px;
    background: var(--surface);
    font: 12px/1.45 var(--mono);
    white-space: pre-wrap;
  }
</style>
