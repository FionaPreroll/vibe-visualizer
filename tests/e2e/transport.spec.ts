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

/** The playback position on every frame, for `milliseconds` (a poll could miss short moments). */
async function positions(page: Page, milliseconds: number): Promise<number[]> {
  return page.evaluate(async (duration) => {
    const read = () =>
      Number(document.querySelector('[data-testid="elapsed"]')?.getAttribute('data-seconds'));
    const samples: number[] = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(read());
    }
    return samples;
  }, milliseconds);
}

/** Two tracks with a click every half second; A gets markers at 5 s and 10 s (not snapped). */
async function markedQueue(page: Page) {
  await page.getByTestId('file-input').setInputFiles([
    { name: 'A.wav', mimeType: 'audio/wav', buffer: createWav(14) },
    { name: 'B.wav', mimeType: 'audio/wav', buffer: createWav(6) },
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items.nth(1)).toHaveAttribute('data-status', 'ready');
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(page.getByTestId('now-title')).toHaveText('A');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await page.getByTestId('quantize').click();
  await page.getByTestId('timeline').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => elapsed(page)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(4.9);
  await page.keyboard.press('i');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(9.9);
  await page.keyboard.press('o');
  await expect(page.getByTestId('marks')).toContainText('0:05–0:10');
  await expect(page.getByTestId('marks-length')).toContainText('0:05');
  return items;
}

test('a track plays between its markers, and the queue moves on at the out marker', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const items = await markedQueue(page);
  // Played from the queue, the track starts at its in marker (it was paused at 10 s)…
  await items.nth(0).dblclick();
  await expect.poll(() => elapsed(page)).toBeLessThan(7);
  expect(await elapsed(page)).toBeGreaterThan(4.9);
  // …and the next one follows at the out marker, 5 s later.
  await expect(page.getByTestId('now-title')).toHaveText('B', { timeout: 8000 });
  await expect.poll(() => elapsed(page)).toBeLessThan(1.5);

  // Repeat one loops the range.
  await page.getByTestId('repeat').click();
  await page.getByTestId('repeat').click();
  await expect(page.getByTestId('repeat')).toHaveAttribute('data-mode', 'one');
  await items.nth(0).dblclick();
  await expect.poll(() => elapsed(page)).toBeLessThan(7);
  // Up to the out marker, then back to the in marker.
  const samples = await positions(page, 8000);
  const top = samples.findIndex((seconds) => seconds > 9.5);
  expect(top).toBeGreaterThan(-1);
  expect(samples.slice(top).some((seconds) => seconds < 6)).toBe(true);
  expect(Math.max(...samples)).toBeLessThan(10.2);
  await expect(page.getByTestId('now-title')).toHaveText('A');
  expect(errors).toEqual([]);
});

test('markers snap to the beat, can be dragged and nudged, and clearing them can be undone', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await markedQueue(page);
  await page.getByTestId('quantize').click();
  await expect(page.getByTestId('quantize')).toHaveAttribute('aria-pressed', 'true');

  // Drag the out marker to about 2/3 of the 14 s track: it snaps to the beat at 9.5 s.
  const timeline = (await page.getByTestId('timeline').boundingBox())!;
  const handle = (await page.getByTestId('mark-out').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(timeline.x + timeline.width * (9.55 / 14), handle.y + 4, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('mark-out')).toHaveAttribute('aria-valuetext', '0:09');
  const dragged = Number(await page.getByTestId('mark-out').getAttribute('aria-valuenow'));
  expect(dragged).toBe(9);

  // → on the focused marker: one beat later (10 s).
  await page.getByTestId('mark-out').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('mark-out')).toHaveAttribute('aria-valuetext', '0:10');

  // Clearing both markers offers an undo.
  await page.getByTestId('marks').click();
  await expect(page.getByTestId('marks')).toHaveCount(0);
  await expect(page.getByTestId('undo-toast')).toContainText('Cleared the markers');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('marks')).toContainText('0:05–0:10');
  expect(errors).toEqual([]);
});

test('removing a track and clearing the queue can be undone', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(
    ['One', 'Two', 'Three'].map((name) => ({
      name: `${name}.wav`,
      mimeType: 'audio/wav',
      buffer: createWav(2),
    })),
  );
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(3);
  await items.nth(1).hover();
  await items
    .nth(1)
    .getByRole('button', { name: /Remove/ })
    .click();
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId('undo-toast')).toContainText('Removed “Two”');
  await page.getByTestId('undo').click();
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText('Two');

  await page.getByRole('button', { name: 'Clear queue' }).click();
  await expect(items).toHaveCount(0);
  await page.getByTestId('visual-stage').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(items).toHaveCount(3);
  await expect(items.nth(2)).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the app can be renamed, and keeps its name', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('FibeStation');
  await expect(page.getByTestId('app-name')).toHaveText('FibeStation');
  await page.getByTestId('app-name').dblclick();
  await page.getByTestId('app-name-input').fill('Night Shift Visuals');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('app-name')).toHaveText('Night Shift Visuals');
  await expect(page).toHaveTitle('Night Shift Visuals');
  await page.reload();
  await expect(page.getByTestId('app-name')).toHaveText('Night Shift Visuals');
  // Escape keeps the name; an empty one goes back to the default.
  await page.getByTestId('app-name').dblclick();
  await page.getByTestId('app-name-input').fill('Something else');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('app-name')).toHaveText('Night Shift Visuals');
  await page.getByTestId('app-name').dblclick();
  await page.getByTestId('app-name-input').fill(' ');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('app-name')).toHaveText('FibeStation');
  // The Spike Lab is for development: built apps have no link to it.
  await expect(page.getByRole('link', { name: 'Spike Lab' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Space plays and pauses also after a click on a button, a slider or a track', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'A.wav',
    mimeType: 'audio/wav',
    buffer: createWav(20),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  const toggles = async (label: 'Play' | 'Pause') => {
    await page.keyboard.press('Space');
    await expect(play).toHaveAttribute('aria-label', label);
  };

  // A button clicked with the mouse lets go of the focus: Space does not press it again.
  const shuffle = page.getByTestId('shuffle');
  await shuffle.click();
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  await expect(shuffle).not.toBeFocused();
  await toggles('Play');
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  await toggles('Pause');

  // A slider keeps the arrows, not Space.
  const volume = page.getByLabel('Volume');
  await volume.click();
  await expect(volume).toBeFocused();
  await toggles('Play');
  const level = await volume.inputValue();
  await page.keyboard.press('ArrowLeft');
  await expect(volume).not.toHaveValue(level);

  // A track in the queue, and a checkbox in a panel.
  await page.getByTestId('queue-item').click();
  await toggles('Pause');
  await page.getByRole('tab', { name: /Sound/ }).click();
  const delay = page.getByTestId('delay-on');
  await delay.click();
  await expect(delay).toBeChecked();
  await toggles('Play');
  await expect(delay).toBeChecked();

  // Reached with Tab, a button still takes Enter; Space stays play and pause.
  await shuffle.focus();
  await page.keyboard.press('Enter');
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
  await toggles('Pause');
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
