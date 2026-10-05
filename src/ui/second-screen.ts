import { adoptAppStyles } from './mini-player';

/**
 * The second screen (DS-03): the visuals in a window of their own, for a projector or another
 * monitor, in fullscreen there, while the controls stay in the tab. A plain window, which every
 * browser has. Where the browser can place windows on other screens (Window Management: Chrome
 * and Edge), it moves onto the other screen by itself, once the user allowed it.
 */

/** A screen as the Window Management API describes it (not in TypeScript's DOM types). */
export interface ScreenPlace {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
}

interface ScreenDetails {
  screens: readonly ScreenPlace[];
  currentScreen: ScreenPlace;
}

/** The size of the window when it opens, before it is moved or made fullscreen. */
const OPEN_SIZE = { width: 960, height: 540 };

/**
 * Opens the window, with the app's style sheets. The browser opens it only right after a click or
 * a key: nothing may be awaited before. Throws when the browser blocked it.
 */
export function openSecondScreenWindow(title: string): Window {
  const view = window.open(
    '',
    '_blank',
    `popup,width=${OPEN_SIZE.width},height=${OPEN_SIZE.height}`,
  );
  if (!view) throw new Error('the browser blocked the window: allow pop-ups for this site');
  adoptAppStyles(view, title);
  return view;
}

/** The screen to show the visuals on: another than the app's, the largest one; null: none. */
export function otherScreen(
  screens: readonly ScreenPlace[],
  current: ScreenPlace,
): ScreenPlace | null {
  const same = (a: ScreenPlace) =>
    a.availLeft === current.availLeft &&
    a.availTop === current.availTop &&
    a.availWidth === current.availWidth &&
    a.availHeight === current.availHeight;
  const others = screens.filter((screen) => !same(screen));
  if (others.length === 0) return null;
  return others.reduce((best, screen) =>
    screen.availWidth * screen.availHeight > best.availWidth * best.availHeight ? screen : best,
  );
}

/**
 * Moves the window onto another screen, filling it, where the browser can tell the screens
 * (Window Management). It asks only when there is more than one screen: the browser then asks the
 * user once to allow it. True when the window moved.
 */
export async function placeOnOtherScreen(view: Window): Promise<boolean> {
  const extended = (screen as Screen & { isExtended?: boolean }).isExtended;
  const details = (window as Window & { getScreenDetails?: () => Promise<ScreenDetails> })
    .getScreenDetails;
  if (!extended || !details) return false;
  try {
    const { screens, currentScreen } = await details.call(window);
    const target = otherScreen(screens, currentScreen);
    if (!target || view.closed) return false;
    view.moveTo(target.availLeft, target.availTop);
    view.resizeTo(target.availWidth, target.availHeight);
    return true;
  } catch {
    // Not allowed: the user drags the window there.
    return false;
  }
}

/** Shows the window's page in fullscreen, or leaves it; the browser allows it after a click. */
export function toggleWindowFullscreen(view: Window): void {
  const doc = view.document;
  if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => undefined);
  else void doc.documentElement.requestFullscreen().catch(() => undefined);
}
