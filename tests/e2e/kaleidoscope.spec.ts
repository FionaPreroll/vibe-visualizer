import { expect, test, type Page } from '@playwright/test';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:photosensitivity-ack', '1'));
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

  // Logo Spectrum and back: the same render worker keeps running.
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await expect(stage).toHaveAttribute('data-scene', 'logoSpectrum');
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await expect(stage).toHaveAttribute('data-status', 'running');
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
