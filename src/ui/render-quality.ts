import { writable } from 'svelte/store';

/**
 * What the live visuals draw at now (VE-07): the share of the screen's resolution, after the
 * auto-quality. The stage sets it, the Visuals tab shows it.
 */
export const liveScale = writable(1);
