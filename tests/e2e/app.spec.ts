import { expect, test, type Page } from '@playwright/test';
import { createWav } from './wav';

// The photosensitivity notice (tested in visuals.spec.ts) would cover the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:photosensitivity-ack', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function addFiles(page: Page) {
  await page.getByTestId('file-input').setInputFiles([
    { name: 'First.wav', mimeType: 'audio/wav', buffer: createWav(4, 44100) },
    { name: 'Second.wav', mimeType: 'audio/wav', buffer: createWav(3, 48000) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') },
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute('data-status', 'ready');
  await expect(items.nth(1)).toHaveAttribute('data-status', 'ready');
  await expect(items.nth(2)).toHaveAttribute('data-status', 'unsupported');
  return items;
}

async function elapsed(page: Page): Promise<number> {
  return Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
}

test('queue: adds files, reports unsupported ones, reorders and removes', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const items = await addFiles(page);
  await expect(items.nth(0).getByTestId('queue-duration')).toHaveText('0:04');
  await expect(items.nth(2)).toContainText('unknown file format');

  // Keyboard reorder: Alt+ArrowDown moves the focused track down.
  await items.nth(0).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(items.nth(0)).toContainText('Second');
  await expect(items.nth(1)).toContainText('First');

  // Drag and drop reorder.
  await items.nth(1).dragTo(items.nth(0), { targetPosition: { x: 20, y: 5 } });
  await expect(items.nth(0)).toContainText('First');

  await items.nth(2).hover();
  await items
    .nth(2)
    .getByRole('button', { name: /Remove/ })
    .click();
  await expect(items).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('playback: plays, seeks, shows the analysis and moves on to the next track', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addFiles(page);

  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('now-title')).toHaveText('First');
  await expect.poll(() => elapsed(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByTestId('analysis-view')).toHaveAttribute('data-active', 'true');
  const queue = page.getByRole('listbox', { name: 'Queue tracks' });
  await expect(queue.getByRole('option', { selected: true })).toContainText('First');

  // Seek by clicking at 50 % of the timeline (4 s track → 2 s).
  const box = (await page.getByTestId('timeline').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(() => elapsed(page)).toBeGreaterThan(1.9);

  // The 44.1 kHz file plays at the right speed on the 48 kHz engine.
  const before = await elapsed(page);
  await page.waitForTimeout(1000);
  const advanced = (await elapsed(page)) - before;
  expect(advanced).toBeGreaterThan(0.85);
  expect(advanced).toBeLessThan(1.15);

  // At the end of the track the next one starts (the unsupported file is skipped).
  await expect(page.getByTestId('now-title')).toHaveText('Second', { timeout: 10_000 });
  await expect.poll(() => elapsed(page), { timeout: 10_000 }).toBeGreaterThan(0.2);

  // Space pauses.
  await page.locator('body').press(' ');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  const paused = await elapsed(page);
  await page.waitForTimeout(500);
  expect(await elapsed(page)).toBeCloseTo(paused, 1);
  expect(errors).toEqual([]);
});

test('settings survive a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByTestId('visual-stage')).toHaveCount(0);
  await expect(page.getByTestId('analysis-view')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analysis' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('analysis-view')).toBeVisible();
});
