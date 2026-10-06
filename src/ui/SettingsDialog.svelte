<script lang="ts">
  import { APP_NAME, LOGO_TEXT_LENGTH } from '../core/state/app-state';
  import { backdropClose } from './backdrop';
  import BackupSection from './BackupSection.svelte';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';
  import StorageSection from './StorageSection.svelte';

  /**
   * The settings of the app as a whole, and what it keeps: the lettering of the default logo, the
   * backup (UI-06) and what is stored in the browser (UI-12). The settings of the music and the
   * visuals are in the side panel; how all of it works is in the help, which the dialog opens.
   */
  interface Props {
    open: boolean;
    onclose: () => void;
    /** Opens the help at `section`. */
    onhelp: (section: string) => void;
  }
  let { open, onclose, onhelp }: Props = $props();

  const player = usePlayer();
  const app = player.store;
  let dialog: HTMLDialogElement | undefined = $state();
  const backdrop = backdropClose(() => onclose());

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function setLettering(value: string) {
    const text = value.trim().slice(0, LOGO_TEXT_LENGTH);
    player.updateSettings({ logoText: text || APP_NAME });
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="settings-title"
  {onclose}
  {...backdrop}
  data-testid="settings"
>
  <header>
    <h2 id="settings-title">Settings</h2>
    <button class="close" onclick={onclose} aria-label="Close">
      <Icon name="close" size={18} />
    </button>
  </header>
  <div class="body">
    <p class="muted">
      The app as a whole, and what it keeps. The music and the visuals are set up in the side panel.
    </p>

    <section aria-labelledby="settings-logo">
      <h3 id="settings-logo">Default logo</h3>
      <label class="field">
        <span>Lettering in the ring</span>
        <input
          value={$app.settings.logoText}
          maxlength={LOGO_TEXT_LENGTH}
          onchange={(event) => setLettering(event.currentTarget.value)}
          data-testid="settings-logo-text"
        />
      </label>
      <p class="muted small">
        The text of the default logo in the middle of the ring (when no logo image of your own is
        set), and in the top bar; a double-click on it there changes it too. Nothing typed: {APP_NAME},
        the name of the app, which the window's title, About and the notices always show.
      </p>
    </section>

    <section aria-labelledby="settings-backup">
      <h3 id="settings-backup">Backup</h3>
      <p class="muted small">
        Everything the app keeps in this browser, in one file: to move it to another browser or
        computer, or to keep it safe.
        <button class="link" onclick={() => onhelp('backup')} data-testid="settings-backup-help"
          >What is in it?</button
        >
      </p>
      <BackupSection />
    </section>

    <section aria-labelledby="settings-storage">
      <h3 id="settings-storage">Stored in this browser</h3>
      <p class="muted small">
        What the app keeps here, and deleting it: the analysis of tracks played long ago, the
        details of tracks no longer in the queue, or everything.
        <button
          class="link"
          onclick={() => onhelp('stored-in-this-browser')}
          data-testid="settings-storage-help">What goes?</button
        >
      </p>
      <StorageSection {open} />
    </section>
  </div>
</dialog>

<style>
  dialog {
    width: min(620px, 94vw);
    max-height: 90vh;
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
    padding: 16px 24px 24px;
    overflow-y: auto;
    line-height: 1.5;
  }
  .muted {
    margin: 0 0 12px;
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
  section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 10px;
    font-size: 15px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
    font-size: 14px;
  }
  .field input {
    max-width: 320px;
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-2);
    font-size: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
