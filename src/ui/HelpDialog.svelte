<script lang="ts">
  import changelog from '../../CHANGELOG.md?raw';
  import guide from '../../docs/USER-GUIDE.md?raw';
  import privacy from '../../PRIVACY.md?raw';
  import { bugReportLink, BUG_EMAIL } from './app-info';
  import AboutInfo from './AboutInfo.svelte';
  import { backdropClose } from './backdrop';
  import Icon from './Icon.svelte';
  import LicencesList from './LicencesList.svelte';
  import { guideSections, renderDocument, renderMarkdown } from './markdown';
  import { usePlayer } from './player-context';
  import ShortcutList from './ShortcutList.svelte';
  import SystemCheck from './SystemCheck.svelte';

  /**
   * The help (UI-11): the user guide (docs/USER-GUIDE.md, the same text as on GitHub) by
   * section, with the full list of keyboard shortcuts (UI-04) as one of them; what to do when
   * something goes wrong, with the system check; and about the app: its version, what changed,
   * the licences of the parts of others, and what it does with data. It only explains: settings
   * are in the settings, the side panel and the dialogs. "?" opens it on the shortcuts, the ? in
   * the top bar where it was left.
   */
  interface Props {
    open: boolean;
    /** The section shown: a section's id. */
    section: string;
    onclose: () => void;
    /** Shows the welcome again. */
    onwelcome: () => void;
    /** Opens the settings (where backups are made). */
    onsettings: () => void;
  }
  let { open, section = $bindable(), onclose, onwelcome, onsettings }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  const START_ID = 'getting-started';
  const SHORTCUTS_ID = 'keyboard-shortcuts';
  const ABOUT_ID = 'about';
  const BACKUP_ID = 'backup';
  const TROUBLE_ID = 'when-something-goes-wrong';
  const NEW_ID = 'whats-new';
  const LICENCES_ID = 'licences';
  const PRIVACY_ID = 'privacy';
  const sections = [
    ...guideSections(guide).map((entry) => ({ ...entry, html: renderMarkdown(entry.markdown) })),
    // Not in the guide: what changed (CHANGELOG.md), the parts of others (from the build), and
    // what the app does with data (PRIVACY.md).
    { id: NEW_ID, title: "What's new", markdown: '', html: renderDocument(changelog) },
    { id: LICENCES_ID, title: 'Licences', markdown: '', html: '' },
    { id: PRIVACY_ID, title: 'Privacy', markdown: '', html: renderDocument(privacy) },
  ];
  /** The sections in groups: how to use the app, what to do when it fails, and about it. */
  const GROUPS = [
    { name: 'Guide', ids: null },
    { name: 'Troubleshooting', ids: [TROUBLE_ID] },
    { name: 'About', ids: [ABOUT_ID, NEW_ID, LICENCES_ID, PRIVACY_ID] },
  ];
  const grouped = GROUPS.map(({ name, ids }) => ({
    name,
    entries: sections.filter((entry) =>
      ids ? ids.includes(entry.id) : !GROUPS.some((group) => group.ids?.includes(entry.id)),
    ),
  }));
  const current = $derived(sections.find((entry) => entry.id === section) ?? sections[0]!);

  let dialog: HTMLDialogElement | undefined = $state();
  const backdrop = backdropClose(() => onclose());
  let content: HTMLElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  // A new section starts at its top.
  $effect(() => {
    void current;
    if (content) content.scrollTop = 0;
  });

  function welcome() {
    onclose();
    onwelcome();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="help-title" {onclose} {...backdrop} data-testid="help">
  <header>
    <h2 id="help-title">Help</h2>
    <button class="close" onclick={onclose} aria-label="Close">
      <Icon name="close" size={18} />
    </button>
  </header>
  <div class="body">
    <nav aria-label="Help sections">
      {#each grouped as group (group.name)}
        <p class="group">{group.name}</p>
        {#each group.entries as entry (entry.id)}
          <button
            class:on={entry.id === current.id}
            aria-current={entry.id === current.id ? 'page' : undefined}
            onclick={() => (section = entry.id)}
            data-testid="help-nav-{entry.id}"
          >
            {entry.title}
          </button>
        {/each}
      {/each}
    </nav>
    <article bind:this={content} data-testid="help-content" data-section={current.id}>
      <h3 class="title">{current.title}</h3>
      {#if current.id === ABOUT_ID}
        <AboutInfo />
      {/if}
      {#if current.id === SHORTCUTS_ID}
        <ShortcutList />
      {:else if current.id === LICENCES_ID}
        <LicencesList />
      {:else}
        <!-- The guide is our own text, rendered with everything else escaped. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="guide">{@html current.html}</div>
      {/if}
      {#if current.id === START_ID}
        <div class="actions">
          <button onclick={welcome} data-testid="help-welcome">Show the welcome again</button>
        </div>
      {/if}
      {#if current.id === BACKUP_ID}
        <div class="actions">
          <button
            onclick={() => {
              onclose();
              onsettings();
            }}
            data-testid="help-settings">Open the settings</button
          >
        </div>
      {/if}
      {#if current.id === TROUBLE_ID}
        <SystemCheck />
      {/if}
      {#if current.id === ABOUT_ID}
        <div class="actions">
          <a class="button" href={bugReportLink($app.settings.appName)} data-testid="help-bug"
            >Report a bug to {BUG_EMAIL}</a
          >
          <button onclick={() => (section = NEW_ID)} data-testid="help-whats-new">What's new</button
          >
          <button onclick={() => (section = LICENCES_ID)} data-testid="help-licences"
            >Licences</button
          >
          <button onclick={() => (section = PRIVACY_ID)} data-testid="help-privacy">Privacy</button>
        </div>
      {/if}
    </article>
  </div>
</dialog>

<style>
  dialog {
    width: min(920px, 94vw);
    height: min(680px, 90vh);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: rgb(5 5 10 / 0.7);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px 12px 24px;
    border-bottom: 1px solid var(--border);
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
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 220px;
    flex: none;
    padding: 12px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .group {
    margin: 12px 10px 4px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .group:first-child {
    margin-top: 0;
  }
  nav button {
    padding: 7px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    text-align: left;
  }
  nav button:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  nav button.on {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  article {
    flex: 1;
    min-width: 0;
    padding: 18px 28px 28px;
    overflow-y: auto;
    line-height: 1.55;
  }
  .title {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .guide :global(p),
  .guide :global(ul),
  .guide :global(ol) {
    margin: 0 0 12px;
    color: color-mix(in srgb, var(--text) 85%, var(--muted));
  }
  .guide :global(ul),
  .guide :global(ol) {
    padding-left: 20px;
  }
  .guide :global(li + li) {
    margin-top: 6px;
  }
  .guide :global(strong) {
    color: var(--text);
  }
  .guide :global(h3) {
    margin: 18px 0 8px;
    font-size: 15px;
  }
  .guide :global(a) {
    color: var(--accent-2);
  }
  .guide :global(code) {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-2);
    font: 12px var(--mono);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .button {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
    text-decoration: none;
  }
  .button:hover {
    background: var(--surface-2);
  }
</style>
