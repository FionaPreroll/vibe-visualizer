import { expect, test, type Page } from '@playwright/test';

// The spikes run in "quick" mode here; the real numbers come from running them on target machines.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('page is cross-origin isolated and probes the environment', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?quick');
  await expect(page.getByTestId('env-panel')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('isolated')).toHaveText('yes');
  expect(errors).toEqual([]);
});

test('S3 encoding spike runs to completion', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?quick');
  await page.getByTestId('s3-run').click();
  const card = page.getByTestId('spike-S3');
  await expect(card).toHaveAttribute('data-status', /done|error/, { timeout: 180_000 });
  console.log(await card.innerText());
  await expect(card).toHaveAttribute('data-status', 'done');
  // Whatever codecs this browser has, the sample file must come out playable.
  await expect(card.getByText('Sample MP4 plays in this browser')).toBeVisible();
  await expect(card.locator('tr[data-state="pass"]', { hasText: 'Sample MP4 plays' })).toHaveCount(
    1,
  );
  expect(errors).toEqual([]);
});
