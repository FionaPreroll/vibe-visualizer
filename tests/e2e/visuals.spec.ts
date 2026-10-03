import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startWithClassicLook } from './looks';
import { COVER, logoQuarters, measure, showsCover, type Region } from './pixels';
import { createPng } from './png';
import { createTaggedWav, createWav } from './wav';

const ACK = 'vibe-visualizer:welcome:v1';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function acknowledge(page: Page) {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), ACK);
}

test('the first start shows the welcome, with the warning about flashing visuals, once', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = page.getByTestId('welcome');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Flashing visuals');
  await expect(dialog).toContainText('Work in progress');
  // Bug reports go to the address in package.json.
  await expect(page.getByTestId('welcome-bug-email')).toHaveAttribute(
    'href',
    /^mailto:fipreroll\+app@gmail\.com\?subject=/,
  );
  // Reduce flashing can be switched on right there (VE-06).
  await page.getByTestId('welcome-reduce-flashing').check();
  await page.getByTestId('welcome-start').click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('visual-stage')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByText('Display', { exact: true }).click();
  await expect(page.getByTestId('reduce-flashing')).toBeChecked();
});

test('Logo Spectrum renders in a worker and moves with the music @firefox', async ({ page }) => {
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

test('the visuals can rest while the music plays on (DS-05)', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(12, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const elapsed = async () =>
    Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));

  // Paused with the button: the stage keeps its last picture, dimmed, and says so.
  await page.getByTestId('visuals-pause').click();
  await expect(page.getByTestId('visuals-pause')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('visuals-paused')).toBeVisible();
  await expect(stage).toHaveAttribute('data-paused', 'true');
  await expect(page.getByTestId('picture-button')).toBeDisabled();
  await page.waitForTimeout(300);
  const first = await stage.screenshot();
  const before = await elapsed();
  await page.waitForTimeout(700);
  expect((await stage.screenshot()).equals(first)).toBe(true);
  // The music plays on.
  expect(await elapsed()).toBeGreaterThan(before);
  const stored = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('vibe-visualizer:settings:v1') ?? '{}').visualsPaused,
    );
  await expect.poll(stored).toBe(true);

  // B shows them again, and they move.
  await page.keyboard.press('b');
  await expect(page.getByTestId('visuals-paused')).toBeHidden();
  await expect(stage).toHaveAttribute('data-paused', 'false');
  const moving = await stage.screenshot();
  await page.waitForTimeout(700);
  expect((await stage.screenshot()).equals(moving)).toBe(false);
  await expect.poll(stored).toBe(false);
  expect(errors).toEqual([]);
});

/** Loses the render worker's graphics context, as a reset of the graphics card does. */
async function loseGraphicsContext(page: Page) {
  const worker = page
    .workers()
    .filter((entry) => entry.url().includes('render.worker'))
    .at(-1);
  await worker!.evaluate(() => {
    self.dispatchEvent(new MessageEvent('message', { data: { type: 'loseContext' } }));
  });
}

test('the visuals come back after the graphics card was reset (NF-09)', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();

  // A new worker takes over on a new canvas, and the picture moves again.
  await loseGraphicsContext(page);
  await expect(stage).toHaveAttribute('data-generation', '1', { timeout: 10_000 });
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const first = await stage.screenshot();
  await page.waitForTimeout(700);
  expect(first.equals(await stage.screenshot())).toBe(false);

  // Three times a minute at most; then the visuals wait for a click.
  for (const generation of ['2', '3']) {
    await loseGraphicsContext(page);
    await expect(stage).toHaveAttribute('data-generation', generation, { timeout: 10_000 });
    await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  }
  await loseGraphicsContext(page);
  const failed = page.getByTestId('visual-stage-failed');
  await expect(failed).toContainText(
    'The visuals stopped: the graphics card was reset, several times in a row.',
  );
  await expect(stage).toHaveAttribute('data-status', 'failed');
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(failed).toHaveCount(0);
  await expect(stage).toHaveAttribute('data-generation', '4');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('visual settings and presets survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  await expect(preset).toHaveValue('Blue-Pink Vortex');

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
  await expect(preset).toHaveValue('Blue-Pink Vortex');
  expect(errors).toEqual([]);
});

