<script lang="ts">
  import {
    backupFileName,
    createBackup,
    describeBackup,
    parseBackup,
    restoreBackup,
    summarizeBackup,
    type Backup,
    type BackupSummary,
  } from '../core/state/backup';
  import Icon from './Icon.svelte';
  import { usePlayer } from './player-context';

  /**
   * Saving and restoring a backup of everything the app keeps in this browser (UI-06), in the
   * settings. A backup restored replaces it all; the app reloads then.
   */
  const player = usePlayer();
  const app = player.store;
  let analysis = $state(false);
  let busy = $state(false);
  let message = $state<{ text: string; error: boolean } | null>(null);
  /** A backup picked to restore, waiting for the go-ahead. */
  let picked = $state.raw<{ backup: Backup; summary: BackupSummary; name: string } | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

  async function save() {
    busy = true;
    message = null;
    picked = null;
    try {
      const backup = await createBackup({ analysis });
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName($app.settings.appName, new Date());
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message = { text: `Saved ${describeBackup(summarizeBackup(backup))}.`, error: false };
    } catch (error) {
      message = { text: `The backup could not be made: ${reason(error)}`, error: true };
    } finally {
      busy = false;
    }
  }

  async function pick(file: File) {
    message = null;
    picked = null;
    try {
      const backup = parseBackup(await file.text());
      picked = { backup, summary: summarizeBackup(backup), name: file.name };
    } catch (error) {
      message = { text: reason(error), error: true };
    }
  }

  async function restore() {
    if (!picked) return;
    busy = true;
    try {
      player.pause();
      await restoreBackup(picked.backup);
      location.reload();
    } catch (error) {
      busy = false;
      message = { text: `The backup could not be restored: ${reason(error)}`, error: true };
    }
  }

  function made(date: Date | null): string {
    return date
      ? ` made ${date.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`
      : '';
  }
</script>

<div class="backup" data-testid="backup">
  <label class="check">
    <input type="checkbox" bind:checked={analysis} disabled={busy} data-testid="backup-analysis" />
    With the track analysis: a larger file, but no track needs to be analysed again
  </label>
  <div class="actions">
    <button onclick={save} disabled={busy} data-testid="backup-save">
      <Icon name="export" size={16} /> Save a backup
    </button>
    <button onclick={() => input?.click()} disabled={busy} data-testid="backup-open">
      <Icon name="import" size={16} /> Restore a backup…
    </button>
    <input
      bind:this={input}
      type="file"
      accept=".json,application/json"
      hidden
      data-testid="backup-input"
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void pick(file);
      }}
    />
  </div>
  {#if picked}
    <div class="confirm" role="group" aria-label="Restore the backup" data-testid="backup-confirm">
      <p>
        <strong>{picked.name}</strong>: a backup{made(picked.summary.created)}, with {describeBackup(
          picked.summary,
        )}.
      </p>
      <p>
        Restoring it replaces everything the app keeps in this browser, then the app reloads. The
        queue stays as it is{picked.summary.analysis === null
          ? ', and so does the analysis of the tracks'
          : ''}.
      </p>
      <div class="actions">
        <button class="primary" onclick={restore} disabled={busy} data-testid="backup-restore">
          Restore and reload
        </button>
        <button onclick={() => (picked = null)} disabled={busy}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if message}
    <p class="message" class:error={message.error} role="status" data-testid="backup-message">
      {message.text}
    </p>
  {/if}
</div>

<style>
  .backup {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .confirm {
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--surface-2);
  }
  .confirm p {
    margin: 0 0 10px;
  }
  .message {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
  .message.error {
    color: var(--fail);
  }
</style>
