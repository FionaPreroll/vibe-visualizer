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

test('the tempo of a track can be corrected, and is kept for its file (TMP-06)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // A click every half second: the grid finds 120 BPM.
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  const badge = page.getByTestId('queue-bpm');
  await expect(badge).toHaveText('120 BPM', { timeout: 15_000 });

  // Double it: the grid is computed anew around 240 BPM.
  await badge.click();
  const menu = page.getByTestId('tempo-menu');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('tempo-double')).toContainText('240 BPM');
  await expect(page.getByTestId('tempo-auto')).toBeDisabled();
  await page.getByTestId('tempo-double').click();
  await expect(menu).toHaveCount(0);
  await expect(badge).toHaveText('240 BPM');
  await expect(badge).toHaveAttribute('data-pending', 'false');
  await expect(badge).toHaveAttribute('title', /set by hand/);

  // The corrected tempo comes back with the file.
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await expect(badge).toHaveText('240 BPM', { timeout: 15_000 });

  // Back to the tempo the grid finds; then half of it, from where ÷ 2 goes out of range.
  await badge.click();
  await page.getByTestId('tempo-auto').click();
  await expect(badge).toHaveText('120 BPM');
  await badge.click();
  await page.getByTestId('tempo-half').click();
  await expect(badge).toHaveText('60 BPM');
  await badge.click();
  await expect(page.getByTestId('tempo-half')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the waveforms have two styles, and the choice is kept (TR-10)', async ({ page }) => {
  const errors = collectErrors(page);
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM', { timeout: 15_000 });
  await page.getByTestId('play-button').click();
  // Three bands by default; the button switches to RGB.
  const style = page.getByTestId('waveform-style');
  await expect(style).toHaveAttribute('data-style', 'bands');
  await expect(style).toHaveText('3 bands');
  await style.click();
  await expect(style).toHaveAttribute('data-style', 'rgb');
  await expect(style).toHaveText('RGB');

  await page.reload();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect(style).toHaveAttribute('data-style', 'rgb');
  expect(errors).toEqual([]);
});