test('logo and background images survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  // A look with an image behind (the default has the Kaleidoscope behind).
  await page.getByTestId('preset-select').selectOption('Classic Rainbow');
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

test('the ring can be bars, lines or dots, with motion and a tint (LS-11, LS-03, LS-02)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const stored = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('vibe-visualizer:visuals:v1') ?? '{}'));

  const style = page.getByRole('radiogroup', { name: 'Ring style' });
  await style.getByRole('radio', { name: 'Bars' }).click();
  await expect.poll(async () => (await stored()).ringStyle).toBe('bars');
  await expect(page.getByRole('slider', { name: 'Bars', exact: true })).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Ring direction' })
    .getByRole('radio', { name: 'Both' })
    .click();
  await expect.poll(async () => (await stored()).ringDirection).toBe('both');
  // Lines have no bar count, but a thickness.
  await style.getByRole('radio', { name: 'Lines' }).click();
  await expect(page.getByRole('slider', { name: 'Bars', exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Thickness', exact: true })).toBeVisible();

  await page.getByText('Motion', { exact: true }).click();
  await page.getByRole('slider', { name: 'Camera shake', exact: true }).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await stored()).shake).toBe(1);
  await page.getByText('Background', { exact: true }).click();
  await page.getByRole('slider', { name: 'Tint amount', exact: true }).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await stored()).backgroundTintAmount).toBe(1);

  // The new presets use the styles.
  await page.getByTestId('preset-select').selectOption('Dot Matrix');
  await expect.poll(async () => (await stored()).ringStyle).toBe('dots');
  await expect(stage).toHaveAttribute('data-status', 'running');
  expect(errors).toEqual([]);
});

