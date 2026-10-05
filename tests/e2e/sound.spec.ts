import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { readFile } from 'node:fs/promises';
import { speed } from './time';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:welcome:v1', '1');
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
  await page.getByTestId('export-resolution').selectOption('360');
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

test('only the sound is saved as a WAV, at the tempo of the sound (EX-11)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 4);
  await page.getByRole('tab', { name: /Sound/ }).click();
  await page.getByTestId('sound-preset').filter({ hasText: 'Sped up' }).click();
  // No visuals are needed: it works from the analysis too.
  await page.getByRole('button', { name: 'Analysis' }).click();

  await page.getByTestId('export-button').click();
  await page.getByTestId('export-content-sound').check();
  await expect(page.getByTestId('export-sound')).toContainText('WAV, 48 kHz, 16 bit');
  // 4 s at 120 %: 3.3 s, at 192,000 bytes a second.
  await expect(page.getByTestId('export-length')).toContainText('0:03 · about 625.0 KB');
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toContainText('Your sound is ready.', {
    timeout: 60_000,
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('Clicks (Sped up).wav');
  const input = new Input({
    source: new BufferSource(await readFile(await download.path())),
    formats: ALL_FORMATS,
  });
  expect(await input.getPrimaryVideoTrack()).toBeNull();
  const audio = (await input.getPrimaryAudioTrack())!;
  expect(audio.codec).toBe('pcm-s16');
  expect(audio.sampleRate).toBe(48000);
  expect(audio.numberOfChannels).toBe(2);
  expect(await input.computeDuration([audio])).toBeCloseTo(4 / 1.2, 1);
  // The choice is kept for the next export.
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('vibe-visualizer:export:v1') ?? '{}').content,
  );
  expect(stored).toBe('sound');
  expect(errors).toEqual([]);
});
