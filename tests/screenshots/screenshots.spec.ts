import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createDrumMix } from '../../src/core/analysis/eval/drum-mix';
import { moreAction } from '../e2e/topbar';

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

/**
 * Jumps to `fraction` of the track (`duration` seconds long) by a click on the timeline, playing,
 * and clicks again when a click did not take (on a slow runner, the first can come too early).
 */
async function seek(page: Page, fraction: number, duration: number): Promise<void> {
  // The track may have played to its end since the last jump: it plays again.
  const play = page.getByTestId('play-button');
  if ((await play.getAttribute('aria-label')) === 'Play') {
    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Pause');
  }
  const offset = async () =>
    Number(await page.getByTestId('elapsed').getAttribute('data-seconds')) - fraction * duration;
  await expect(async () => {
    const box = (await page.getByTestId('timeline').boundingBox())!;
    await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
    // Until the playhead is there (within a second, as the music plays on).
    await expect.poll(async () => Math.abs(await offset()), { timeout: 3_000 }).toBeLessThan(1);
  }).toPass({ timeout: 30_000 });
}

/**
 * A DDJ-FLX2 that is not there (as in the e2e tests): Web MIDI with one input and one output
 * named like the controller, for the screenshot of the controller dialog.
 */
async function fakeController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const input = { id: 'flx2-in', name: 'DDJ-FLX2', type: 'input', state: 'connected' };
    const output = {
      id: 'flx2-out',
      name: 'DDJ-FLX2',
      type: 'output',
      state: 'connected',
      send: () => undefined,
    };
    const access = {
      inputs: new Map([[input.id, { ...input, onmidimessage: null }]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null,
      sysexEnabled: false,
    };
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
    });
  });
}

