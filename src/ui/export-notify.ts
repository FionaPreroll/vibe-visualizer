/**
 * A notification of the system when an export ends while the app's tab is in the background:
 * a long export runs while the user works elsewhere. Only when the user asked for it in the
 * export dialog, and the browser allows it.
 */

/** Whether this browser can show notifications at all. */
export function notificationsAvailable(): boolean {
  return typeof Notification === 'function';
}

/** Whether notifications are allowed (asked before). */
export function notificationsAllowed(): boolean {
  return notificationsAvailable() && Notification.permission === 'granted';
}

/**
 * Asks the browser to allow notifications, right after a click of the user. True when they are
 * allowed; false when the user or the browser refused.
 */
export async function askForNotifications(): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  // Asked again, the browser answers at once with what was decided before, without a prompt.
  return (await Notification.requestPermission()) === 'granted';
}

/** Tells the user that the export ended; a click on the notice brings the app's tab to front. */
export function notifyExportEnd(appName: string, title: string, body: string): void {
  if (!notificationsAllowed()) return;
  try {
    const notice = new Notification(title, { body, tag: `${appName}-export` });
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
  } catch {
    // Some browsers allow notifications only from a service worker (Chrome on Android): the
    // title of the tab still says it.
  }
}
