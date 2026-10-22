import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWav } from '../e2e/wav';

/**
 * Measures the app in a few scenarios with `?perf` (see src/ui/perf.ts) and writes, per
 * scenario, what it measured as `<label>-r<round>-<scenario>.json` to PERF_OUT, and a Chromium
 * trace next to it (open it in Chrome's DevTools, Performance tab, or at ui.perfetto.dev). The
 * numbers do not fail the tests: tests/perf/report.ts compares them. A build without `?perf`
 * (an older base) gives the export's time only.
 */
const OUT = process.env['PERF_OUT'] ?? 'perf-results';
const LABEL = process.env['PERF_LABEL'] ?? 'head';
const ROUND = process.env['PERF_ROUND'] ?? '1';
const SECONDS = Number(process.env['PERF_SECONDS'] ?? 10);
/**
 * Traces are large, and tracing slows the page down (a long frame as it starts): PERF_TRACE=0
 * leaves them out. The report takes its numbers from the rounds without a trace, where there are.
 */
const TRACE = process.env['PERF_TRACE'] !== '0';

mkdirSync(OUT, { recursive: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:welcome:v1', '1');
    // Headless browsers cannot show the save dialogs: the videos are downloaded instead.
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

/** Opens the app with `?perf` and adds a track of `seconds`. */
async function open(page: Page, seconds: number): Promise<void> {
  await page.goto('/?perf');
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 30_000,
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'Music.wav',
    mimeType: 'audio/wav',
    buffer: createWav(seconds, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
}

async function play(page: Page): Promise<void> {
  const button = page.getByTestId('play-button');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Pause');
  // Shaders, caches and the analysis of the track settle first.
  await page.waitForTimeout(2000);
}

/** Measures what `during` does as `scenario`, and writes it down; `extra` adds own numbers. */
async function record(
  page: Page,
  browser: Browser,
  scenario: string,
  during: () => Promise<Record<string, number> | void>,
): Promise<void> {
  const name = `${LABEL}-r${ROUND}-${scenario}`;
  await page.evaluate(() => (window as { __perf?: { reset(): void } }).__perf?.reset());
  if (TRACE) await browser.startTracing(page, { path: join(OUT, `${name}.trace.json`) });
  const started = Date.now();
  const extra = (await during()) ?? {};
  const wallSeconds = (Date.now() - started) / 1000;
  if (TRACE) await browser.stopTracing();
  const snapshot = await page.evaluate(
    () => (window as { __perf?: { snapshot(): unknown } }).__perf?.snapshot() ?? null,
  );
  const result = {
    scenario,
    label: LABEL,
    round: Number(ROUND),
    traced: TRACE,
    wallSeconds,
    extra,
    snapshot,
  };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(result, null, 2));
}

test('logo-spectrum: plays with the Logo Spectrum and the detail waveform', async ({
  page,
  browser,
}) => {
  await open(page, SECONDS + 20);
  await play(page);
  await record(page, browser, 'logo-spectrum', () => page.waitForTimeout(SECONDS * 1000));
});

test('kaleidoscope: plays with the Kaleidoscope', async ({ page, browser }) => {
  await open(page, SECONDS + 20);
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await play(page);
  await record(page, browser, 'kaleidoscope', () => page.waitForTimeout(SECONDS * 1000));
});

test('detail-2s: plays with the detail waveform zoomed in to 2 s', async ({ page, browser }) => {
  await open(page, SECONDS + 20);
  await play(page);
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  while (await zoomIn.isEnabled()) await zoomIn.click();
  await expect(page.getByTestId('detail-span')).toHaveText('2 s');
  await record(page, browser, 'detail-2s', () => page.waitForTimeout(SECONDS * 1000));
});

test('export-draft: exports a track as a draft', async ({ page, browser }) => {
  const trackSeconds = 8;
  await open(page, trackSeconds);
  await page.getByTestId('export-button').click();
  await page.getByText('Draft, quick to check', { exact: true }).click();
  await expect(page.getByTestId('export-start')).toBeEnabled();
  await record(page, browser, 'export-draft', async () => {
    const started = Date.now();
    await page.getByTestId('export-start').click();
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 240_000 });
    const seconds = (Date.now() - started) / 1000;
    // Seconds of video made per second.
    return { exportSeconds: seconds, videoPerSecond: trackSeconds / seconds };
  });
});
