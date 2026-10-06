<script lang="ts">
  import {
    deleteAnalysis,
    deleteEverything,
    deleteTrackDetails,
    formatBytes,
    summarizeStorage,
    type StorageSummary,
    type StoredPart,
  } from '../core/state/browser-storage';
  import { useExporter } from './exporter-context';
  import { usePlayer } from './player-context';
  import { saveBackup } from './save-backup';

  /**
   * What the app keeps in this browser, and deleting it by kind (UI-12), in the settings: the
   * analysis of old tracks or of all, the details of tracks no longer in the queue, an unfinished
   * export, or everything. Each asks first and offers a backup.
   */
  interface Props {
    /** The settings are open: the sizes are read anew. */
    open: boolean;
  }
  let { open }: Props = $props();

  type Action = 'analysis-unused' | 'analysis-all' | 'tracks' | 'exports' | 'everything';

  const player = usePlayer();
  const app = player.store;
  const exporter = useExporter();
  let summary = $state.raw<StorageSummary | null>(null);
  let pending = $state<Action | null>(null);
  let busy = $state(false);
  let message = $state<{ text: string; error: boolean } | null>(null);
  let confirmation: HTMLElement | undefined = $state();

  // A question asked below the fold comes into view.
  $effect(() => {
    confirmation?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const exporting = $derived($exporter.status === 'running');
  /** The fingerprints of the tracks in the queue: what belongs to them stays. */
  const inQueue = $derived(
    new Set($app.tracks.map((track) => track.fingerprint).filter((print) => print !== null)),
  );

  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const tracks = (n: number) => `${n} track${n === 1 ? '' : 's'}`;
  const part = ({ count, bytes }: StoredPart) => `${tracks(count)}, ${formatBytes(bytes)}`;

  async function refresh() {
    try {
      summary = await summarizeStorage(inQueue);
    } catch (error) {
      message = { text: `What is stored could not be read: ${reason(error)}`, error: true };
    }
  }

  $effect(() => {
    if (!open) {
      pending = null;
      message = null;
      return;
    }
    void refresh();
  });

  function ask(action: Action) {
    pending = action;
    message = null;
  }

  /** What the confirmation says, and the label of its button. */
  const question = $derived.by(() => {
    if (!pending || !summary) return null;
    const { analysis, tracks: details, exports } = summary;
    switch (pending) {
      case 'analysis-unused':
        return {
          text: `Delete the analysis of the ${part(analysis.unused)} not in the queue? When one of them is added again, it is analysed anew, which takes a few seconds.`,
          button: 'Delete it',
        };
      case 'analysis-all':
        return {
          text: `Delete the analysis of all ${part(analysis)}? Each track is analysed anew when it is loaded next; those in the queue keep theirs until the app reloads.`,
          button: 'Delete it all',
        };
      case 'tracks':
        return {
          text: `Delete the cues, markers, tempos, names, colours, looks and covers of the ${part(details.unused)} not in the queue? Only a backup brings them back.`,
          button: 'Delete them',
        };
      case 'exports':
        return {
          text: `Delete the unfinished export and the videos waiting to be saved (${formatBytes(exports.bytes)})? An unfinished export cannot be resumed then.`,
          button: 'Delete them',
        };
      case 'everything':
        return {
          text: 'Delete everything the app keeps in this browser: the settings, your presets, images and controllers, the cues, markers, names, colours and looks of all tracks, their covers and analysis, the queue and any unfinished export. It cannot be undone, except from a backup; your music files stay where they are. The app starts afresh then, as at its first start.',
          button: 'Delete everything and reload',
        };
    }
  });

  async function backUp() {
    busy = true;
    try {
      const analysis = pending === 'analysis-unused' || pending === 'analysis-all';
      message = {
        text: `Saved ${await saveBackup(analysis || pending === 'everything')}.`,
        error: false,
      };
    } catch (error) {
      message = { text: `The backup could not be made: ${reason(error)}`, error: true };
    } finally {
      busy = false;
    }
  }

  async function confirm() {
    const action = pending;
    if (!action) return;
    busy = true;
    try {
      if (action === 'everything') {
        player.pause();
        await deleteEverything();
        location.reload();
        return;
      }
      let done: string;
      if (action === 'exports') {
        const bytes = summary?.exports.bytes ?? 0;
        await exporter.discard();
        done = `Deleted the export's files (${formatBytes(bytes)}).`;
      } else if (action === 'tracks') {
        const gone = await deleteTrackDetails(inQueue);
        done = `Deleted the details of ${part(gone)}.`;
      } else {
        const gone = await deleteAnalysis(inQueue, action === 'analysis-all');
        done = `Deleted the analysis of ${part(gone)}.`;
      }
      pending = null;
      message = { text: done, error: false };
      await refresh();
    } catch (error) {
      message = { text: `Not deleted: ${reason(error)}`, error: true };
    } finally {
      busy = false;
    }
  }
</script>

<div class="storage" data-testid="storage">
  {#if summary}
    <ul class="parts">
      <li data-testid="storage-analysis">
        <div class="what">
          <strong>Track analysis</strong>
          <span class="muted">waveforms and beat grids, made again when needed</span>
        </div>
        <span class="size">{part(summary.analysis)}</span>
        <div class="actions">
          <button
            onclick={() => ask('analysis-unused')}
            disabled={busy || summary.analysis.unused.count === 0}
            data-testid="storage-delete-analysis-unused"
          >
            Not in the queue ({summary.analysis.unused.count})
          </button>
          <button
            onclick={() => ask('analysis-all')}
            disabled={busy || summary.analysis.count === 0}
            data-testid="storage-delete-analysis-all"
          >
            All
          </button>
        </div>
      </li>
      <li data-testid="storage-tracks">
        <div class="what">
          <strong>Track details</strong>
          <span class="muted">cues, markers, tempos, names, colours, looks and covers</span>
        </div>
        <span class="size">{part(summary.tracks)}</span>
        <div class="actions">
          <button
            onclick={() => ask('tracks')}
            disabled={busy || summary.tracks.unused.count === 0}
            data-testid="storage-delete-tracks"
          >
            Not in the queue ({summary.tracks.unused.count})
          </button>
        </div>
      </li>
      <li data-testid="storage-exports">
        <div class="what">
          <strong>Exports</strong>
          <span class="muted">an unfinished export, videos waiting to be saved</span>
        </div>
        <span class="size"
          >{summary.exports.count > 0 ? formatBytes(summary.exports.bytes) : 'none'}</span
        >
        <div class="actions">
          <button
            onclick={() => ask('exports')}
            disabled={busy || exporting || summary.exports.count === 0}
            title={exporting ? 'Not while an export runs' : undefined}
            data-testid="storage-delete-exports"
          >
            Delete
          </button>
        </div>
      </li>
      <li data-testid="storage-rest">
        <div class="what">
          <strong>Settings, presets, images and controllers</strong>
          <span class="muted">changed where they are set; they go only with everything</span>
        </div>
        <span class="size">{formatBytes(summary.rest.bytes)}</span>
      </li>
    </ul>
    {#if summary.total !== null}
      <p class="muted small" data-testid="storage-total">
        In all, the browser counts {formatBytes(summary.total)} for the app, with what it needs for its
        own bookkeeping.
      </p>
    {/if}
    <div class="everything">
      <button
        class="danger"
        onclick={() => ask('everything')}
        disabled={busy || exporting}
        title={exporting ? 'Not while an export runs' : undefined}
        data-testid="storage-delete-everything"
      >
        Delete everything…
      </button>
    </div>
  {/if}

  {#if question}
    <div
      bind:this={confirmation}
      class="confirm"
      class:warning={pending === 'everything'}
      role="alertdialog"
      aria-label="Delete"
      data-testid="storage-confirm"
    >
      <p>{question.text}</p>
      <div class="actions">
        {#if pending !== 'exports'}
          <button onclick={backUp} disabled={busy} data-testid="storage-backup">
            Save a backup first
          </button>
        {/if}
        <button
          class="danger"
          onclick={confirm}
          disabled={busy}
          data-testid="storage-confirm-delete"
        >
          {question.button}
        </button>
        <button onclick={() => (pending = null)} disabled={busy}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if message}
    <p class="message" class:error={message.error} role="status" data-testid="storage-message">
      {message.text}
    </p>
  {/if}
</div>

<style>
  .storage {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .parts {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .parts li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .what {
    display: flex;
    flex-direction: column;
  }
  .size {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    text-align: right;
  }
  .parts .actions {
    grid-column: 1 / -1;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .small {
    font-size: 13px;
  }
  .danger {
    border-color: var(--fail);
    color: var(--fail);
  }
  .confirm {
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--surface-2);
  }
  .confirm.warning {
    border-color: var(--fail);
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
