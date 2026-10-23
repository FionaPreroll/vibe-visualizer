import { releasedShortcut, shortcutFor, type ShortcutActions } from './shortcuts';

/** Keys a focused slider takes for itself. */
const SLIDER_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * Whether the focused element needs `key` itself. Text fields and selects take every key,
 * sliders the arrows, Home, End and Page Up/Down, and checkboxes and radio buttons Space (radio
 * buttons the arrows too). Everything else leaves the keys to the app: Space plays and pauses
 * also while a button has the focus (Enter still presses it), and letters work right after a
 * click.
 */
function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const typing =
    target.isContentEditable ||
    target.closest(
      'textarea, select, input:not([type="range"], [type="checkbox"], [type="radio"], [type="color"], [type="file"])',
    ) !== null;
  if (typing) return true;
  if (target.closest('input[type="range"], [role="slider"], [role="separator"]')) {
    return SLIDER_KEYS.has(key);
  }
  if (target.matches('input[type="checkbox"]')) return key === ' ';
  if (target.matches('input[type="radio"]')) return key === ' ' || key.startsWith('Arrow');
  return false;
}

/** Controls that keep the focus after a click, although a mouse user needs none. */
const CLICKED = 'button, summary, input[type="checkbox"], input[type="radio"]';

/**
 * A control used with the mouse lets go of the focus, so no focus ring shows up on it at the
 * next key and the keys go on to the app. Controls reached with Tab keep it, and so does
 * whatever is in a dialog.
 */
function releaseFocus(control: Element | null | undefined): void {
  if (!(control instanceof HTMLElement) || control !== document.activeElement) return;
  if (control.closest('dialog')) return;
  control.blur();
}

export interface ShortcutListeners {
  /** What the shortcuts act on. */
  actions: ShortcutActions;
  /** Escape while no dialog is open (besides what a shortcut does with it). */
  onEscape: () => void;
  /** The window lost the keyboard: what a held key does ends (a nudge). */
  onBlur: () => void;
}

/**
 * The keyboard shortcuts (UI-04, in shortcuts.ts) in `view`: the tab, or the mini player's or
 * second screen's window. A modal dialog of the tab (the export) has the keyboard to itself.
 * Returns what stops them.
 */
export function listenToShortcuts(view: Window, listeners: ShortcutListeners): () => void {
  const { actions, onEscape, onBlur } = listeners;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onEscape();
    const shortcut = shortcutFor(event);
    if (!shortcut) return;
    if (ownsKey(event.target, event.key)) return;
    if (document.querySelector('dialog[open]')) return;
    if (shortcut.run?.(actions, event) !== false) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    releasedShortcut(event)?.release?.(actions);
  };
  view.addEventListener('keydown', onKey);
  view.addEventListener('keyup', onKeyUp);
  view.addEventListener('blur', onBlur);
  return () => {
    view.removeEventListener('keydown', onKey);
    view.removeEventListener('keyup', onKeyUp);
    view.removeEventListener('blur', onBlur);
  };
}

/**
 * Buttons, checkboxes and selects of the tab used with the mouse let go of the focus (see
 * {@link releaseFocus}); a click from the keyboard keeps it. Returns what stops it.
 */
export function releaseFocusAfterPointer(): () => void {
  // Whether the last input came from a pointer (a select chosen with the mouse lets go too).
  let pointing = false;
  const onPointerDown = () => (pointing = true);
  const onAnyKey = () => (pointing = false);
  // A click from the keyboard has no count (detail 0).
  const onClick = (event: MouseEvent) => {
    if (event.detail > 0) releaseFocus((event.target as Element | null)?.closest(CLICKED));
  };
  const onChange = (event: Event) => {
    if (pointing && event.target instanceof HTMLSelectElement) releaseFocus(event.target);
  };
  window.addEventListener('keydown', onAnyKey, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('click', onClick);
  window.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('keydown', onAnyKey, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('click', onClick);
    window.removeEventListener('change', onChange);
  };
}
