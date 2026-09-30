import { expect, test, type Page } from '@playwright/test';
import { createBeatWav, createWav } from './wav';

// The welcome (tested in visuals.spec.ts) would cover the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('the tempo of a track can be corrected, and is kept for its file (TMP-06)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // A click every half second: the grid finds 120 BPM.
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  const badge = page.getByTestId('queue-bpm');
  await expect(badge).toHaveText('120 BPM', { timeout: 15_000 });

  // Double it: the grid is computed anew around 240 BPM.
  await badge.click();
  const menu = page.getByTestId('tempo-menu');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('tempo-double')).toContainText('240 BPM');
  await expect(page.getByTestId('tempo-auto')).toBeDisabled();
  await page.getByTestId('tempo-double').click();
  await expect(menu).toHaveCount(0);
  await expect(badge).toHaveText('240 BPM');
  await expect(badge).toHaveAttribute('data-pending', 'false');
  await expect(badge).toHaveAttribute('title', /set by hand/);

  // The corrected tempo comes back with the file.
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await expect(badge).toHaveText('240 BPM', { timeout: 15_000 });

  // Back to the tempo the grid finds; then half of it, from where ÷ 2 goes out of range.
  await badge.click();
  await page.getByTestId('tempo-auto').click();
  await expect(badge).toHaveText('120 BPM');
  await badge.click();
  await page.getByTestId('tempo-half').click();
  await expect(badge).toHaveText('60 BPM');
  await badge.click();
  await expect(page.getByTestId('tempo-half')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the waveforms have two styles, and the choice is kept (TR-10)', async ({ page }) => {
  const errors = collectErrors(page);
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM', { timeout: 15_000 });
  await page.getByTestId('play-button').click();
  // Three bands by default; the button switches to RGB.
  const style = page.getByTestId('waveform-style');
  await expect(style).toHaveAttribute('data-style', 'bands');
  await expect(style).toHaveText('3 bands');
  await style.click();
  await expect(style).toHaveAttribute('data-style', 'rgb');
  await expect(style).toHaveText('RGB');

  await page.reload();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect(style).toHaveAttribute('data-style', 'rgb');
  expect(errors).toEqual([]);
});

