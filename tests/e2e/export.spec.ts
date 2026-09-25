import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
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

async function elapsed(page: Page): Promise<number> {
  return Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
}

/** The smallest custom format keeps the software-rendered test short. */
async function chooseSmallFormat(page: Page) {
  await page.getByText('Custom', { exact: true }).click();
  await page.getByRole('radio', { name: '1:1' }).click();
  await page.getByTestId('export-resolution').selectOption('720');
  await page.getByTestId('export-fps').selectOption('24');
  await expect(page.getByTestId('export-dialog')).toContainText('720×720 · 24 fps · ');
  await expect(page.getByTestId('export-start')).toBeEnabled();
}

async function download(page: Page): Promise<{ name: string; data: Buffer }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-download').click(),
  ]);
  return { name: file.suggestedFilename(), data: await readFile(await file.path()) };
}

async function inspect(data: Buffer) {
  const input = new Input({ source: new BufferSource(data), formats: ALL_FORMATS });
  const video = (await input.getPrimaryVideoTrack())!;
  const audio = (await input.getPrimaryAudioTrack())!;
  let frames = 0;
  for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
    metadataOnly: true,
  })) {
    if (packet.byteLength > 0) frames++;
  }
  return {
    width: video.displayWidth,
    height: video.displayHeight,
    frames,
    duration: await input.computeDuration([video]),
    audioDuration: await input.computeDuration([audio]),
  };
}

test('exports the range between the markers as a video file', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 10);
  // Load the track, then pause it (waiting for each state, so the second click is a pause).
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');

  // Markers at 5 s and at the end, set with the keys while the timeline has focus (TR-09).
  await page.getByTestId('timeline').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => elapsed(page)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(4.9);
  await page.keyboard.press('i');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(9.5);
  await page.keyboard.press('o');
  await expect(page.getByTestId('marks')).toContainText('0:05–0:10');
  await expect(page.getByTestId('marked-range')).toBeVisible();

  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await expect(page.getByTestId('export-range-marks')).toBeChecked();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-progress')).toBeVisible();
  // The live visuals pause while exporting; the top bar shows the progress.
  await expect(page.getByTestId('export-button')).toContainText('%');
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 100_000 });

  const file = await download(page);
  expect(file.name).toMatch(/^Clicks \(0m05s-0m09s\)\.(mp4|webm)$/);
  const video = await inspect(file.data);
  // 5 → 9.95 s at 24 fps: 119 frames; the audio is exactly as long.
  expect(video).toMatchObject({ width: 720, height: 720, frames: 119 });
  expect(video.duration).toBeCloseTo(119 / 24, 1);
  expect(video.audioDuration).toBeCloseTo(119 / 24, 1);
  expect(errors).toEqual([]);
});

test('an interrupted export resumes after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 8);
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-start').click();

  // Wait until the first of the three segments is finished, then reload mid-render.
  const button = page.getByTestId('export-button');
  await expect
    .poll(async () => Number(/(\d+) %/.exec((await button.textContent()) ?? '')?.[1] ?? 0), {
      timeout: 60_000,
    })
    .toBeGreaterThan(45);
  await page.reload();

  // The queue is empty now: the audio pass was done, so the export needs no file to resume.
  await expect(page.getByTestId('export-note')).toContainText('interrupted');
  await page.getByTestId('export-note').click();
  await expect(page.getByTestId('export-interrupted')).toContainText('% rendered');
  await page.getByTestId('export-resume').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 100_000 });

  const file = await download(page);
  expect(file.name).toMatch(/^Clicks\.(mp4|webm)$/);
  const video = await inspect(file.data);
  expect(video).toMatchObject({ width: 720, height: 720, frames: 192 });
  expect(video.duration).toBeCloseTo(8, 1);
  expect(video.audioDuration).toBeCloseTo(8, 1);
  expect(errors).toEqual([]);
});

test('an export can be paused, continued and cancelled', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 8);
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-start').click();
  const progress = page.getByTestId('export-progress');
  await expect(progress).toHaveAttribute('data-phase', 'video', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByTestId('export-button')).toContainText('Paused');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('export-button')).toContainText('Exporting');
  await page.getByTestId('export-cancel').click();
  // Back to the settings, with nothing left to resume after a reload.
  await expect(page.getByTestId('export-start')).toBeVisible();
  await expect(page.getByTestId('export-button')).toHaveText('Export');
  await page.reload();
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('export-note')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the stage follows the aspect ratio and shows safe areas', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  const ratio = async () => {
    const box = (await stage.boundingBox())!;
    return box.width / box.height;
  };
  expect(await ratio()).toBeCloseTo(16 / 9, 1);
  await page.getByTestId('aspect-select').selectOption('9:16');
  await expect.poll(ratio).toBeCloseTo(9 / 16, 1);
  await page.getByRole('button', { name: 'Safe areas' }).click();
  await expect(page.getByTestId('safe-areas')).toContainText('Buttons');
  // Choosing the TikTok preset in the export dialog keeps 9:16; YouTube switches back.
  await page.getByTestId('export-button').click();
  await expect(page.getByRole('radio', { name: /TikTok/ })).toBeChecked();
  await page.getByRole('radio', { name: /YouTube 1080p60/ }).check();
  await expect.poll(ratio).toBeCloseTo(16 / 9, 1);
  await page.reload();
  await expect(page.getByTestId('aspect-select')).toHaveValue('16:9');
  await expect(page.getByTestId('safe-areas')).toBeVisible();
});
