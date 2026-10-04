import { expect, test } from '@playwright/test';
import { openMore } from './topbar';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

test('the top bar fits narrower windows, the rare actions in its ⋯ menu @firefox', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const bar = page.locator('header.topbar');
  const aspect = page.getByTestId('aspect-select').locator('option:checked');
  for (const width of [1440, 1366, 1280, 1100, 1024, 900, 800]) {
    await page.setViewportSize({ width, height: 800 });
    // Nothing sticks out of the bar, and no button breaks onto a second line.
    await expect
      .poll(() => bar.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(0);
    const heights = await bar
      .locator('button, select')
      .evaluateAll((elements) =>
        elements
          .filter((element) => (element as HTMLElement).offsetParent !== null)
          .map((element) => element.getBoundingClientRect().height),
      );
    expect(Math.max(...heights), `at ${width} px`).toBeLessThan(40);
  }
  // Narrow: the aspect ratio without its platforms, the modes as icons that keep their names.
  await expect(aspect).toHaveText('16:9');
  await expect(page.getByRole('button', { name: 'Kaleidoscope', exact: true })).toBeVisible();
  // Wide: all of it.
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(aspect).toHaveText('16:9 · YouTube');

  // The ⋯ menu, with the keys.
  const menu = page.getByTestId('more-menu');
  await page.getByTestId('more-button').focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('safe-areas-toggle')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('visuals-pause')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('more-button')).toBeFocused();
  await openMore(page);
  await expect(page.getByTestId('safe-areas-toggle')).toHaveAttribute('aria-checked', 'true');
  // Escape closes it, and so do Tab out of it and a click elsewhere.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('more-button')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await expect(page.getByTestId('controller-button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await openMore(page);
  await page.getByTestId('visual-stage').click({ position: { x: 20, y: 20 } });
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});
