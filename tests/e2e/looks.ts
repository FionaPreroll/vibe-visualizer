import type { Page } from '@playwright/test';

/**
 * Starts the app with the look of Classic Rainbow, the default before Blue-Pink Vortex: one
 * scene per frame and a logo that stands still. CI draws in software, where a Kaleidoscope behind
 * the ring slows down everything else; and the cover's quarters are measured where they are when
 * the logo does not turn. A look that a test picks is kept, also over a reload.
 */
export async function startWithClassicLook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'vibe-visualizer:visuals:v1';
    // A stored look takes what it lacks from Classic Rainbow.
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ logoSpin: 0 }));
    }
  });
}

/** Saves the settings shown as a preset of your own: ⋯ → Save as…, then the name. */
export async function savePreset(page: Page, name: string): Promise<void> {
  await page.getByTestId('preset-tools-button').click();
  await page.getByTestId('preset-save-as').click();
  await page.getByTestId('preset-name').fill(name);
  await page.getByTestId('preset-save').click();
}
