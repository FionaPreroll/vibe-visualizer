import { expect, test, type Page } from '@playwright/test';
import { measure } from './pixels';
import { createPng } from './png';
import { createTaggedWav, createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openKaleidoscope(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  return stage;
}

test('Kaleidoscope renders, moves with the music and switches scenes and modes', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(10, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const first = await stage.screenshot();
  await page.waitForTimeout(700);
  expect(first.equals(await stage.screenshot())).toBe(false);

  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByTestId('scene-crystal').click();
  await expect(page.getByTestId('scene-crystal')).toHaveAttribute('aria-checked', 'true');
  const crystal = await stage.screenshot();
  await page.waitForTimeout(700);
  expect(crystal.equals(await stage.screenshot())).toBe(false);

  // Neon Ribbons (KA-04): its own controls, and it moves too.
  await page.getByTestId('scene-ribbons').click();
  await expect(page.getByTestId('scene-ribbons')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('preset-select')).toHaveValue('Neon Ribbons');
  await expect(page.getByRole('slider', { name: 'Ribbons', exact: true })).toHaveValue('4');
  await expect(page.getByRole('slider', { name: 'Lobes', exact: true })).toHaveValue('5');
  const ribbons = await stage.screenshot();
  await page.waitForTimeout(700);
  expect(ribbons.equals(await stage.screenshot())).toBe(false);
  await expect(stage).toHaveAttribute('data-status', 'running');

  // Logo Spectrum and back: the same render worker keeps running.
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await expect(stage).toHaveAttribute('data-scene', 'logoSpectrum');
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await expect(stage).toHaveAttribute('data-status', 'running');
  expect(errors).toEqual([]);
});

test('the spin turns a round picture: no edge of a frame-shaped buffer turns into view', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  // The Vortex at the fastest spin: a turn in 6 s.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByRole('slider', { name: 'Spin', exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByTestId('play-button').click();
  await page.waitForTimeout(2000);

  // Left and right of the core, where the Vortex's strands reach. A buffer of the frame's shape
  // (wider than high) left both black whenever the spin turned it upright.
  const sides = [
    { x: 0.06, y: 0.35, width: 0.12, height: 0.3 },
    { x: 0.82, y: 0.35, width: 0.12, height: 0.3 },
  ];
  const seen: string[] = [];
  const start = Date.now();
  while (Date.now() - start < 6000) {
    const [left, right] = await measure(page, await stage.screenshot(), sides);
    const level = (region: typeof left) =>
      (region!.mean[0] + region!.mean[1] + region!.mean[2]) / 3;
    seen.push(`${level(left).toFixed(1)}/${level(right).toFixed(1)}`);
    expect(Math.max(level(left), level(right)), seen.join(' ')).toBeGreaterThan(1);
    await page.waitForTimeout(150);
  }
  expect(errors).toEqual([]);
});

test('Kaleidoscope controls come from the scene specs and survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await openKaleidoscope(page);
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  await expect(preset).toHaveValue('Vortex');
  await expect(page.getByRole('slider', { name: 'Arms' })).toBeVisible();

  // Each scene brings its own controls.
  await page.getByTestId('scene-crystal').click();
  await expect(page.getByRole('slider', { name: 'Star points' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Arms' })).toHaveCount(0);
  await expect(preset).toHaveValue('Crystal Mandala');

  const segments = page.getByRole('slider', { name: 'Segments' });
  await segments.focus();
  await page.keyboard.press('ArrowRight');
  await expect(segments).toHaveValue('9');
  await expect(preset).toHaveValue('');

  // Your own colours: five colour stops.
  await page.getByRole('radio', { name: 'custom' }).click();
  await expect(page.getByLabel(/Your colours: colour/)).toHaveCount(5);

  await page.reload();
  await expect(page.getByTestId('scene-crystal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Segments' })).toHaveValue('9');
  await expect(page.getByLabel(/Your colours: colour/)).toHaveCount(5);

  await preset.selectOption('Aurora Spiral');
  await expect(page.getByTestId('scene-vortex')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Segments' })).toHaveValue('6');
  await page.getByRole('button', { name: 'Reset Vortex' }).click();
  await expect(preset).toHaveValue('Vortex');
  expect(errors).toEqual([]);
});

test('the colours can come from the cover art of the track playing (VE-12)', async ({ page }) => {
  const errors = collectErrors(page);
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Blue.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(30, {
      title: 'Blue',
      artist: 'The Testers',
      cover: createPng(32, 32, () => [30, 70, 235]),
    }),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // The mean colour of the picture: the Vortex's palette has no blue to speak of.
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const blueness = async () => {
    const [region] = await measure(page, await stage.screenshot(), [whole]);
    const [red, green, blue] = region!.mean;
    return blue - Math.max(red, green);
  };
  await page.waitForTimeout(1500);
  expect(await blueness()).toBeLessThan(0);

  // With the colours of the cover: blue, and the look's own again without them.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const option = page.getByTestId('cover-colors');
  await option.check();
  await expect(page.getByTestId('cover-colors-hint')).toBeVisible();
  await expect.poll(blueness, { timeout: 10_000 }).toBeGreaterThan(5);
  await option.uncheck();
  await expect.poll(blueness, { timeout: 10_000 }).toBeLessThan(0);
  expect(errors).toEqual([]);
});
