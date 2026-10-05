import { expect, test, type Page } from '@playwright/test';
import { expectMotion, measure } from './pixels';
import { createPng } from './png';
import { createTaggedWav, createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openKaleidoscope(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  return stage;
}

test('Kaleidoscope renders, moves with the music and switches scenes and modes', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(10, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);

  await expectMotion(stage);

  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByTestId('scene-crystal').click();
  await expect(page.getByTestId('scene-crystal')).toHaveAttribute('aria-checked', 'true');
  await expectMotion(stage);

  // Neon Ribbons (KA-04): its own controls, and it moves too.
  await page.getByTestId('scene-ribbons').click();
  await expect(page.getByTestId('scene-ribbons')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('preset-select')).toHaveValue('Neon Ribbons');
  await expect(page.getByRole('slider', { name: 'Ribbons', exact: true })).toHaveValue('4');
  await expect(page.getByRole('slider', { name: 'Lobes', exact: true })).toHaveValue('5');
  await expectMotion(stage);
  await expect(stage).toHaveAttribute('data-status', 'running');
  // Rings of light and soft lights instead of blossoms and flowers, which Flower Power keeps
  // (Kanban 15).
  await expect(page.getByRole('slider', { name: 'Halo', exact: true })).toHaveValue('0.6');
  await expect(page.getByRole('slider', { name: 'Flowers', exact: true })).toHaveValue('0');
  await page.getByTestId('preset-select').selectOption('Flower Power');
  await expect(page.getByRole('slider', { name: 'Flowers', exact: true })).toHaveValue('0.5');
  await expect(page.getByRole('slider', { name: 'Halo', exact: true })).toHaveValue('0');
  await expectMotion(stage);

  // Logo Spectrum and back: the same render worker keeps running.
  await page.getByRole('button', { name: 'Logo Spectrum' }).click();
  await expect(stage).toHaveAttribute('data-scene', 'logoSpectrum');
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  await expect(stage).toHaveAttribute('data-scene', 'kaleidoscope');
  await expect(stage).toHaveAttribute('data-status', 'running');
  expect(errors).toEqual([]);
});

test('the spin turns a round picture: no edge of a frame-shaped buffer turns into view', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  // The Vortex at the fastest spin: a turn in 6 s.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByRole('slider', { name: 'Spin', exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByTestId('play-button').click();
  await page.waitForTimeout(2000);

  // Left and right of the core, where the Vortex's strands reach. A buffer of the frame's shape
  // (wider than high) left both black whenever the spin turned it upright.
  const sides = [
    { x: 0.06, y: 0.35, width: 0.12, height: 0.3 },
    { x: 0.82, y: 0.35, width: 0.12, height: 0.3 },
  ];
  const seen: string[] = [];
  const start = Date.now();
  while (Date.now() - start < 6000) {
    const [left, right] = await measure(page, await stage.screenshot(), sides);
    const level = (region: typeof left) =>
      (region!.mean[0] + region!.mean[1] + region!.mean[2]) / 3;
    seen.push(`${level(left).toFixed(1)}/${level(right).toFixed(1)}`);
    expect(Math.max(level(left), level(right)), seen.join(' ')).toBeGreaterThan(1);
    await page.waitForTimeout(150);
  }
  expect(errors).toEqual([]);
});

