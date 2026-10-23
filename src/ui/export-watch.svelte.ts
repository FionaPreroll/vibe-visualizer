import { isSoundFile } from '../core/export/export-job';
import type { ExportState } from '../core/export/exporter';
import type { UnseenOutcome } from './window-title';

/** What a notification says about an export that ended. */
export interface ExportNotice {
  title: string;
  body: string;
}

/** The words for what an export made: videos, or sounds (EX-11). */
function nouns(fileName: string): [one: string, many: string] {
  return isSoundFile(fileName) ? ['sound', 'sounds'] : ['video', 'videos'];
}

/** "Your video is ready.", or "Your sounds are ready." and so on. */
export function readyNote(count: number, fileName: string): string {
  const [one, many] = nouns(fileName);
  return count > 1 ? `Your ${many} are ready.` : `Your ${one} is ready.`;
}

/**
 * How an export ends while the tab is in the background (#56): the outcome the window title
 * shows until the tab is seen again, and the notification it gives.
 */
export class ExportWatch {
  /** How an export ended while the tab was in the background, until the tab is seen again. */
  unseen = $state<UnseenOutcome>(null);
  private status: ExportState['status'] = 'idle';

  /**
   * Follows the export to its new `state`; `visible`: whether the tab is seen. Gives the
   * notification for an export that just ended unseen, or null.
   */
  follow(state: ExportState, visible: boolean): ExportNotice | null {
    const was = this.status;
    this.status = state.status;
    if (was !== 'running' || visible) return null;
    if (state.status === 'done') {
      this.unseen = 'done';
      const several = state.videos.length > 1;
      const [one, many] = nouns(state.fileName);
      return {
        title: several ? `Your ${many} are ready` : `Your ${one} is ready`,
        body: several ? `${state.videos.length} ${many}` : state.fileName,
      };
    }
    if (state.status === 'failed') {
      this.unseen = 'failed';
      return { title: 'The export failed', body: state.message };
    }
    return null;
  }

  /** The tab is seen again: so is how the export ended. */
  seen(): void {
    this.unseen = null;
  }
}
