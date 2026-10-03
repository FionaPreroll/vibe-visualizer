import { writable } from 'svelte/store';
import { errorMessage } from '../core/util/format';

/**
 * An error nobody handled (NF-10). The app shows it, with details to copy for a bug report,
 * instead of failing quietly in the console.
 */
export interface Problem {
  message: string;
  /** For a bug report: where, when, the browser and the stack. */
  details: string;
  /** How many came since the last was dismissed. */
  count: number;
}

/** The last problem, until it is dismissed. */
export const problem = writable<Problem | null>(null);

/** Reports `error`, which happened in `where` (the app, the render worker, a panel…). */
export function reportProblem(error: unknown, where = 'App'): void {
  const message = errorMessage(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const details = [
    `${where}: ${message}`,
    `Time: ${new Date().toISOString()}`,
    `Browser: ${navigator.userAgent}`,
    `Page: ${location.href}`,
    ...(stack ? ['', stack] : []),
  ].join('\n');
  problem.update((last) => ({ message, details, count: (last?.count ?? 0) + 1 }));
}

/** Reports the errors that would otherwise only reach the console; returns the undo. */
export function watchUncaughtErrors(): () => void {
  const onError = (event: ErrorEvent) => {
    // Errors of browser extensions, and of scripts of other origins (which say nothing more
    // than "Script error."), are none of the app's.
    if (/^[a-z-]*extension:/.test(event.filename)) return;
    if (event.message === 'Script error.' && !event.error) return;
    if (!ignored(event.error ?? event.message)) reportProblem(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (!ignored(event.reason)) reportProblem(event.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

function ignored(error: unknown): boolean {
  // A cancelled file dialog, or a request given up on purpose.
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  // The browser's note that a resize took two frames to settle: no error.
  return errorMessage(error).includes('ResizeObserver loop');
}
