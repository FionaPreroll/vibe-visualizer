import { expect, test, type Page } from '@playwright/test';
import { createWav } from '../e2e/wav';

const MINUTES = Number(process.env['SOAK_MINUTES'] ?? 30);
/** Minutes to settle (shaders, caches, the analysis of the track) before the baseline. */
const WARM_UP = 3;
/** How much the memory may grow after the warm-up, for the noise of the garbage collector. */
const MAX_GROWTH_MB = 40;

/** The memory of the page and its workers (MB). */
async function memory(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const result = await (
      performance as Performance & {
        measureUserAgentSpecificMemory(): Promise<{ bytes: number }>;
      }
    ).measureUserAgentSpecificMemory();
    return result.bytes / 2 ** 20;
  });
}

test('the app plays for a long time, and its memory stays flat (NF-06)', async ({ page }) => {
  expect(MINUTES, 'SOAK_MINUTES').toBeGreaterThan(WARM_UP);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });

  // Some music, again and again, with the presets switching every 5 s.
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(47, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  const repeat = page.getByTestId('repeat');
  while ((await repeat.getAttribute('data-mode')) !== 'one') await repeat.click();
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByText('Preset switching', { exact: true }).click();
  await page.getByTestId('auto-presets').check();
  await page
    .getByRole('radiogroup', { name: 'Switch every' })
    .getByRole('radio', { name: 'Seconds' })
    .click();
  await page.getByRole('slider', { name: 'Seconds', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');

  // Each minute the next view (V): the Logo Spectrum, the Kaleidoscope, the analysis. The
  // stage stops its render worker for the analysis, and starts a new one after it.
  const samples: { minute: number; megabytes: number; workers: number; fps: number }[] = [];
  const elapsed = page.getByTestId('elapsed');
  for (let minute = 1; minute <= MINUTES; minute++) {
    await page.waitForTimeout(58_000);
    // Still playing: the position moves on.
    const position = Number(await elapsed.getAttribute('data-seconds'));
    await page.waitForTimeout(2000);
    expect(Number(await elapsed.getAttribute('data-seconds')), `minute ${minute}`).not.toBe(
      position,
    );
    const stage = page.getByTestId('visual-stage');
    const fps = (await stage.count()) > 0 ? Number(await stage.getAttribute('data-fps')) : NaN;
    const sample = {
      minute,
      megabytes: Math.round(await memory(page)),
      workers: page.workers().length,
      fps,
    };
    samples.push(sample);
    console.log(
      `minute ${minute}: ${sample.megabytes} MB, ${sample.workers} workers, ${fps.toFixed(0)} fps`,
    );
    await page.locator('body').press('v');
  }

  // After the warm-up, the memory stays flat and no worker is left behind.
  const baseline = samples[WARM_UP - 1]!;
  const peak = Math.max(...samples.slice(WARM_UP).map((sample) => sample.megabytes));
  expect(peak - baseline.megabytes, 'growth after the warm-up (MB)').toBeLessThan(MAX_GROWTH_MB);
  for (const sample of samples.slice(WARM_UP)) {
    expect(sample.workers, `workers in minute ${sample.minute}`).toBeLessThanOrEqual(
      baseline.workers + 1,
    );
  }
  expect(errors).toEqual([]);
});
