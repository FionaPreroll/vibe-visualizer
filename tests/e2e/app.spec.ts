import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { elapsed, shown, speed } from './time';
import { createTaggedWav, createWav } from './wav';

// The welcome (tested in visuals.spec.ts) would cover the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('the app starts in this browser, which has all it needs (NF-02) @firefox', async ({
  page,
}) => {
  await page.goto('/');
  // What the browser offers of what the app needs: a failure says what is missing.
  const offers = await page.evaluate(() => {
    const webgl2 = (canvas: OffscreenCanvas | HTMLCanvasElement) => {
      try {
        return canvas.getContext('webgl2') !== null;
      } catch {
        return false;
      }
    };
    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      audioWorklet: typeof AudioWorkletNode === 'function',
      offscreenCanvas: typeof OffscreenCanvas === 'function',
      webgl2Offscreen: typeof OffscreenCanvas === 'function' && webgl2(new OffscreenCanvas(1, 1)),
      webgl2Canvas: webgl2(document.createElement('canvas')),
      unsupported: document.querySelector('[data-testid="unsupported"]')?.textContent ?? null,
    };
  });
  expect(offers.unsupported, JSON.stringify(offers)).toBeNull();
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });
});

async function addFiles(page: Page, firstSeconds = 4) {
  await page.getByTestId('file-input').setInputFiles([
    { name: 'First.wav', mimeType: 'audio/wav', buffer: createWav(firstSeconds, 44100) },
    { name: 'Second.wav', mimeType: 'audio/wav', buffer: createWav(3, 48000) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') },
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute('data-status', 'ready');
  await expect(items.nth(1)).toHaveAttribute('data-status', 'ready');
  await expect(items.nth(2)).toHaveAttribute('data-status', 'unsupported');
  return items;
}

test('queue: adds files, reports unsupported ones, reorders and removes', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const items = await addFiles(page);
  await expect(items.nth(0).getByTestId('queue-duration')).toHaveText('0:04');
  await expect(items.nth(2)).toContainText('unknown file format');

  // Keyboard reorder: Alt+ArrowDown moves the focused track down.
  await items.nth(0).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(items.nth(0)).toContainText('Second');
  await expect(items.nth(1)).toContainText('First');

  // Drag and drop reorder.
  await items.nth(1).dragTo(items.nth(0), { targetPosition: { x: 20, y: 5 } });
  await expect(items.nth(0)).toContainText('First');

  await items.nth(2).hover();
  await items
    .nth(2)
    .getByRole('button', { name: /Remove/ })
    .click();
  await expect(items).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('queue: a title takes most of its row, and a file without tags is named once', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const title = 'FibeStation Demo Mix (Extended Version)';
  const artist = 'The Very Long Artist Name Collective';
  await page.getByTestId('file-input').setInputFiles([
    { name: 'tagged.wav', mimeType: 'audio/wav', buffer: createTaggedWav(4, { title, artist }) },
    { name: 'Without tags.wav', mimeType: 'audio/wav', buffer: createWav(3) },
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items.nth(1)).toHaveAttribute('data-status', 'ready');
  // The duration ends the title's line instead of a column of its own, and the buttons show in
  // its place only while the row is pointed at: the title has more than half of the row.
  const share = await items
    .nth(0)
    .evaluate(
      (row) =>
        row.querySelector('.title')!.getBoundingClientRect().width /
        row.getBoundingClientRect().width,
    );
  expect(share).toBeGreaterThan(0.5);
  // Cut short in the row, in full in the tooltip, with the file.
  await expect(items.nth(0)).toHaveAttribute('title', `${title} – ${artist}\ntagged.wav`);
  // Without tags, the file names the track: it is not repeated as the artist.
  await expect(items.nth(1).locator('.title')).toHaveText('Without tags');
  await expect(items.nth(1).locator('.artist')).toHaveText('');
  expect(errors).toEqual([]);
});

test('queue: scrolls while a track is dragged to its edge, so it can go far (PL-03) @firefox', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/');
  const wav = createWav(1, 44100);
  await page.getByTestId('file-input').setInputFiles(
    Array.from({ length: 30 }, (_, k) => ({
      name: `Track ${String(k + 1).padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: wav,
    })),
  );
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(30);
  const list = page.getByTestId('queue-list');
  /** How far the list is from its end (pixels). */
  const toEnd = () =>
    list.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  expect(await toEnd()).toBeGreaterThan(1000);

  // The first track, held over the tracks at the bottom of the list: the list scrolls on to its
  // end, under the resting pointer.
  const from = (await items.nth(0).boundingBox())!;
  const box = (await list.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  const bottom = box.y + box.height - 30;
  await page.mouse.move(from.x + 40, bottom, { steps: 8 });
  // The pointer rests; a little wiggle keeps the drag events coming as they do in a browser.
  for (let k = 0; k < 120 && (await toEnd()) > 1; k++) {
    await page.mouse.move(from.x + 40 + (k % 2), bottom);
    await page.waitForTimeout(50);
  }
  expect(await toEnd()).toBeLessThanOrEqual(1);
  // Let go there, over the lower half of the last track: it goes to the end of the queue. (A
  // last move, and a moment for the drag to take it, as a hand gives it.)
  await page.mouse.move(from.x + 40, bottom);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(items.nth(0)).toContainText('Track 02');
  await expect(items.nth(29)).toContainText('Track 01');
  expect(errors).toEqual([]);
});

test('playback: plays, seeks, shows the analysis and moves on to the next track @firefox', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addFiles(page, 8);

  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('now-title')).toHaveText('First');
  await expect.poll(() => elapsed(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByTestId('analysis-view')).toHaveAttribute('data-active', 'true');
  const queue = page.getByRole('listbox', { name: 'Queue tracks' });
  await expect(queue.getByRole('option', { selected: true })).toContainText('First');

  // Seek by clicking at 50 % of the timeline (8 s track → 4 s): far ahead of the playhead, and
  // far from the end, even on a slow machine.
  const box = (await page.getByTestId('timeline').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(() => elapsed(page)).toBeGreaterThan(3.9);

  // The 44.1 kHz file plays at the right speed on the 48 kHz engine. (Measured in the page: on
  // a busy machine the time shown follows late, as frames do.)
  const rate = await speed(page, 1000);
  expect(rate).toBeGreaterThan(0.85);
  expect(rate).toBeLessThan(1.15);

  // At the end of the track the next one starts (the unsupported file is skipped).
  await expect(page.getByTestId('now-title')).toHaveText('Second', { timeout: 10_000 });
  await expect.poll(() => elapsed(page), { timeout: 10_000 }).toBeGreaterThan(0.2);

  // Space pauses.
  await page.locator('body').press(' ');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  const paused = await shown(page);
  await page.waitForTimeout(500);
  expect(await shown(page)).toBeCloseTo(paused, 1);
  expect(errors).toEqual([]);
});

test('settings survive a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByTestId('visual-stage')).toHaveCount(0);
  await expect(page.getByTestId('analysis-view')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analysis' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('analysis-view')).toBeVisible();
});

test('the side panel is made wider or narrower by its edge, also with the keys, and keeps it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const panel = page.locator('aside.panel');
  const stage = page.getByRole('main', { name: 'Visual stage' });
  const edge = page.getByTestId('panel-edge');
  const width = async () => Math.round((await panel.boundingBox())!.width);
  const drag = async (by: number) => {
    const box = (await edge.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + 200];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + by, y, { steps: 5 });
    await page.mouse.up();
  };
  expect(await width()).toBe(360);
  // To the left, wider: the stage gives the room.
  await drag(-100);
  await expect.poll(width).toBe(460);
  expect(Math.round((await stage.boundingBox())!.width)).toBe(1440 - 460);
  // Not wider than 560, nor narrower than 300.
  await drag(-300);
  await expect.poll(width).toBe(560);
  await drag(400);
  await expect.poll(width).toBe(300);
  // The arrow keys move the edge, and do not seek; End: the widest.
  await edge.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(width).toBe(320);
  await expect(edge).toHaveAttribute('aria-valuenow', '320');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect.poll(width).toBe(540);
  // The panel keeps its width, and a double-click gives it its usual one.
  await page.reload();
  await expect.poll(width).toBe(540);
  await edge.dblclick();
  await expect.poll(width).toBe(360);
  expect(errors).toEqual([]);
});

test('in a narrow window the side panel lies over the stage, and closes with Escape or a click beside it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  const panel = page.locator('aside.panel');
  const stage = page.getByRole('main', { name: 'Visual stage' });
  const toggle = page.getByRole('button', { name: 'Side panel' });
  await expect(panel).toBeVisible();
  // The stage keeps the width of the window; the panel lies over its right side.
  expect(Math.round((await stage.boundingBox())!.width)).toBe(1000);
  const over = (await panel.boundingBox())!;
  expect(Math.round(over.x + over.width)).toBe(1000);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel).toBeVisible();
  await stage.click({ position: { x: 100, y: 100 } });
  await expect(panel).toBeHidden();
  // In a wide window it stands beside the stage, and stays.
  await page.setViewportSize({ width: 1440, height: 900 });
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await stage.click({ position: { x: 100, y: 100 } });
  await expect(panel).toBeVisible();
  expect(Math.round((await stage.boundingBox())!.width)).toBe(1440 - 360);
  expect(errors).toEqual([]);
});