test('a tempo can be held, typed or tapped (TMP-06)', async ({ page }) => {
  const errors = collectErrors(page);
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  const badge = page.getByTestId('queue-bpm');
  await expect(badge).toHaveText('120 BPM', { timeout: 15_000 });

  // Held at the tempo found: now set by hand.
  await badge.click();
  const hold = page.getByTestId('tempo-hold');
  await expect(hold).toHaveCount(1);
  await expect(hold).toContainText('120 BPM');
  await hold.click();
  await expect(badge).toHaveAttribute('title', /set by hand/);
  await badge.click();
  await expect(hold).toBeDisabled();

  // Typed, with Enter.
  const input = page.getByTestId('tempo-input');
  await input.fill('240');
  await input.press('Enter');
  await expect(page.getByTestId('tempo-menu')).toHaveCount(0);
  await expect(badge).toHaveText('240 BPM');

  // Tapped: five taps half a second apart give 120 BPM (timed in the page, which is steadier
  // than one call per tap).
  await badge.click();
  await page.getByTestId('tempo-tap').evaluate(async (tap: HTMLElement) => {
    for (let count = 0; count < 5; count++) {
      if (count > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      tap.click();
    }
  });
  const tapped = Number(await input.inputValue());
  expect(tapped).toBeGreaterThan(110);
  expect(tapped).toBeLessThan(125);
  await page.getByTestId('tempo-set').click();
  await expect(badge).toHaveText('120 BPM');
  // Space on the focused Tap button taps, and does not start the track.
  await badge.click();
  await page.getByTestId('tempo-tap').focus();
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await expect(input).not.toHaveValue('');
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  await page.keyboard.press('Escape');

  // A tempo out of range cannot be set.
  await badge.click();
  await input.fill('400');
  await expect(page.getByTestId('tempo-set')).toBeDisabled();
  await input.press('Escape');
  await expect(page.getByTestId('tempo-menu')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the tempo range of the analysis applies to all tracks, and is kept (AN-12)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // Clicks at 87 BPM, taken for snares on the second and fourth beat at 174 BPM in the
  // automatic range; the range up to 120 BPM keeps 87.
  const file = {
    name: 'Slow.wav',
    mimeType: 'audio/wav',
    buffer: createBeatWav([{ seconds: 12, bpm: 87 }], 22050),
  };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  const badge = page.getByTestId('queue-bpm');
  await expect(badge).toHaveText('174 BPM', { timeout: 15_000 });
  await badge.click();
  await expect(page.getByTestId('bpm-range-auto')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('bpm-range-slow').click();
  await expect(badge).toHaveText('87 BPM');
  await expect(badge).toHaveAttribute('data-pending', 'false');
  // Found in the range, not set by hand.
  await expect(badge).toHaveAttribute('title', 'Correct the tempo');

  await page.reload();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(badge).toHaveText('87 BPM', { timeout: 15_000 });
  await badge.click();
  await expect(page.getByTestId('bpm-range-slow')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('bpm-range-auto').click();
  await expect(badge).toHaveText('174 BPM');
  expect(errors).toEqual([]);
});

test('the beat grid can be corrected in the detail waveform, and is kept (TR-11)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const file = { name: 'Beat.wav', mimeType: 'audio/wav', buffer: createWav(8) };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM', { timeout: 15_000 });
  await page.getByTestId('play-button').click();
  await page.getByTestId('play-button').click();
  const shift = page.getByTestId('grid-shift');
  const reset = page.getByTestId('grid-reset');
  await expect(shift).toHaveText('0 ms');
  await expect(reset).toHaveCount(0);

  // Buttons: 5 ms later, 1 ms earlier (with Shift), beat 1 here, the bars a beat later.
  await page.getByTestId('grid-later').click();
  await expect(shift).toHaveText('+5 ms');
  await page.getByTestId('grid-earlier').click({ modifiers: ['Shift'] });
  await expect(shift).toHaveText('+4 ms');
  await expect(reset).toHaveCount(1);
  await page.getByTestId('grid-downbeat').click();
  await page.getByTestId('grid-bars-later').click();

  // Shift+drag: the grid moves with the pointer (8 s across the view).
  const canvas = page.getByTestId('detail-waveform').locator('canvas');
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const dragged = await shift.textContent();
  expect(parseFloat(dragged!)).toBeGreaterThan(20);

  // Kept for the file.
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('queue-bpm')).toHaveText('120 BPM', { timeout: 15_000 });
  await page.getByTestId('play-button').click();
  await expect(shift).toHaveText(dragged!);
  await reset.click();
  await expect(shift).toHaveText('0 ms');
  await expect(reset).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('tempo changes show in the badge and on the timeline (Korrektur 5)', async ({ page }) => {
  const errors = collectErrors(page);
  // 20 s at 120 BPM, then 30 s at 150: two tempos, the longer one first.
  const file = {
    name: 'Change.wav',
    mimeType: 'audio/wav',
    buffer: createBeatWav(
      [
        { seconds: 20, bpm: 120 },
        { seconds: 30, bpm: 150 },
      ],
      22050,
    ),
  };
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  const badge = page.getByTestId('queue-bpm');
  await expect(badge).toHaveText('150 · 120', { timeout: 20_000 });
  await expect(badge).toHaveAttribute('title', /changes tempo/);
  await badge.click();
  await expect(page.getByTestId('tempo-hold')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByTestId('play-button').click();
  const change = page.getByTestId('tempo-change');
  await expect(change).toHaveCount(1);
  await expect(change).toHaveText('150');
  expect(errors).toEqual([]);
});
