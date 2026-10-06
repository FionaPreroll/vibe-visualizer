import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

test('About names the version; the help lists the parts of others, what is new and privacy', async ({
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

  // Privacy, from About: what the app keeps, and what goes over the network.
  await page.getByTestId('help-nav-about').click();
  await page.getByTestId('help-privacy').click();
  await expect(content).toHaveAttribute('data-section', 'privacy');
  await expect(content.locator('.guide h3').first()).toHaveText('Who is responsible');
  await expect(content).toContainText('Your music, images and settings stay on your computer');

  // All of it as text, next to the app.
  const text = await (await page.request.get('/licenses.txt')).text();
  expect(text).toMatch(/^FibeStation contains these parts of others/);
  expect(text).toContain('FFmpeg libavcodec');
  expect(errors).toEqual([]);
});

test('the help only explains: the name and the backup are in the settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  // The help in three parts: the guide, what to do when something goes wrong, and about the app.
  await page.getByTestId('shortcuts-button').click();
  const help = page.getByTestId('help');
  await expect(help.locator('nav .group')).toHaveText(['Guide', 'Troubleshooting', 'About']);
  await page.getByTestId('help-nav-backup').click();
  await expect(help.getByTestId('backup')).toHaveCount(0);
  // Its page on backups opens the settings, where they are made.
  await page.getByTestId('help-settings').click();
  await expect(help).toBeHidden();
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId('backup-save')).toBeVisible();

  // The lettering in the ring, also in the top bar; the window's title keeps the app's name.
  const lettering = settings.getByTestId('settings-logo-text');
  await expect(lettering).toHaveValue('FibeStation');
  await lettering.fill('Night Visuals');
  await lettering.press('Enter');
  await expect(page.getByTestId('logo-text')).toHaveText('Night Visuals');
  await expect(page).toHaveTitle('FibeStation');
  // Nothing typed: the app's name.
  await lettering.fill('  ');
  await lettering.press('Enter');
  await expect(page.getByTestId('logo-text')).toHaveText('FibeStation');

  // What is in a backup: the help, at its page on it.
  await settings.getByTestId('settings-backup-help').click();
  await expect(settings).toBeHidden();
  await expect(page.getByTestId('help-content')).toHaveAttribute('data-section', 'backup');
  // And what can be deleted (UI-12).
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-button').click();
  await settings.getByTestId('settings-storage-help').click();
  await expect(settings).toBeHidden();
  await expect(page.getByTestId('help-content')).toHaveAttribute(
    'data-section',
    'stored-in-this-browser',
  );
  expect(errors).toEqual([]);
});
