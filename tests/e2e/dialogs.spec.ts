import { expect, test, type Locator, type Page } from '@playwright/test';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

/** Presses the mouse on `from` and lets it go at the top left of the page, on the backdrop. */
async function dragOut(page: Page, from: Locator) {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 5 });
  await page.mouse.up();
}

/** A click on the backdrop: pressed and let go there. */
async function clickBackdrop(page: Page) {
  await page.mouse.click(8, 8);
}

test('a dialog stays open when a drag from inside it ends on the backdrop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(5),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');

  // Selecting the title with the mouse, and letting go outside the dialog.
  await page.getByTestId('queue-rename').click();
  const rename = page.getByTestId('track-name-dialog');
  await expect(rename).toBeVisible();
  const title = page.getByTestId('track-name-title');
  await dragOut(page, title);
  await expect(rename).toBeVisible();
  await expect(title).toBeFocused();
  // A click on the backdrop closes it, as before.
  await clickBackdrop(page);
  await expect(rename).toBeHidden();

  // The same in the help, selecting its text.
  await page.getByTestId('shortcuts-button').click();
  const help = page.getByTestId('help');
  await expect(help).toBeVisible();
  await page.getByTestId('help-nav-getting-started').click();
  await dragOut(page, page.getByTestId('help-content').locator('p').first());
  await expect(help).toBeVisible();
  await clickBackdrop(page);
  await expect(help).toBeHidden();
  expect(errors).toEqual([]);
});