test('favourite presets, a random pick, and your presets in a file (PR-03, PR-04)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  const star = page.getByTestId('preset-favourite');
  await expect(preset).toHaveValue('Blue-Pink Vortex');

  // Two favourites, starred in the list too.
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await preset.selectOption('Inferno');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(preset.locator('option', { hasText: '★' })).toHaveCount(2);
  await expect(preset.locator('option', { hasText: '★ Inferno' })).toHaveCount(1);

  // With favourites, the random pick takes one of them: the other one.
  await page.getByTestId('preset-random').click();
  await expect(preset).toHaveValue('Blue-Pink Vortex');
  await page.getByTestId('preset-random').click();
  await expect(preset).toHaveValue('Inferno');
  await page.reload();
  await expect(preset).toHaveValue('Inferno');
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  // Your presets go into a file and come back from it.
  await page.getByRole('slider', { name: 'Glow', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('preset-name').fill('Mine');
  await page.getByTestId('preset-save').click();
  await expect(preset).toHaveValue('Mine');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('preset-export').click(),
  ]);
  expect(download.suggestedFilename()).toBe('logo-spectrum-presets.json');
  const file = JSON.parse(await readFile(await download.path(), 'utf8')) as Record<string, unknown>;
  expect(file).toMatchObject({
    kind: 'presets',
    mode: 'logoSpectrum',
    presets: [{ name: 'Mine' }],
  });

  await page.getByRole('button', { name: 'Delete this preset' }).click();
  await expect(preset.locator('option', { hasText: 'Mine' })).toHaveCount(0);
  const input = page.getByTestId('preset-import-input');
  const json = (value: unknown) => ({
    name: 'presets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });
  await input.setInputFiles(json(file));
  await expect(page.getByTestId('preset-message')).toHaveText('Imported 1 preset.');
  await expect(preset).toHaveValue('Mine');
  // A name that is taken gets a number.
  await input.setInputFiles(json(file));
  await expect(preset.locator('option', { hasText: 'Mine (2)' })).toHaveCount(1);
  // Presets of the other mode, and files that are none, are refused with a message.
  await input.setInputFiles(json({ ...file, mode: 'kaleidoscope' }));
  await expect(page.getByTestId('preset-message')).toContainText('These are Kaleidoscope presets');
  await input.setInputFiles(json('{ nope'));
  await expect(page.getByTestId('preset-message')).toHaveText('This file is not valid JSON.');
  expect(errors).toEqual([]);
});

test('the presets switch with the music, in the preview and the export (PR-02)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  await expect(preset).toHaveValue('Blue-Pink Vortex');

  // Every 5 seconds of music, to the next preset.
  await page.getByText('Preset switching', { exact: true }).click();
  await page.getByTestId('auto-presets').check();
  await page
    .getByRole('radiogroup', { name: 'Switch every' })
    .getByRole('radio', { name: 'Seconds' })
    .click();
  await page.getByRole('slider', { name: 'Seconds', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('slider', { name: 'Seconds', exact: true })).toHaveValue('5');

  // Nothing switches without music.
  await page.waitForTimeout(6000);
  await expect(preset).toHaveValue('Blue-Pink Vortex');
  await page.getByTestId('play-button').click();
  const started = Date.now();
  await expect(preset).toHaveValue('Classic Rainbow', { timeout: 15_000 });
  expect(Date.now() - started).toBeGreaterThan(4000);
  // The switching survives a reload, and the export says it switches too.
  await page.reload();
  await expect(page.getByTestId('auto-presets')).toBeChecked();
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-switching')).toHaveText('(switching presets every 5 s)');
  expect(errors).toEqual([]);
});

test('the Kaleidoscope can run behind the Logo Spectrum (VE-08)', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(20, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const stored = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('vibe-visualizer:visuals:v1') ?? '{}'));
  // From a look with an image behind (the default has the Kaleidoscope behind already).
  await page.getByTestId('preset-select').selectOption('Classic Rainbow');
  await expect.poll(async () => (await stored()).backgroundSource).toBe('image');

  await page.getByText('Background', { exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Background shows' })
    .getByRole('radio', { name: 'Kaleidoscope' })
    .click();
  await expect.poll(async () => (await stored()).backgroundSource).toBe('kaleidoscope');
  // A word on what it shows; an image can go under it.
  await expect(page.getByTestId('background-layer-hint')).toBeVisible();
  await expect(page.getByText('Image under it').first()).toBeVisible();

  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const first = await stage.screenshot();
  await page.waitForTimeout(700);
  expect(first.equals(await stage.screenshot())).toBe(false);

  // A green image picked there shows under the Kaleidoscope at once, half of it (Kanban #20).
  const corner: Region[] = [{ x: 0.01, y: 0.02, width: 0.1, height: 0.12 }];
  const green = async () => (await measure(page, await stage.screenshot(), corner))[0]!.mean[1];
  const without = await green();
  await page.getByTestId('background-input').setInputFiles({
    name: 'green.png',
    mimeType: 'image/png',
    buffer: createPng(64, 64, () => [0, 220, 0]),
  });
  await expect.poll(async () => (await stored()).layerImage).toBe(0.5);
  await expect.poll(green, { timeout: 10_000 }).toBeGreaterThan(without + 20);

  // To the Kaleidoscope and back: the layer goes on.
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await expect(stage).toHaveAttribute('data-scene', 'logoSpectrum');
  await expect(stage).toHaveAttribute('data-status', 'running');
  const back = await stage.screenshot();
  await page.waitForTimeout(700);
  expect(back.equals(await stage.screenshot())).toBe(false);
  expect(errors).toEqual([]);
});

test('the Kaleidoscope behind is set up in the Logo Spectrum, as a look of its own (VE-08)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const stored = (key: string) =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(`vibe-visualizer:${key}:v1`) ?? '{}'),
      key,
    );
  const preset = page.getByTestId('preset-select');

  // A preset with a Kaleidoscope of its own behind the ring.
  await preset.selectOption('Ribbon Lines');
  await expect.poll(async () => (await stored('visuals')).layerLook?.scene).toBe('ribbons');
  await page.getByText('Background', { exact: true }).click();
  await page.getByTestId('background-layer-edit').click();
  const behind = page.getByRole('region', { name: 'Settings of the Kaleidoscope behind' });
  await expect(behind).toBeVisible();
  await expect(page.getByTestId('scene-ribbons')).toHaveAttribute('aria-checked', 'true');
  await expect(preset).toHaveValue('Neon Ribbons');
  // The Logo Spectrum's switching applies: none of the Kaleidoscope's own here.
  await expect(page.getByTestId('auto-presets')).toHaveCount(0);

  // Set up here, it belongs to the Logo Spectrum; the Kaleidoscope mode keeps its look.
  await page.getByTestId('scene-crystal').click();
  await expect.poll(async () => (await stored('visuals')).layerLook?.scene).toBe('crystal');
  await preset.selectOption('Frozen Mandala');
  await expect(page.getByRole('slider', { name: 'Star points' })).toBeVisible();
  expect((await stored('kaleido')).scene ?? 'vortex').toBe('vortex');
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await expect(page.getByTestId('scene-vortex')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('auto-presets')).toHaveCount(1);

  // Back in the Logo Spectrum, the Kaleidoscope behind is as it was set up.
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await expect(stage).toHaveAttribute('data-scene', 'logoSpectrum');
  await page.getByTestId('edit-behind').click();
  await expect(page.getByTestId('scene-crystal')).toHaveAttribute('aria-checked', 'true');
  await expect(preset).toHaveValue('Frozen Mandala');
  await page.getByRole('tab', { name: 'Logo Spectrum' }).click();
  await expect(preset).toHaveValue('');
  expect(errors).toEqual([]);
});