test('zoomed out, the Kaleidoscope fills the frame instead of a disc (KA-05)', async ({ page }) => {
  const errors = collectErrors(page);
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  // The Vortex pushed outward as fast as it goes, zoomed out to half.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByRole('slider', { name: 'Tunnel flow', exact: true }).focus();
  await page.keyboard.press('End');
  const zoom = page.getByRole('slider', { name: 'Zoom', exact: true });
  await zoom.focus();
  await page.keyboard.press('Home');
  await expect(zoom).toHaveValue('0.5');
  await page.getByTestId('play-button').click();

  // A ring of spots at 1.25 times half the frame's height from the centre: beyond where the state
  // reached at zoom 1 (1.07 at half the zoom), it stayed black there. The light flows out to it.
  const box = (await stage.boundingBox())!;
  const half = box.height / 2;
  const spot = 20;
  const ring = Array.from({ length: 12 }, (_, k) => {
    const angle = (k / 12) * Math.PI * 2;
    const x = box.width / 2 + Math.cos(angle) * 1.25 * half - spot / 2;
    const y = box.height / 2 + Math.sin(angle) * 1.25 * half - spot / 2;
    return {
      x: x / box.width,
      y: y / box.height,
      width: spot / box.width,
      height: spot / box.height,
    };
  }).filter((r) => r.x > 0 && r.y > 0 && r.x + r.width < 1 && r.y + r.height < 1);
  expect(ring.length).toBeGreaterThan(3);
  const brightest = async () => {
    const stats = await measure(page, await stage.screenshot(), ring);
    return Math.max(...stats.map(({ mean }) => (mean[0] + mean[1] + mean[2]) / 3));
  };
  await expect.poll(brightest, { timeout: 20_000, intervals: [300] }).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('Kaleidoscope controls come from the scene specs and survive a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await openKaleidoscope(page);
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const preset = page.getByTestId('preset-select');
  await expect(preset).toHaveValue('Vortex');
  await expect(page.getByRole('slider', { name: 'Arms' })).toBeVisible();

  // Each scene brings its own controls.
  await page.getByTestId('scene-crystal').click();
  await expect(page.getByRole('slider', { name: 'Star points' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Arms' })).toHaveCount(0);
  await expect(preset).toHaveValue('Crystal Mandala');

  const segments = page.getByRole('slider', { name: 'Segments' });
  await segments.focus();
  await page.keyboard.press('ArrowRight');
  await expect(segments).toHaveValue('9');
  await expect(preset).toHaveValue('');

  // Your own colours: five colour stops.
  await page.getByRole('radio', { name: 'custom' }).click();
  await expect(page.getByLabel(/Your colours: colour/)).toHaveCount(5);

  await page.reload();
  await expect(page.getByTestId('scene-crystal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Segments' })).toHaveValue('9');
  await expect(page.getByLabel(/Your colours: colour/)).toHaveCount(5);

  await preset.selectOption('Aurora Spiral');
  await expect(page.getByTestId('scene-vortex')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Segments' })).toHaveValue('6');
  await page.getByRole('button', { name: 'Reset Vortex' }).click();
  await expect(preset).toHaveValue('Vortex');
  expect(errors).toEqual([]);
});

test('the colours can come from the cover art of the track playing (VE-12)', async ({ page }) => {
  const errors = collectErrors(page);
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Blue.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(30, {
      title: 'Blue',
      artist: 'The Testers',
      cover: createPng(32, 32, () => [30, 70, 235]),
    }),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // The mean colour of the picture: the Vortex's palette has no blue to speak of.
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const blueness = async () => {
    const [region] = await measure(page, await stage.screenshot(), [whole]);
    const [red, green, blue] = region!.mean;
    return blue - Math.max(red, green);
  };
  // Once the Vortex shows: a picture still dark when measured is neither (0), as on a slow runner
  // a second and a half after the start.
  await expect.poll(blueness, { timeout: 10_000 }).toBeLessThan(0);

  // With the colours of the cover: blue, and the look's own again without them.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  const option = page.getByTestId('cover-colors');
  await option.check();
  await expect(page.getByTestId('cover-colors-hint')).toBeVisible();
  await expect.poll(blueness, { timeout: 10_000 }).toBeGreaterThan(5);
  await option.uncheck();
  await expect.poll(blueness, { timeout: 10_000 }).toBeLessThan(0);
  expect(errors).toEqual([]);
});

test("a track's colours can be its own, its cover's more or less colourful, or the look's (VE-12)", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.addInitScript(() =>
    localStorage.setItem('vibe-visualizer:settings:v1', JSON.stringify({ coverColors: true })),
  );
  const stage = await openKaleidoscope(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'Red.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(30, {
      title: 'Red',
      artist: 'The Testers',
      cover: createPng(32, 32, () => [230, 30, 40]),
    }),
  });
  const item = page.getByTestId('queue-item');
  await expect(item).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('play-button').click();
  await expect
    .poll(async () => Number(await stage.getAttribute('data-fps')), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const shade = async () => {
    const [region] = await measure(page, await stage.screenshot(), [whole]);
    const [red, green, blue] = region!.mean;
    return {
      red: red - Math.max(green, blue),
      blue: blue - Math.max(red, green),
      sum: red + green + blue,
    };
  };
  // The cover's red.
  await expect.poll(async () => (await shade()).red, { timeout: 10_000 }).toBeGreaterThan(5);

  const open = async () => {
    await item.hover();
    await page.getByTestId('queue-rename').click();
  };
  const save = () => page.getByTestId('track-name-save').click();

  // Its own colour, blue; the dialog shows the colours before they are saved.
  await open();
  await expect(page.getByTestId('track-colors-cover')).toHaveAttribute('aria-checked', 'true');
  const gradient = page.getByTestId('track-colors-preview').locator('.gradient');
  await expect(gradient).toBeVisible();
  const picks = page.getByTestId('track-colors-pick');
  await expect(picks).toHaveCount(0);
  const before = await gradient.getAttribute('style');
  await page.getByTestId('track-colors-own').click();
  await expect(picks.first()).toBeVisible();
  await picks.first().fill('#2050ff');
  await expect.poll(() => gradient.getAttribute('style')).not.toBe(before);
  await save();
  await expect.poll(async () => (await shade()).blue, { timeout: 10_000 }).toBeGreaterThan(5);

  // The cover's colours again, but grey: neither red nor blue.
  await open();
  await page.getByTestId('track-colors-cover').click();
  await page.getByRole('slider', { name: 'Colourful' }).focus();
  await page.keyboard.press('Home');
  await save();
  await expect
    .poll(
      async () => {
        const { red, blue } = await shade();
        return Math.max(Math.abs(red), Math.abs(blue));
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(4);

  // The look's own palette for this track: the Vortex's, without blue.
  await open();
  await page.getByTestId('track-colors-look').click();
  await expect(page.getByTestId('track-colors-none')).toHaveText("The look's own palette");
  await save();
  await expect.poll(async () => (await shade()).blue, { timeout: 10_000 }).toBeLessThan(0);
  expect(errors).toEqual([]);
});
