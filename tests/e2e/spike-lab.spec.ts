import { expect, test, type Page } from '@playwright/test';
import { createWav } from './wav';

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

test('S4 rendering spike runs to completion', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?quick');
  await page.getByTestId('s4-run').click();
  const card = page.getByTestId('spike-S4');
  await expect(card).toHaveAttribute('data-status', /done|error/, { timeout: 180_000 });
  console.log(await card.innerText());
  await expect(card).toHaveAttribute('data-status', 'done');
  await expect(
    card.locator('tr[data-state="pass"]', { hasText: 'Float render targets' }),
  ).toHaveCount(1);
  await expect(
    card.locator('tr[data-state="pass"]', { hasText: '4K offline without errors' }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('S1 streaming spike plays a file and jumps between cues', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?quick');
  await page
    .getByTestId('s1-file')
    .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: createWav(30) });
  await expect(page.getByTestId('s1-run')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('s1-run').click();
  const card = page.getByTestId('spike-S1');
  await expect(card).toHaveAttribute('data-status', /done|error/, { timeout: 120_000 });
  console.log(await card.innerText());
  await expect(card).toHaveAttribute('data-status', 'done');
  await expect(card.locator('tr[data-state="pass"]', { hasText: 'Playback starts' })).toHaveCount(
    1,
  );
  await expect(
    card.locator('tr[data-state="pass"]', { hasText: 'Cue jumps under 50 ms' }),
  ).toHaveCount(1);

  await page.getByTestId('s1-benchmark').click();
  await expect(card.locator('tr', { hasText: 'Decoded length matches duration' })).toHaveAttribute(
    'data-state',
    'pass',
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
});

test('S2 key lock spike: fast and bit-identical in worker and AudioWorklet', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?quick');
  await page.getByTestId('s2-run').click();
  const card = page.getByTestId('spike-S2');
  await expect(card).toHaveAttribute('data-status', /done|error/, { timeout: 180_000 });
  console.log(await card.innerText());
  await expect(card).toHaveAttribute('data-status', 'done');
  await expect(card.locator('tr[data-state="pass"]', { hasText: 'Deterministic' })).toHaveCount(1);
  await expect(
    card.locator('tr[data-state="pass"]', { hasText: 'Identical output live' }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