test('the display settings: resolution, auto-quality and reduce flashing (VE-06, VE-07)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByText('Display', { exact: true }).click();
  const settings = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('vibe-visualizer:settings:v1') ?? '{}'));

  // Half the resolution: the stage draws at half its pixels, and says so.
  await page.getByTestId('auto-quality').uncheck();
  await page.getByRole('slider', { name: 'Resolution', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(stage).toHaveAttribute('data-scale', '0.500');
  await expect(page.getByTestId('live-scale')).toContainText('Drawn at 50 %');
  await expect.poll(async () => (await settings()).renderScale).toBe(0.5);
  await expect.poll(async () => (await settings()).autoQuality).toBe(false);

  await page.getByTestId('reduce-flashing').check();
  await expect.poll(async () => (await settings()).reduceFlashing).toBe(true);
  await page.reload();
  await expect(stage).toHaveAttribute('data-scale', '0.500');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByText('Display', { exact: true }).click();
  await expect(page.getByTestId('reduce-flashing')).toBeChecked();
  expect(errors).toEqual([]);
});

/** Where the track overlay sits by default: at the bottom left. */
const OVERLAY_TEXT: Region = { x: 0.04, y: 0.78, width: 0.4, height: 0.18 };

test('the title fades in once, also right after the start (LS-18)', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'vibe-visualizer:settings:v1',
      JSON.stringify({ overlay: { on: true, fade: 1.5 } }),
    ),
  );
  await startWithClassicLook(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  const title = async () => (await measure(page, await stage.screenshot(), [OVERLAY_TEXT]))[0]!;

  // The settings kept from before are no change: no sample title shows after the start.
  for (let k = 0; k < 4; k++) {
    expect((await title()).bright).toBeLessThan(0.005);
    await page.waitForTimeout(200);
  }

  // A track played right away: its title comes up from nothing, and only once.
  await page.getByTestId('file-input').setInputFiles({
    name: 'tagged.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(30, { title: 'Sunrise', artist: 'The Testers' }),
  });
  const item = page.getByTestId('queue-item');
  await expect(item).toHaveAttribute('data-status', 'ready');
  await item.dblclick();
  const seen: number[] = [];
  for (let k = 0; k < 14; k++) {
    seen.push((await title()).bright);
    await page.waitForTimeout(150);
  }
  expect(seen[0], seen.join(' ')).toBeLessThan(0.005);
  const shown = seen.findIndex((bright) => bright > 0.01);
  expect(shown, seen.join(' ')).toBeGreaterThan(0);
  expect(Math.min(...seen.slice(shown)), seen.join(' ')).toBeGreaterThan(0.005);
  expect(errors).toEqual([]);
});

