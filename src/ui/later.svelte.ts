import { reportProblem } from './problems';

/**
 * A part of the UI that loads when it is first needed (#53): the main chunk holds what the first
 * screen shows, and a dialog comes when it opens, or once the browser has time after the start,
 * whichever is first; most sessions open few of them, or later.
 */
export class Lazy<C> {
  /** The component, once loaded. */
  component: C | null = $state.raw(null);
  #loading: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    private readonly importer: () => Promise<{ default: C }>,
  ) {}

  /** Starts loading it, once; one that failed (offline after an update) is tried again. */
  load(): Promise<void> {
    this.#loading ??= this.importer().then(
      (module) => {
        this.component = module.default;
      },
      (error: unknown) => {
        this.#loading = null;
        reportProblem(error, this.name);
      },
    );
    return this.#loading;
  }
}

export const exportDialog = new Lazy('The export dialog', () => import('./ExportDialog.svelte'));
export const settingsDialog = new Lazy('The settings', () => import('./SettingsDialog.svelte'));
export const helpDialog = new Lazy('The help', () => import('./HelpDialog.svelte'));
export const controllerDialog = new Lazy(
  'The DJ controller dialog',
  () => import('./ControllerDialog.svelte'),
);
export const trackNameDialog = new Lazy(
  'The dialog of a track',
  () => import('./TrackNameDialog.svelte'),
);
export const analysisView = new Lazy('The analysis', () => import('./AnalysisView.svelte'));

/**
 * Loads them all when the browser has time after the first frame, so that each opens at once
 * and none holds up the start.
 */
export function loadWhenIdle(): () => void {
  const load = () => {
    for (const part of [
      exportDialog,
      settingsDialog,
      helpDialog,
      controllerDialog,
      trackNameDialog,
      analysisView,
    ]) {
      void part.load();
    }
  };
  if (!('requestIdleCallback' in window)) {
    const timer = setTimeout(load, 1500);
    return () => clearTimeout(timer);
  }
  let idle = 0;
  const frame = requestAnimationFrame(() => {
    idle = requestIdleCallback(load, { timeout: 3000 });
  });
  return () => {
    cancelAnimationFrame(frame);
    cancelIdleCallback(idle);
  };
}