test('screenshots for the README', async ({ page, context }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const mix = createDrumMix(48000);
  const duration = mix.left.length / mix.sampleRate;
  const file = {
    name: 'FibeStation Demo.wav',
    mimeType: 'audio/wav',
    buffer: wav(mix.left, mix.right, mix.sampleRate),
  };

  await context.grantPermissions(['midi']);
  await fakeController(page);
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
  // In the first picture, the logo stands upright, its name easy to read: the record does not
  // turn for it, and the look is the default again afterwards.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.locator('summary', { hasText: /^Logo$/ }).click();
  await page.getByTestId('logo-spin').selectOption('0');
  await page.getByRole('tab', { name: 'Queue' }).click();
  await seek(page, 0.8, duration);
  await page.waitForTimeout(2500);
  await shot(page, 'logo-spectrum');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByTestId('preset-select').selectOption('Blue-Pink Vortex');
  await page.getByRole('tab', { name: 'Queue' }).click();

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

  // Neon Ribbons, with its controls.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByTestId('preset-select').selectOption('Neon Ribbons');
  await seek(page, 0.8, duration);
  await page.waitForTimeout(4000);
  await shot(page, 'neon-ribbons');

  // A TikTok frame with its safe areas, and the Visuals tab.
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await page.getByTestId('aspect-select').selectOption('9:16');
  await moreAction(page, 'safe-areas-toggle');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await seek(page, 0.8, duration);
  await page.waitForTimeout(2500);
  await shot(page, 'tiktok');

  // The export dialog.
  await moreAction(page, 'safe-areas-toggle');
  await page.getByTestId('aspect-select').selectOption('16:9');
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'export');
  await page.keyboard.press('Escape');

  // Rain in the Logo Spectrum (LS-17).
  await page.getByTestId('preset-select').selectOption('Night Rain');
  await seek(page, 0.8, duration);
  await page.waitForTimeout(2500);
  await shot(page, 'night-rain');

  // The Sound and Live tabs.
  await page.getByRole('tab', { name: 'Sound' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'sound');
  await page.getByRole('tab', { name: 'Live' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'live');

  // What the visuals react to.
  await page.getByRole('button', { name: 'Analysis' }).click();
  await seek(page, 0.8, duration);
  await page.waitForTimeout(2500);
  await shot(page, 'analysis');
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();

  // The colours of a track: two of your own, with the preview.
  await page.getByRole('tab', { name: 'Queue' }).click();
  await page.getByTestId('queue-rename').first().click();
  await page.getByTestId('track-colors-own').click();
  const picks = page.getByTestId('track-colors-pick');
  await picks.first().fill('#ff5ca8');
  await page.getByRole('button', { name: 'Add a colour' }).click();
  await picks.nth(1).fill('#3d7bff');
  await page.waitForTimeout(800);
  await shot(page, 'track-colours');
  await page.keyboard.press('Escape');

  // The DJ controller, connected.
  await moreAction(page, 'controller-button');
  const controller = page.getByTestId('controller-dialog');
  await controller.getByTestId('controller-connect').click();
  await expect(controller.getByTestId('controller-status')).toHaveText('Connected');
  await page.waitForTimeout(500);
  await shot(page, 'controller');
  await page.keyboard.press('Escape');

  // The mini player (DS-06): the visuals in a window of their own, with its controls.
  await seek(page, 0.8, duration);
  const opened = context.waitForEvent('page');
  await moreAction(page, 'mini-player');
  const mini = await opened;
  await mini.setViewportSize({ width: 640, height: 360 });
  await mini.mouse.move(320, 180);
  await mini.waitForTimeout(2500);
  await mini.screenshot({ path: `${OUT}/mini-player.jpg`, type: 'jpeg', quality: 85 });
  const closed = mini.waitForEvent('close');
  await mini.getByTestId('mini-back').click();
  await closed;

  // The tracks of the queue as one video, with chapters.
  await page.getByTestId('file-input').setInputFiles({ ...file, name: 'Second Demo.wav' });
  await expect(page.getByTestId('queue-item').nth(1)).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-range-tracks').check();
  await page.waitForTimeout(800);
  await shot(page, 'export-tracks');
});

test('screenshots of the top bar and its ⋯ menu', async ({ page, context }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:welcome:v1', '1');
    // The export below is downloaded at its end: no dialog asks where to save it.
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await page.goto('/');
  const mix = createDrumMix(48000);
  await page.getByTestId('file-input').setInputFiles({
    name: 'FibeStation Demo.wav',
    mimeType: 'audio/wav',
    buffer: wav(mix.left, mix.right, mix.sampleRate),
  });
  await expect(page.getByTestId('queue-bpm')).toBeVisible({ timeout: 60_000 });

  // The ⋯ menu, open: the corner of the window it is in.
  await page.getByTestId('more-button').click();
  await expect(page.getByTestId('more-menu')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${OUT}/menu.jpg`,
    type: 'jpeg',
    quality: 85,
    clip: { x: 800, y: 0, width: 640, height: 400 },
  });
  await page.keyboard.press('Escape');
  // No focus ring on the button the keys left the focus on, and no button under the mouse.
  const blur = async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(8, 400);
  };
  await blur();

  // The bar at four widths, then while an export runs; one picture of them all.
  const widths = [
    [1440, '1440 px'],
    [1280, '1280 px: the aspect ratio without its platforms'],
    [1100, '1100 px: the modes as icons'],
    [800, '800 px: the logo without the name'],
  ] as const;
  const bars: { label: string; png: Buffer }[] = [];
  const takeBars = async (note: string) => {
    for (const [width, label] of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      bars.push({ label: label + note, png: await page.locator('header.topbar').screenshot() });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  await takeBars('');
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-progress')).toHaveAttribute('data-phase', 'video', {
    timeout: 120_000,
  });
  await page.keyboard.press('Escape');
  await blur();
  await takeBars(', an export running');
  const sheet = await context.newPage();
  const rows = bars
    .map(
      ({ label, png }) =>
        `<p>${label}</p><img src="data:image/png;base64,${png.toString('base64')}">`,
    )
    .join('');
  await sheet.setContent(
    `<style>body{margin:0;background:#28282e}main{display:inline-block}` +
      `p{margin:0;padding:6px 8px 4px;font:16px system-ui,sans-serif;color:#ebebf0}` +
      `img{display:block;margin-bottom:6px}</style><main>${rows}</main>`,
  );
  await sheet.locator('main').screenshot({ path: `${OUT}/top-bar.png` });
});
