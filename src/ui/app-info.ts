import { bugs } from '../../package.json';
import { APP_VERSION } from '../core/env/version';

/** Where bug reports and ideas go: the `bugs.email` of package.json. */
export const BUG_EMAIL: string = bugs.email;

/** Characters of the details a mail link carries: longer links may not open. */
const DETAILS_LENGTH = 1500;

/**
 * A mailto link for a bug report, with a subject and a few facts about this browser, or the
 * `details` of an error (NF-10).
 */
export function bugReportLink(appName: string, details?: string): string {
  const subject = `${appName}: bug report`;
  const facts = details
    ? ['Details:', details.slice(0, DETAILS_LENGTH)]
    : [`Version: v${APP_VERSION}`, `Browser: ${navigator.userAgent}`, `Page: ${location.href}`];
  const body = ['What happened, and what did you expect?', '', '', ...facts].join('\n');
  return `mailto:${BUG_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
