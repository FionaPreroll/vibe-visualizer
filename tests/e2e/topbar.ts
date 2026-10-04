import { expect, type Page } from '@playwright/test';

/** Opens the ⋯ menu of the top bar (where safe areas, only the music, the PNG and the DJ controller are). */
export async function openMore(page: Page): Promise<void> {
  const menu = page.getByTestId('more-menu');
  if (!(await menu.isVisible())) await page.getByTestId('more-button').click();
  await expect(menu).toBeVisible();
}

/** Chooses the entry `testId` of the top bar's ⋯ menu. */
export async function moreAction(page: Page, testId: string): Promise<void> {
  await openMore(page);
  await page.getByTestId(testId).click();
}
