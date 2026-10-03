import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

test('About names the version; the help lists the parts of others and what is new', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('shortcuts-button').click();
  await page.getByTestId('help-nav-about').click();
  const content = page.getByTestId('help-content');
  await expect(page.getByTestId('about-version')).toHaveText(/^FibeStation v0\.9\.\d{8}\.\d{4}$/);
  await expect(content).toContainText('FibeStation has no licence yet: all rights reserved.');

  // The licences: each part of others, with its licence and its texts.
  await page.getByTestId('help-licences').click();
  await expect(content).toHaveAttribute('data-section', 'licences');
  const licence = (name: string) =>
    page.getByTestId('licence').and(page.locator(`[data-name="${name}"]`));
  for (const [name, license] of [
    ['FFmpeg', 'LGPL-2.1-or-later'],
    ['mediabunny', 'MPL-2.0'],
    ['@mediabunny/aac-encoder', 'MPL-2.0'],
    ['signalsmith-stretch', 'MIT'],
    ['svelte', 'MIT'],
    ['@fontsource/pacifico', 'OFL-1.1'],
    ['Emscripten', 'MIT OR NCSA'],
  ]) {
    await expect(licence(name!)).toContainText(license!);
  }
  // FFmpeg's entry says where its source is, and offers it.
  const ffmpeg = licence('FFmpeg');
  await expect(ffmpeg).toContainText('licensed under the GNU Lesser General Public License');
  await expect(ffmpeg).toContainText('write to fipreroll+app@gmail.com');
  await ffmpeg.locator('summary', { hasText: 'COPYING.LGPLv2.1' }).click();
  await expect(ffmpeg.locator('pre').first()).toContainText('GNU LESSER GENERAL PUBLIC LICENSE');
  // Mediabunny's: its source, as the app uses it.
  await expect(licence('mediabunny')).toContainText('https://www.npmjs.com/package/mediabunny/v/');

  // What's new: the changelog, a day at a time, newest first.
  await page.getByTestId('help-nav-whats-new').click();
  await expect(content).toHaveAttribute('data-section', 'whats-new');
  await expect(content.locator('.guide h3').first()).toHaveText(/^\d{1,2} \w+ 20\d\d$/);
  await expect(content).toContainText('A new default look');

  // All of it as text, next to the app.
  const text = await (await page.request.get('/licenses.txt')).text();
  expect(text).toMatch(/^FibeStation contains these parts of others/);
  expect(text).toContain('FFmpeg libavcodec');
  expect(errors).toEqual([]);
});
