import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createPng } from './png';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The app's entries in localStorage, parsed. */
function entries(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith('vibe-visualizer:'))
        .map(([key, value]) => [key, JSON.parse(value) as unknown]),
    ),
  );
}

/** The files of the track analysis in the Origin Private File System. */
function analysed(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('track-analysis', { create: true });
    const names: string[] = [];
    const keys = (dir as unknown as { keys(): AsyncIterable<string> }).keys();
    for await (const name of keys) names.push(name);
    return names;
  });
}

/** The backup is in the settings (the gear in the top bar). */
async function openBackup(page: Page) {
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('backup')).toBeVisible();
}

test('a backup holds everything the app keeps, and brings it back (UI-06)', async ({ page }) => {
  const errors = collectErrors(page);
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM', { timeout: 15_000 });
  await expect.poll(() => analysed(page)).toHaveLength(1);

  // A cue, a preset of your own, a background image and a cover of your own.
  const play = page.getByTestId('play-button');
  await play.click();
  await expect
    .poll(async () => Number(await page.getByTestId('elapsed').getAttribute('data-seconds')))
    .toBeGreaterThan(1);
  await page.keyboard.press('1');
  await expect(page.getByTestId('cue-marker')).toHaveCount(1);
  await play.click();
  const cover = page.getByTestId('queue-cover');
  const giveCover = async (image: boolean) => {
    await page.getByTestId('queue-item').hover();
    await page.getByTestId('queue-rename').click();
    if (image) {
      await page.getByTestId('track-cover-input').setInputFiles({
        name: 'cover.png',
        mimeType: 'image/png',
        buffer: createPng(32, 32, (x) => [x * 8, 90, 160]),
      });
      await expect(page.getByTestId('track-cover-preview')).toBeVisible();
    } else {
      await page.getByTestId('track-cover-remove').click();
    }
    await page.getByTestId('track-name-save').click();
  };
  await giveCover(true);
  await expect(cover).toBeVisible();
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  await preset.selectOption('Neon Night');
  await page.getByRole('slider', { name: 'Glow', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(preset).toHaveValue('');
  await page.getByTestId('preset-name').fill('Mine');
  await page.getByTestId('preset-save').click();
  await expect(preset).toHaveValue('Mine');
  await page.getByText('Background', { exact: true }).click();
  await page.getByTestId('background-input').setInputFiles({
    name: 'sky.png',
    mimeType: 'image/png',
    buffer: createPng(64, 36, (x, y) => [x * 4, y * 7, 200]),
  });
  await expect(page.getByTitle('sky.png')).toBeVisible();
  const kept = await entries(page);
  const trackKey = Object.keys(kept).find((key) => key.startsWith('vibe-visualizer:track:v1:'))!;
  expect(trackKey).toBeTruthy();

  // Saved without the analysis and with it.
  await openBackup(page);
  const save = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-save').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^FibeStation backup \d{4}-\d\d-\d\d\.json$/);
    const path = await download.path();
    return { path, backup: JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> };
  };
  const lean = await save();
  expect(lean.backup).not.toHaveProperty('analysis');
  await page.getByTestId('backup-analysis').check();
  const full = await save();
  await expect(page.getByTestId('backup-message')).toHaveText(
    'Saved the settings, 1 preset, the cues, markers, tempos and names of 1 track, 1 image, ' +
      '1 cover and the analysis of 1 track.',
  );
  const storage = full.backup['storage'] as Record<string, string>;
  for (const key of ['vibe-visualizer:visuals:v1', 'vibe-visualizer:presets:v1', trackKey]) {
    expect(JSON.parse(storage[key]!)).toEqual(kept[key]);
  }
  expect(Object.keys(full.backup['images'] as object)).toEqual(['background']);
  expect(Object.keys(full.backup['covers'] as object)).toHaveLength(1);
  expect(Object.keys(full.backup['analysis'] as object)).toEqual(await analysed(page));

  // A file that is not a backup is refused.
  await page.getByTestId('backup-input').setInputFiles({
    name: 'presets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'vibe-visualizer', kind: 'presets' })),
  });
  await expect(page.getByTestId('backup-message')).toHaveText(
    'This file is not a backup of the app.',
  );
  await page.keyboard.press('Escape');

  // Then all of it changes: no cue, another look, no images, no analysis.
  await page.keyboard.press('Shift+Digit1');
  await expect(page.getByTestId('cue-marker')).toHaveCount(0);
  await preset.selectOption('Classic Rainbow');
  await page.getByTestId('background-remove').click();
  await expect(page.getByTitle('sky.png')).toHaveCount(0);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('track-analysis', { recursive: true });
  });
  await page.getByRole('tab', { name: 'Queue' }).click();
  await giveCover(false);
  await expect(cover).toHaveCount(0);

  // The backup says what it holds before it replaces everything; the app reloads.
  await openBackup(page);
  await page.getByTestId('backup-input').setInputFiles(full.path);
  const confirm = page.getByTestId('backup-confirm');
  await expect(confirm).toContainText('1 image, 1 cover and the analysis of 1 track');
  await expect(confirm).toContainText('replaces everything the app keeps in this browser');
  await Promise.all([page.waitForEvent('load'), page.getByTestId('backup-restore').click()]);
  await expect(page.getByTestId('settings')).toBeHidden();
  const restored = await entries(page);
  for (const key of ['vibe-visualizer:visuals:v1', 'vibe-visualizer:presets:v1', trackKey]) {
    expect(restored[key]).toEqual(kept[key]);
  }
  expect(Object.keys(full.backup['analysis'] as object)).toEqual(await analysed(page));
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await expect(preset).toHaveValue('Mine');
  await page.getByText('Background', { exact: true }).click();
  await expect(page.getByTitle('sky.png')).toBeVisible();
  // The queue stayed; its file comes back with the cue and the cover.
  await page.getByRole('tab', { name: 'Queue' }).click();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('cue-marker')).toHaveCount(1);
  await expect(cover).toBeVisible();
  expect(errors).toEqual([]);
});
