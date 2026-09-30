import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createWav } from './wav';

// The welcome (tested in visuals.spec.ts) would cover the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function elapsed(page: Page): Promise<number> {
  return Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
}

/** Titles and levels while playing: the level meter (Live tab) shows what is analysed. */
async function listen(page: Page, milliseconds: number) {
  return page.evaluate(async (duration) => {
    const read = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    const samples: { title: string; peak: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push({
        title: read('now-title')?.textContent ?? '',
        peak: Number(read('level-meter')?.getAttribute('data-peak')),
      });
    }
    return samples;
  }, milliseconds);
}

/** The titles in the order they played, and the quietest moment in between (dBFS). */
function summarise(samples: { title: string; peak: number }[]) {
  const titles = samples
    .map((sample) => sample.title)
    .filter((title, index, all) => title !== 'Nothing playing' && title !== all[index - 1]);
  const first = samples.findIndex((sample) => sample.peak > -30);
  let last = first;
  samples.forEach((sample, index) => {
    if (sample.peak > -30) last = index;
  });
  const quietest = Math.min(...samples.slice(first, last + 1).map((sample) => sample.peak));
  return { titles, quietest };
}

test('waveform, hot cues and beat grid of a file, kept for the next visit (TR-03–05, TR-08, AN-07)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  // The beat grid of the whole file: a click every half second.
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM', { timeout: 15_000 });

  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('waveform-overview')).toBeVisible();
  await expect(page.getByTestId('detail-waveform')).toBeVisible();
  await expect.poll(() => elapsed(page), { timeout: 10_000 }).toBeGreaterThan(1);

  // Key 1 sets cue 1 at the playhead; later it jumps back there.
  const pads = page.getByTestId('cue-pad');
  await page.keyboard.press('1');
  await expect(pads.nth(0)).toHaveAttribute('data-set', 'true');
  await expect(page.getByTestId('cue-marker')).toHaveCount(1);
  await expect.poll(() => elapsed(page), { timeout: 10_000 }).toBeGreaterThan(3.5);
  await page.keyboard.press('1');
  await expect.poll(() => elapsed(page)).toBeLessThan(3);

  // A pad sets cue 2, Shift+2 deletes it.
  await pads.nth(1).click();
  await expect(page.getByTestId('cue-marker')).toHaveCount(2);
  await page.keyboard.press('Shift+Digit2');
  await expect(page.getByTestId('cue-marker')).toHaveCount(1);

  // W hides the detail waveform and shows it again.
  await page.keyboard.press('w');
  await expect(page.getByTestId('detail-waveform')).toHaveCount(0);
  await page.keyboard.press('w');
  await expect(page.getByTestId('detail-waveform')).toBeVisible();

  // After a reload the entry is still there; the file comes back with its cue.
  await page.reload();
  const item = page.getByTestId('queue-item');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('data-status', 'missing');
  await expect(page.getByTestId('queue-missing')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('queue-missing')).toHaveCount(0);
  await expect(page.getByTestId('cue-marker')).toHaveCount(1);
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM');
  expect(errors).toEqual([]);
});

test('tracks follow each other without a gap, also at another sample rate (PL-05, PL-04)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'One.wav', mimeType: 'audio/wav', buffer: createWav(2.5, 44100) },
    { name: 'Two.wav', mimeType: 'audio/wav', buffer: createWav(2, 48000) },
  ]);
  await expect(page.getByTestId('queue-item').nth(1)).toHaveAttribute('data-status', 'ready');
  // Repeat the queue: One, Two, One …
  await page.getByTestId('repeat').click();
  await expect(page.getByTestId('repeat')).toHaveAttribute('data-mode', 'all');
  await page.getByRole('tab', { name: /Live/ }).click();
  await page.getByTestId('play-button').click();
  const { titles, quietest } = summarise(await listen(page, 6000));
  expect(titles).toEqual(['One', 'Two', 'One']);
  // The tone plays at −12 dBFS; a gap would show as silence (−60).
  expect(quietest).toBeGreaterThan(-30);
  expect(errors).toEqual([]);
});

