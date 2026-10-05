import type { ExportState } from '../core/export/exporter';

/** How an export ended that the user has not seen yet: the tab was in the background. */
export type UnseenOutcome = 'done' | 'failed' | null;

/**
 * The window title: the app's name, and before it what an export is doing, so that it shows in
 * the tab while the user works elsewhere: its progress while it runs (and which video of a
 * batch), and how it ended until the tab is looked at again.
 */
export function windowTitle(appName: string, state: ExportState, unseen: UnseenOutcome): string {
  if (state.status === 'running') {
    const { job } = state;
    const percent = `${Math.floor(job.progress * 100)} %`;
    const batch = job.batch ? `${job.batch.index + 1}/${job.batch.count} · ` : '';
    return `${job.paused ? 'Paused ' : ''}${batch}${percent} · ${appName}`;
  }
  if (unseen === 'done') return `Ready · ${appName}`;
  if (unseen === 'failed') return `Export failed · ${appName}`;
  return appName;
}
