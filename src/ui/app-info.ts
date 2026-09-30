import { bugs } from '../../package.json';

/** Where bug reports and ideas go: the `bugs.email` of package.json. */
export const BUG_EMAIL: string = bugs.email;

/** A mailto link for a bug report, with a subject and a few facts about this browser. */
export function bugReportLink(appName: string): string {
  const subject = `${appName}: bug report`;
  const body = [
    'What happened, and what did you expect?',
    '',
    '',
    `Browser: ${navigator.userAgent}`,
    `Page: ${location.href}`,
  ].join('\n');
  return `mailto:${BUG_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