test('a track played before plays again while the next one plays', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'One.wav', mimeType: 'audio/wav', buffer: createWav(6, 44100) },
    { name: 'Two.wav', mimeType: 'audio/wav', buffer: createWav(6, 48000) },
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items.nth(1)).toHaveAttribute('data-status', 'ready');
  const title = page.getByTestId('now-title');
  await items.nth(0).dblclick();
  await expect(title).toHaveText('One');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(0.5);
  await items.nth(1).dblclick();
  await expect(title).toHaveText('Two');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(0.5);
  // Back to the first file while the second plays (Firefox once failed to read it again).
  await items.nth(0).dblclick();
  await expect(title).toHaveText('One');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(0.5);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('shuffle plays every track once, then stops (PL-04)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(
    ['A', 'B', 'C'].map((name) => ({
      name: `${name}.wav`,
      mimeType: 'audio/wav',
      buffer: createWav(1.5),
    })),
  );
  await expect(page.getByTestId('queue-item').nth(2)).toHaveAttribute('data-status', 'ready');
  await page.keyboard.press('s');
  await expect(page.getByTestId('shuffle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: /Live/ }).click();
  await page.getByTestId('play-button').click();
  const { titles, quietest } = summarise(await listen(page, 6000));
  expect([...titles].sort()).toEqual(['A', 'B', 'C']);
  expect(quietest).toBeGreaterThan(-30);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  expect(errors).toEqual([]);
});

test('a folder is read with its subfolders, in natural order (SRC-03)', async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const album = testInfo.outputPath('Album');
  for (const [path, seconds] of [
    ['CD 1/10 Ten.wav', 1],
    ['CD 1/9 Nine.wav', 1],
    ['CD 2/1 One.wav', 1],
  ] as const) {
    mkdirSync(join(album, path, '..'), { recursive: true });
    writeFileSync(join(album, path), createWav(seconds));
  }
  writeFileSync(join(album, 'cover.jpg'), 'not audio');
  await page.goto('/');
  await page.getByTestId('folder-input').setInputFiles(album);
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('9 Nine');
  await expect(items.nth(1)).toContainText('10 Ten');
  await expect(items.nth(2)).toContainText('1 One');
  expect(errors).toEqual([]);
});

test('? shows the shortcuts and the help, and the A/V sync offset is kept (UI-04, UI-11, AN-06)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.keyboard.press('Shift+Slash');
  const help = page.getByTestId('help');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Jump to a hot cue');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // The ? in the top bar opens the user guide; its sections come from docs/USER-GUIDE.md.
  await page.getByTestId('shortcuts-button').click();
  await expect(help).toBeVisible();
  const content = page.getByTestId('help-content');
  await expect(content).toHaveAttribute('data-section', 'keyboard-shortcuts');
  await page.getByTestId('help-nav-beat-grid-and-tempo').click();
  await expect(content).toContainText('For drum & bass choose 120–200');
  await page.getByTestId('help-nav-about').click();
  await expect(page.getByTestId('help-bug')).toHaveAttribute('href', /^mailto:fipreroll\+app@/);
  await page.getByTestId('help-welcome').click();
  await expect(help).toBeHidden();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('welcome-help').click();
  await expect(help).toBeVisible();
  await expect(content).toHaveAttribute('data-section', 'getting-started');
  await page.keyboard.press('Escape');

  // V: the next visual mode.
  await page.keyboard.press('v');
  await expect(page.getByRole('button', { name: 'Kaleidoscope' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('tab', { name: /Visuals/ }).click();
  await page.locator('summary', { hasText: 'A/V sync' }).click();
  await page.getByTestId('sync-calibrate').click();
  const dialog = page.getByTestId('sync-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('sync-reported')).toContainText('output latency');
  for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: '+10 ms' }).click();
  await expect(dialog.getByLabel('Visuals later by')).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByRole('tab', { name: /Visuals/ }).click();
  await page.locator('summary', { hasText: 'A/V sync' }).click();
  const section = page.locator('details', { hasText: 'A/V sync' });
  await expect(section.getByLabel('Visuals later by')).toHaveValue('30');
  expect(errors).toEqual([]);
});
