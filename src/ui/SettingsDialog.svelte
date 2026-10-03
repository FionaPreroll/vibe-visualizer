<script lang="ts">
  import { APP_NAME_LENGTH, DEFAULT_APP_NAME } from '../core/state/app-state';
  import { backdropClose } from './backdrop';
  import BackupSection from './BackupSection.svelte';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * The settings of the app as a whole, and what it keeps: its name, and the backup (UI-06). The
   * settings of the music and the visuals are in the side panel; how all of it works is in the
   * help, which the dialog opens.
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

  function rename(value: string) {
    const name = value.trim().slice(0, APP_NAME_LENGTH);
    player.updateSettings({ appName: name || DEFAULT_APP_NAME });
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

    <section aria-labelledby="settings-app">
      <h3 id="settings-app">App</h3>
      <label class="field">
        <span>Name of the app</span>
        <input
          value={$app.settings.appName}
          maxlength={APP_NAME_LENGTH}
          onchange={(event) => rename(event.currentTarget.value)}
          data-testid="settings-app-name"
        />
      </label>
      <p class="muted small">
        In the top bar and the window's title, in the default logo, and in the names of backups. A
        double-click on the name in the top bar renames it too.
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
