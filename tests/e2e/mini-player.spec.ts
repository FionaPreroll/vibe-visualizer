import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectMotion } from './pixels';
import { moreAction, openMore } from './topbar';
import { createWav } from './wav';

/**
 * The mini player (DS-06), in a real Document Picture-in-Picture window: headless Chromium opens
 * them, and Playwright sees each as a page of its own.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function playTrack(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(60, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
}

/** Opens the mini player with `open`, and gives its window, 4:3 like no aspect ratio of the app. */
async function openMiniPlayer(context: BrowserContext, open: () => Promise<void>): Promise<Page> {
  const opened = context.waitForEvent('page');
  await open();
  const mini = await opened;
  await mini.setViewportSize({ width: 480, height: 360 });
  await expect(mini.getByTestId('visual-stage')).toBeVisible();
  return mini;
}

test('the mini player shows the visuals in a window of their own (DS-06)', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await playTrack(page);
  const mini = await openMiniPlayer(context, () => moreAction(page, 'mini-player'));

  // The stage moved there and draws on, letterboxed in the window: the styles came along.
  const stage = mini.getByTestId('visual-stage');
  await expect(page.getByTestId('visual-stage')).toHaveCount(0);
  await expect(stage).toHaveAttribute('data-status', 'running');
  await expectMotion(stage);
  await expect
    .poll(async () => {
      const box = (await stage.boundingBox())!;
      return box.width / box.height;
    })
    .toBeCloseTo(16 / 9, 1);
  // The tab says where the visuals are; the menu has the mini player on.
  await expect(page.getByTestId('mini-note')).toBeVisible();
  await openMore(page);
  await expect(page.getByTestId('mini-player')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // Its controls: the track, play and pause; the keys work in its window too.
  await expect(mini.getByTestId('mini-title')).toHaveText('Clicks');
  await mini.getByTestId('mini-play').click();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  await mini.keyboard.press(' ');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');

  // The tab shows the analysis; the mini player goes on with the visuals.
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByTestId('mini-note')).toBeHidden();
  await expect(stage).toHaveAttribute('data-scene', 'logoSpectrum');
  await expectMotion(stage);
  await page.getByRole('button', { name: 'Kaleidoscope' }).click();
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');

  // Back to the tab: the window goes, and the stage draws in the tab again.
  const closed = mini.waitForEvent('close');
  await mini.getByTestId('mini-back').click();
  await closed;
  const home = page.getByTestId('visual-stage');
  await expect(home).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('mini-note')).toBeHidden();
  await expectMotion(home);

  // M opens it, and M in its window closes it; the stage comes back once more. (The window
  // closes on the key going down: there is no page left for it to come up in.)
  const again = await openMiniPlayer(context, () => page.keyboard.press('m'));
  const closedAgain = again.waitForEvent('close');
  await again.keyboard.down('m');
  await closedAgain;
  await expect(home).toHaveAttribute('data-status', 'running');
  await expectMotion(home);

  // F in its window brings the visuals back for the fullscreen (which the browser may refuse to
  // a key in another window).
  const third = await openMiniPlayer(context, () => page.keyboard.press('m'));
  const closedThird = third.waitForEvent('close');
  await third.keyboard.down('f');
  await closedThird;
  await expect(home).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('mini-note')).toHaveCount(0);
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await expectMotion(home);
  expect(errors).toEqual([]);
});

test('the mini player draws on while its tab gets no animation frames (DS-06)', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await playTrack(page);
  const mini = await openMiniPlayer(context, () => moreAction(page, 'mini-player'));
  const stage = mini.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running');

  // Behind other tabs, the render worker gets no animation frames: its timer draws instead.
  const worker = page
    .workers()
    .filter((entry) => entry.url().includes('render.worker'))
    .at(-1)!;
  await worker.evaluate(() => {
    const scope = self as unknown as Record<string, unknown>;
    scope['realAnimationFrame'] = scope['requestAnimationFrame'];
    scope['requestAnimationFrame'] = () => 0;
  });
  await mini.waitForTimeout(500);
  await expectMotion(stage);
  await worker.evaluate(() => {
    const scope = self as unknown as Record<string, unknown>;
    scope['requestAnimationFrame'] = scope['realAnimationFrame'];
  });

  const closed = mini.waitForEvent('close');
  await page.getByTestId('mini-bring-back').click();
  await closed;
  await expectMotion(page.getByTestId('visual-stage'));
  expect(errors).toEqual([]);
});
