import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { readFile } from 'node:fs/promises';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:photosensitivity-ack', '1');
    // Headless browsers cannot show the save dialog: the video is downloaded at the end.
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function addTrack(page: Page, seconds: number) {
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(seconds, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
}

/**
 * Track seconds played per second of real time: the slope through every update of the elapsed
 * time over `ms`, measured in the page (robust against a slow display rate).
 */
function speed(page: Page, ms = 2000): Promise<number> {
  return page.evaluate(async (duration) => {
    const element = document.querySelector('[data-testid="elapsed"]')!;
    const points: [number, number][] = [];
    const record = () =>
      points.push([performance.now() / 1000, Number(element.getAttribute('data-seconds'))]);
    // Only updates: each value is fresh at the moment it is recorded.
    const observer = new MutationObserver(record);
    observer.observe(element, { attributes: true, attributeFilter: ['data-seconds'] });
    await new Promise((resolve) => setTimeout(resolve, duration));
    observer.disconnect();
    if (points.length < 2) return 0;
    const meanTime = points.reduce((sum, [time]) => sum + time, 0) / points.length;
    const meanValue = points.reduce((sum, [, value]) => sum + value, 0) / points.length;
    let covariance = 0;
    let variance = 0;
    for (const [time, value] of points) {
      covariance += (time - meanTime) * (value - meanValue);
      variance += (time - meanTime) ** 2;
    }
    return covariance / variance;
  }, ms);
}

test('the tempo fader changes the speed, with vinyl and with key lock', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 30);
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');

  await page.getByRole('tab', { name: /Sound/ }).click();
  const sound = page.getByRole('tab', { name: /Sound/ });
  await expect(sound.locator('.sound-dot')).toHaveCount(0);
  await page.getByTestId('tempo-range').selectOption('50');
  await page.getByTestId('tempo-fader').fill('1.5');
  await expect(page.getByTestId('tempo-value')).toHaveText('+50.0 %');
  await expect(sound.locator('.sound-dot')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await speed(page)).toBeGreaterThan(1.3);

  // Key lock keeps the speed (only the pitch differs).
  await page.getByText('Key lock', { exact: true }).click();
  await expect(page.getByTestId('tempo-mode-keylock')).toBeChecked();
  await page.waitForTimeout(500);
  const locked = await speed(page);
  expect(locked).toBeGreaterThan(1.3);
  expect(locked).toBeLessThan(1.7);

  // Fine steps stay inside the range; reset goes back to the original speed.
  await page.getByTestId('tempo-range').selectOption('8');
  await expect(page.getByTestId('tempo-value')).toHaveText('+8.0 %');
  await page.getByRole('button', { name: 'Slower by 0.1 %' }).click();
  await expect(page.getByTestId('tempo-value')).toHaveText('+7.9 %');
  await page.getByTestId('tempo-reset').click();
  await expect(page.getByTestId('tempo-value')).toHaveText('0.0 %');
  await page.waitForTimeout(300);
  const normal = await speed(page, 2000);
  expect(normal).toBeGreaterThan(0.95);
  expect(normal).toBeLessThan(1.05);

  // Nudging speeds up by 4 % while the key is held (TMP-03).
  await page.getByTestId('tempo-value').click();
  await page.keyboard.down('.');
  await page.waitForTimeout(200);
  const nudged = await speed(page, 2000);
  await page.keyboard.up('.');
  expect(nudged).toBeGreaterThan(normal + 0.02);
  expect(nudged).toBeLessThan(normal + 0.06);
  expect(errors).toEqual([]);
});

test('sound presets set tempo and effects, and survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: /Sound/ }).click();
  const slowed = page.getByTestId('sound-preset').filter({ hasText: 'Slowed + Reverb' });
  await slowed.click();
  await expect(slowed).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tempo-value')).toHaveText('−15.0 %');
  await expect(page.getByTestId('reverb-on')).toBeChecked();

  // Any change is a custom sound: no preset is marked any more.
  await page.getByTestId('delay-on').check();
  await expect(slowed).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await page.getByRole('tab', { name: /Sound/ }).click();
  await expect(page.getByTestId('tempo-value')).toHaveText('−15.0 %');
  await expect(page.getByTestId('delay-on')).toBeChecked();
  await page.getByTestId('sound-preset').filter({ hasText: 'Clean' }).click();
  await expect(page.getByTestId('tempo-value')).toHaveText('0.0 %');
  await expect(page.getByTestId('reverb-on')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('an export plays at the tempo of the sound', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 4);
  await page.getByRole('tab', { name: /Sound/ }).click();
  await page.getByTestId('sound-preset').filter({ hasText: 'Sped up' }).click();

  await page.getByTestId('export-button').click();
  await page.getByText('Custom', { exact: true }).click();
  await page.getByRole('radio', { name: '1:1' }).click();
  await page.getByTestId('export-resolution').selectOption('720');
  await page.getByTestId('export-fps').selectOption('24');
  // 4 s at 120 %: 3.3 s of video.
  await expect(page.getByTestId('export-sound')).toContainText('120 % speed, vinyl');
  await expect(page.getByTestId('export-length')).toContainText('0:03');
  await expect(page.getByTestId('export-start')).toBeEnabled();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 100_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-download').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Clicks \(Sped up\)\.(mp4|webm)$/);
  const input = new Input({
    source: new BufferSource(await readFile(await download.path())),
    formats: ALL_FORMATS,
  });
  const video = (await input.getPrimaryVideoTrack())!;
  const audio = (await input.getPrimaryAudioTrack())!;
  expect(await input.computeDuration([video])).toBeCloseTo(80 / 24, 1);
  expect(await input.computeDuration([audio])).toBeCloseTo(80 / 24, 1);
  expect(errors).toEqual([]);
});