test('a track can be named, and the visuals show its title and cover art (LS-15, LS-18)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await startWithClassicLook(page);
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  const file = {
    name: 'tagged.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(30, { title: 'Sunrise', artist: 'The Testers', cover: COVER }),
  };
  await page.getByTestId('file-input').setInputFiles(file);
  const item = page.getByTestId('queue-item');
  await expect(item).toHaveAttribute('data-status', 'ready');
  await expect(item).toContainText('The Testers');

  // Named in the queue (✎): the queue, the transport and the overlay show the new name.
  await item.hover();
  await page.getByTestId('queue-rename').click();
  await expect(page.getByTestId('track-name-file')).toHaveText(
    'From the file: Sunrise · The Testers',
  );
  await page.getByTestId('track-name-title').fill('Sunrise (Radio Edit)');
  await page.getByTestId('track-name-artist').fill('');
  await page.getByTestId('track-name-save').click();
  await expect(item).toContainText('Sunrise (Radio Edit)');
  await expect(item).not.toContainText('The Testers');
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('now-title')).toHaveText('Sunrise (Radio Edit)');

  // The overlay: white text at the bottom left, where there was hardly any before.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const [before] = await measure(page, await stage.screenshot(), [OVERLAY_TEXT]);
  await page.getByText('Track info', { exact: true }).click();
  await page.getByTestId('overlay-on').check();
  await expect(page.getByTestId('overlay-now')).toHaveText('Sunrise (Radio Edit)');
  await expect
    .poll(async () => (await measure(page, await stage.screenshot(), [OVERLAY_TEXT]))[0]!.bright, {
      timeout: 10_000,
    })
    .toBeGreaterThan(before!.bright + 0.02);

  // The cover art as the logo.
  const quarters = logoQuarters((await stage.boundingBox())!);
  expect(showsCover(await measure(page, await stage.screenshot(), quarters))).toBe(false);
  await page.getByText('Logo', { exact: true }).click();
  await page.getByTestId('cover-logo').check();
  await expect
    .poll(async () => showsCover(await measure(page, await stage.screenshot(), quarters)), {
      timeout: 10_000,
    })
    .toBe(true);

  // The name is kept for the file: it comes back with it after a reload.
  await page.reload();
  await page.getByRole('tab', { name: 'Queue' }).click();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(item).toHaveAttribute('data-status', 'ready');
  await expect(item).toContainText('Sunrise (Radio Edit)');
  await item.hover();
  await page.getByTestId('queue-rename').click();
  await page.getByTestId('track-name-reset').click();
  await expect(item).toContainText('The Testers');
  expect(errors).toEqual([]);
});

test('the cover art turns like a record while the music plays (LS-16)', async ({ page }) => {
  const errors = collectErrors(page);
  await acknowledge(page);
  await startWithClassicLook(page);
  await page.addInitScript(() =>
    localStorage.setItem('vibe-visualizer:settings:v1', JSON.stringify({ coverLogo: true })),
  );
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  await page.getByTestId('file-input').setInputFiles({
    name: 'tagged.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(30, { title: 'Sunrise', artist: 'The Testers', cover: COVER }),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByText('Logo', { exact: true }).click();
  await page.getByTestId('logo-spin').selectOption({ label: '45 rpm' });

  // The colours of the cover's quarters, and how far they moved between two looks.
  const quarters = logoQuarters((await stage.boundingBox())!);
  const look = async () =>
    (await measure(page, await stage.screenshot(), quarters)).flatMap((quarter) => quarter.mean);
  const moved = (a: number[], b: number[]) =>
    a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0);
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(look).not.toEqual(Array(12).fill(0));
  // Playing, it turns (at 45 rpm, 80° in 0.3 s): seen within a few looks, however slowly a
  // busy machine draws.
  const a = await look();
  await expect.poll(async () => moved(a, await look()), { timeout: 10_000 }).toBeGreaterThan(150);
  // Paused, it stands.
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await page.waitForTimeout(800);
  const b = await look();
  await page.waitForTimeout(500);
  expect(moved(b, await look())).toBeLessThan(20);
  expect(errors).toEqual([]);
});
