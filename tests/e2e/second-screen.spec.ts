import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectMotion } from './pixels';
import { moreAction, openMore } from './topbar';
import { createWav } from './wav';

/**
 * The second screen (DS-03): the visuals in a window of their own, for a projector, while the
 * controls stay in the tab. Playwright sees the window as a page of its own.
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

/** Opens a window of the visuals with `open`, and gives it. */
async function openWindow(context: BrowserContext, open: () => Promise<void>): Promise<Page> {
  const opened = context.waitForEvent('page');
  await open();
  const view = await opened;
  await expect(view.getByTestId('visual-stage')).toBeVisible();
  return view;
}

const fullscreen = (view: Page) => view.evaluate(() => document.fullscreenElement !== null);

test('the second screen shows the visuals in a window for a projector (DS-03)', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await playTrack(page);
  const screen = await openWindow(context, () => moreAction(page, 'second-screen'));

  // The stage moved there and draws on; the tab says where the visuals are.
  const stage = screen.getByTestId('visual-stage');
  await expect(page.getByTestId('visual-stage')).toHaveCount(0);
  await expect(stage).toHaveAttribute('data-status', 'running');
  await expectMotion(stage);
  await expect(page.getByTestId('screen-note')).toBeVisible();
  await openMore(page);
  await expect(page.getByTestId('second-screen')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // The keys work in its window; F there shows it in fullscreen, and leaves it again.
  await screen.keyboard.press(' ');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  await screen.keyboard.press(' ');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await screen.keyboard.press('f');
  await expect.poll(() => fullscreen(screen)).toBe(true);
  await expect(screen.getByTestId('screen-fullscreen')).toContainText('Leave fullscreen');
  await screen.keyboard.press('f');
  await expect.poll(() => fullscreen(screen)).toBe(false);
  // A double-click on the visuals does the same.
  await stage.dblclick();
  await expect.poll(() => fullscreen(screen)).toBe(true);
  await screen.evaluate(() => document.exitFullscreen());
  // F in the tab leaves the visuals where they are.
  await page.keyboard.press('f');
  await expect(stage).toHaveAttribute('data-status', 'running');
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();

  // Its controls show while the pointer moves; back to the tab: the window goes, the stage
  // draws in the tab again.
  await screen.mouse.move(200, 200);
  await screen.mouse.move(220, 210);
  const closed = screen.waitForEvent('close');
  await screen.getByTestId('screen-back').click();
  await closed;
  const home = page.getByTestId('visual-stage');
  await expect(home).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('screen-note')).toHaveCount(0);
  await expectMotion(home);

  // Closed by the user, the window gives the visuals back too.
  const again = await openWindow(context, () => moreAction(page, 'second-screen'));
  await again.close();
  await expect(home).toHaveAttribute('data-status', 'running');
  await expectMotion(home);
  expect(errors).toEqual([]);
});

test('the mini player and the second screen take the visuals from each other (DS-03, DS-06)', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await playTrack(page);
  const screen = await openWindow(context, () => moreAction(page, 'second-screen'));
  const screenClosed = screen.waitForEvent('close');
  const mini = await openWindow(context, () => page.keyboard.press('m'));
  await screenClosed;
  await expect(mini.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('mini-note')).toBeVisible();

  const miniClosed = mini.waitForEvent('close');
  const second = await openWindow(context, () => moreAction(page, 'second-screen'));
  await miniClosed;
  await expectMotion(second.getByTestId('visual-stage'));
  await expect(page.getByTestId('screen-note')).toBeVisible();
  await page.getByTestId('screen-bring-back').click();
  await expectMotion(page.getByTestId('visual-stage'));
  expect(errors).toEqual([]);
});
