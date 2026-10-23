import { SvelteSet } from 'svelte/reactivity';
import type { ExportOptions } from '../../core/export/video-format';
import { loadExportOptions } from '../../core/state/persistence';

/**
 * What the user chose in the export dialog, which its parts share (#56): the options (kept for
 * the next export), the tracks left out, and what went wrong with the last attempt.
 */
export class ExportChoices {
  options = $state<ExportOptions>(loadExportOptions());
  /** Tracks of the queue left out of a video of several; those added later are in. */
  readonly skipped = new SvelteSet<string>();
  /** What went wrong when the export was to start or resume, for the user. */
  problem = $state<string | null>(null);
}
