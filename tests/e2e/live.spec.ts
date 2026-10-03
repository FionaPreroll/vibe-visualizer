import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWav } from './wav';

// Chromium's fake devices: the "microphone" plays this file (a tone with a click every half
// second), permission prompts are accepted, and screen sharing returns fake audio.
const capture = join(tmpdir(), 'vibe-visualizer-live-input.wav');
writeFileSync(capture, createWav(20, 48000));

test.use({
  launchOptions: {
    executablePath: process.env['PW_CHROMIUM_PATH'] || undefined,
    args: [
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${capture}`,
    ],
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function peak(page: Page): Promise<number> {
  return Number(await page.getByTestId('level-meter').getAttribute('data-peak'));
}

test('an audio input drives the analysis, with gain, meter and monitoring', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: /Live/ }).click();
  await page.getByTestId('live-device').click();
  const status = page.getByTestId('live-status');
  await expect(status).toContainText('Fake Default Audio Input');
  await expect(page.getByTestId('now-title')).toHaveText('Live input');
  // The clicks reach the level meter and the analysis.
  await expect.poll(() => peak(page), { timeout: 10_000 }).toBeGreaterThan(-20);
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(page.getByTestId('analysis-view')).toHaveAttribute('data-active', 'true');

  // Input gain lowers the level (IN-03).
  const gain = page.getByRole('slider', { name: 'Input gain' });
  await gain.fill('-24');
  await expect.poll(() => peak(page), { timeout: 10_000 }).toBeLessThan(-25);
  await gain.fill('0');

  // Monitoring is off until switched on (IN-04), and off again for the next source.
  const monitor = page.getByTestId('live-monitor');
  await expect(monitor).not.toBeChecked();
  await monitor.check();
  await page.getByTestId('input-device').selectOption({ label: 'Fake Audio Input 1' });
  await expect(status).toContainText('Fake Audio Input 1');
  await expect(monitor).not.toBeChecked();

  await page.getByTestId('transport-stop-live').click();
  await expect(status).toHaveCount(0);
  await expect(page.getByTestId('now-title')).toHaveText('Nothing playing');
  await expect(monitor).toBeDisabled();

  // The device and the gain are remembered; live input itself starts only when asked.
  await gain.fill('6');
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Input gain' })).toHaveValue('6');
  await expect(page.getByTestId('live-status')).toHaveCount(0);
  await page.getByTestId('live-device').click();
  await expect(page.getByTestId('live-status')).toContainText('Fake Audio Input 1');
  expect(errors).toEqual([]);
});

test('audio shared from a tab or the screen becomes the source', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: /Live/ }).click();
  await expect(page.getByTestId('share-audio-hint')).toContainText('Share the sound too');
  await page.getByTestId('live-display').click();
  const status = page.getByTestId('live-status');
  await expect(status).toHaveAttribute('data-kind', 'display');
  await expect.poll(() => peak(page), { timeout: 10_000 }).toBeGreaterThan(-60);
  await page.getByTestId('live-stop').click();
  await expect(status).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('choosing a track in the queue ends live input', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'Track.wav',
    mimeType: 'audio/wav',
    buffer: createWav(6, 44100),
  });
  const item = page.getByTestId('queue-item');
  await expect(item).toHaveAttribute('data-status', 'ready');
  await page.getByRole('tab', { name: /Live/ }).click();
  await page.getByTestId('live-device').click();
  await expect(page.getByTestId('live-status')).toBeVisible();
  // Space does nothing to the queue while live input runs.
  await page.keyboard.press(' ');
  await expect(page.getByTestId('now-title')).toHaveText('Live input');

  await page.getByRole('tab', { name: 'Queue' }).click();
  await item.dblclick();
  await expect(page.getByTestId('now-title')).toHaveText('Track');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await page.getByRole('tab', { name: /Live/ }).click();
  await expect(page.getByTestId('live-status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the tempo of the live input can be corrected (TMP-06)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: /Live/ }).click();
  await page.getByTestId('live-device').click();
  await expect(page.getByTestId('now-title')).toHaveText('Live input');
  // The clicks come every half second: 120 BPM.
  const badge = page.getByTestId('live-bpm');
  await expect(badge).toHaveText(/^12[0-2] BPM$/, { timeout: 20_000 });
  await badge.click();
  await expect(page.getByTestId('tempo-auto')).toBeDisabled();
  // The tracking's tempo moves a little from moment to moment (it was 124 BPM once by the time
  // of the click), and halving takes it as it is then: the value on the button is read in the
  // same step as the click.
  const half = await page.getByTestId('tempo-half').evaluate((button: HTMLElement) => {
    const value = Number.parseFloat(button.querySelector('.value')?.textContent ?? '');
    button.click();
    return value;
  });
  // Half of the clicks' 120 BPM, as the tracking has it.
  expect(Math.abs(half - 60)).toBeLessThanOrEqual(3);
  await expect(badge).toHaveAttribute('title', /keeps close to \d+ BPM/);
  const held = Number(/keeps close to (\d+) BPM/.exec((await badge.getAttribute('title'))!)![1]);
  // The same tempo: the button rounds it to whole BPM, the title after keeping it to hundredths.
  expect(Math.abs(held - half)).toBeLessThanOrEqual(1);
  await expect(badge).toHaveText(/^6[01] BPM$/, { timeout: 15_000 });
  // Back to the tempo the tracking finds.
  await badge.click();
  await page.getByTestId('tempo-auto').click();
  await expect(badge).toHaveText(/^12[0-2] BPM$/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
