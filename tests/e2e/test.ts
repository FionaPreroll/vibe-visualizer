import { test as base, type Page } from '@playwright/test';
import { addCoverage, COVERAGE, PageCoverage } from './coverage';

export { expect } from '@playwright/test';

/**
 * Playwright's `test`, which also takes the coverage of each test's pages with E2E_COVERAGE set
 * (see coverage.ts). The end-to-end tests import it from here, not from Playwright.
 */
export const test = base.extend<{ coverage: void }>({
  coverage: [
    // It needs the page, so that it ends before the page closes.
    async ({ page, browserName }, use) => {
      if (!COVERAGE || browserName !== 'chromium') {
        await use();
        return;
      }
      const started = [await PageCoverage.start(page)];
      // A second screen or a mini player opens a page of its own.
      const opened: Promise<PageCoverage | null>[] = [];
      const onPage = (other: Page) => opened.push(PageCoverage.start(other).catch(() => null));
      page.context().on('page', onPage);
      await use();
      page.context().off('page', onPage);
      const pages = [...started, ...(await Promise.all(opened))];
      const taken = await Promise.all(pages.map((coverage) => coverage?.stop() ?? []));
      await addCoverage(taken.flat());
    },
    { auto: true },
  ],
});
