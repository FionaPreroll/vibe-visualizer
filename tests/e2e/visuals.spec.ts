import { expect, test, type Page } from '@playwright/test';
import { createPng } from './png';
import { createWav } from './wav';

const ACK = 'vibe-visualizer:photosensitivity-ack';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function acknowledge(page: Page) {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), ACK);
}

test('first start warns about flashing visuals, once', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Flashing visuals' });
  await expect(dialog).toBeVisible();
  await page.getByTestId('photosensitivity-ok').click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('visual-stage')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('Logo Spectrum renders in a worker and moves with the music', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });

  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(8, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // Consecutive pictures differ: the ring, the particles and the pulse move.
  const first = await stage.screenshot();
  await page.waitForTimeout(700);
  const second = await stage.screenshot();
  expect(first.equals(second)).toBe(false);
  expect(errors).toEqual([]);
});

test('visual settings and presets survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  await expect(preset).toHaveValue('Classic Rainbow');

  await preset.selectOption('Inferno');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Visuals' })).toHaveAttribute('aria-selected', 'true');
  await expect(preset).toHaveValue('Inferno');

  // Any change makes the settings custom; they can be saved as a preset of your own.
  const glow = page.getByRole('slider', { name: 'Glow', exact: true });
  await glow.focus();
  await page.keyboard.press('ArrowRight');
  await expect(preset).toHaveValue('');
  await page.getByTestId('preset-name').fill('Mine');
  await page.getByTestId('preset-save').click();
  await expect(preset).toHaveValue('Mine');
  await page.reload();
  await expect(preset).toHaveValue('Mine');

  await page.getByRole('button', { name: 'Delete this preset' }).click();
  await expect(preset.locator('option', { hasText: 'Mine' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(preset).toHaveValue('Classic Rainbow');
  expect(errors).toEqual([]);
});

test('logo and background images survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByText('Logo', { exact: true }).click();
  await page.getByText('Background', { exact: true }).click();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f0c"/></svg>`;
  await page.getByTestId('logo-input').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  });
  await page.getByTestId('background-input').setInputFiles({
    name: 'sky.png',
    mimeType: 'image/png',
    buffer: createPng(64, 36, (x, y) => [x * 4, y * 7, 200]),
  });
  await expect(page.getByTitle('logo.svg')).toBeVisible();
  await expect(page.getByTitle('sky.png')).toBeVisible();

  await page.reload();
  await page.getByText('Logo', { exact: true }).click();
  await page.getByText('Background', { exact: true }).click();
  await expect(page.getByTitle('logo.svg')).toBeVisible();
  await expect(page.getByTitle('sky.png')).toBeVisible();
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running');

  await page.getByTestId('logo-remove').click();
  await expect(page.getByTitle('logo.svg')).toHaveCount(0);

  // Files that are not images are refused with a message.
  await page.getByTestId('logo-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByRole('alert')).toContainText('PNG, JPEG, WebP or SVG');
  expect(errors).toEqual([]);
});
