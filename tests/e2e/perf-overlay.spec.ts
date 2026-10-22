import { expect, test } from '@playwright/test';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

test('without ?perf the app measures nothing and shows no measurements', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toBeVisible();
  await expect(page.getByTestId('perf-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => '__perf' in window)).toBe(false);
});

test('with ?perf the measurements show, can start anew and be copied', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?perf');
  const overlay = page.getByTestId('perf-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId('perf-playhead')).toHaveText('not playing');

  await page.getByTestId('file-input').setInputFiles({
    name: 'Music.wav',
    mimeType: 'audio/wav',
    buffer: createWav(20, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  // The frames of the page and how evenly the playhead moves on.
  await expect(page.getByTestId('perf-fps')).toHaveText(/^\d+ fps$/);
  await expect(page.getByTestId('perf-frames')).toContainText('late');
  await expect(page.getByTestId('perf-playhead')).toContainText('off by', { timeout: 10_000 });

  // Reset starts the measurement anew.
  const since = () =>
    page.evaluate(
      () => (window as { __perf?: { snapshot(): { seconds: number } } }).__perf!.snapshot().seconds,
    );
  await page.waitForTimeout(1500);
  expect(await since()).toBeGreaterThan(1.5);
  await page.getByTestId('perf-reset').click();
  expect(await since()).toBeLessThan(1);

  // Copy: all of it as JSON, for a bug report.
  await page.getByTestId('perf-copy').click();
  await expect(page.getByTestId('perf-copy')).toHaveText('Copied');
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
    version: string;
    lastTenSeconds: { frames: { count: number } };
    recentFrames: number[];
  };
  expect(copied.version).toMatch(/^0\.9\./);
  expect(copied.lastTenSeconds.frames.count).toBeGreaterThan(0);
  expect(copied.recentFrames.length).toBeGreaterThan(0);

  // It folds away.
  await overlay.getByRole('button', { name: /Performance/ }).click();
  await expect(page.getByTestId('perf-frames')).toHaveCount(0);
  await expect(page.getByTestId('perf-fps')).toBeVisible();
});
