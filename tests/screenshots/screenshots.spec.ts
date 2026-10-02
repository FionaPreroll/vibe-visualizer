import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createDrumMix } from '../../src/core/analysis/eval/drum-mix';

/**
 * The screenshots of the README (docs/screenshots), taken while a synthetic EDM mix plays:
 * `pnpm screenshots` here, or the "Screenshots" workflow on GitHub, which commits them.
 */

const OUT = resolve('docs/screenshots');

test.use({ viewport: { width: 1440, height: 900 } });

/** A 16-bit stereo WAV file of the planes. */
function wav(left: Float32Array, right: Float32Array, sampleRate: number): Buffer {
  const frames = left.length;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  const sample = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 32767);
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(sample(left[i]!), 44 + i * 4);
    buffer.writeInt16LE(sample(right[i]!), 46 + i * 4);
  }
  return buffer;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 85 });
}

/** Jumps to `fraction` of the track (`duration` seconds long) by a click on the timeline. */
async function seek(page: Page, fraction: number, duration: number): Promise<void> {
  const box = (await page.getByTestId('timeline').boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
  // Until the playhead is there (within a second, as the music plays on).
  const offset = async () =>
    Number(await page.getByTestId('elapsed').getAttribute('data-seconds')) - fraction * duration;
  await expect.poll(async () => Math.abs(await offset()), { timeout: 10_000 }).toBeLessThan(1);
}

test('screenshots for the README', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const mix = createDrumMix(48000);
  const duration = mix.left.length / mix.sampleRate;
  const file = {
    name: 'FibeStation Demo.wav',
    mimeType: 'audio/wav',
    buffer: wav(mix.left, mix.right, mix.sampleRate),
  };

  // Software rendering is slow: the screenshots keep the full resolution (VE-07).
  await page.addInitScript(() => {
    const key = 'vibe-visualizer:settings:v1';
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ autoQuality: false }));
  });
  // The welcome of the first start, once its logo is drawn.
  await page.goto('/');
  const welcome = page.getByTestId('welcome');
  await expect(welcome.locator('img')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, 'welcome');
  await page.getByTestId('welcome-start').click();

  // The Logo Spectrum in the drop of the mix, with its beat grid and waveforms.
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-bpm')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('play-button').click();
  // The timeline takes clicks once the track is loaded.
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause', {
    timeout: 20_000,
  });
  await seek(page, 0.8, duration);
  await page.waitForTimeout(2500);
  await shot(page, 'logo-spectrum');

  // The tempo menu of the track.
  await page.getByTestId('queue-bpm').click();
  await page.waitForTimeout(400);
  await shot(page, 'tempo-menu');
  await page.keyboard.press('Escape');

  // The Kaleidoscope.
  await seek(page, 0.8, duration);
  await page.getByRole('button', { name: 'Kaleidoscope' }).click();
  await page.waitForTimeout(4000);
  await shot(page, 'kaleidoscope');

  // A TikTok frame with its safe areas, and the Visuals tab.
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await page.getByTestId('aspect-select').selectOption('9:16');
  await page.getByTitle('Safe areas').click();
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await seek(page, 0.8, duration);
  await page.waitForTimeout(2500);
  await shot(page, 'tiktok');

  // The export dialog.
  await page.getByTitle('Safe areas').click();
  await page.getByTestId('aspect-select').selectOption('16:9');
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'export');
});
