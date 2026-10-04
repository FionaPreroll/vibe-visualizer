import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import { readFile } from 'node:fs/promises';
import { startWithClassicLook } from './looks';
import { COVER, logoQuarters, measure, showsCover, videoFrame } from './pixels';
import { createPng } from './png';
import { moreAction } from './topbar';
import { createTaggedWav, createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await startWithClassicLook(page);
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:welcome:v1', '1');
    // Headless browsers cannot show the save dialogs: the videos are downloaded instead.
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function addTrack(page: Page, seconds: number) {
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(seconds, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
}

async function elapsed(page: Page): Promise<number> {
  return Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
}

/** The smallest custom format keeps the software-rendered test short. */
async function chooseSmallFormat(page: Page) {
  await page.getByText('Custom', { exact: true }).click();
  await page.getByRole('radio', { name: '1:1' }).click();
  await page.getByTestId('export-resolution').selectOption('720');
  await page.getByTestId('export-fps').selectOption('24');
  await expect(page.getByTestId('export-dialog')).toContainText('720×720 · 24 fps · ');
  await expect(page.getByTestId('export-start')).toBeEnabled();
}

async function download(page: Page): Promise<{ name: string; data: Buffer }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-download').click(),
  ]);
  return { name: file.suggestedFilename(), data: await readFile(await file.path()) };
}

async function inspect(data: Buffer) {
  const input = new Input({ source: new BufferSource(data), formats: ALL_FORMATS });
  const video = (await input.getPrimaryVideoTrack())!;
  const audio = (await input.getPrimaryAudioTrack())!;
  let frames = 0;
  for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
    metadataOnly: true,
  })) {
    if (packet.byteLength > 0) frames++;
  }
  return {
    width: video.displayWidth,
    height: video.displayHeight,
    frames,
    duration: await input.computeDuration([video]),
    audioDuration: await input.computeDuration([audio]),
  };
}

test('exports the range between the markers as a video file @firefox', async ({ page }) => {
  // The Kaleidoscope draws in software in CI: its feedback runs on a square around the picture
  // (no turning rectangle), about twice the pixels of the picture.
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 10);
  await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
  // Load the track, then pause it (waiting for each state, so the second click is a pause).
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');

  // Markers at 5 s and at the end, set with the keys while the timeline has focus (TR-09);
  // not snapped to the beat here (Q), so they land where they were set.
  await page.getByTestId('quantize').click();
  await expect(page.getByTestId('quantize')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('timeline').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => elapsed(page)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(4.9);
  await page.keyboard.press('i');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(9.5);
  await page.keyboard.press('o');
  await expect(page.getByTestId('marks')).toContainText('0:05–0:10');
  await expect(page.getByTestId('marked-range')).toBeVisible();

  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await expect(page.getByTestId('export-range-marks')).toBeChecked();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-progress')).toBeVisible();
  // The live visuals pause while exporting; the top bar shows the progress.
  await expect(page.getByTestId('export-button')).toContainText('%');
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 200_000 });

  const file = await download(page);
  expect(file.name).toMatch(/^Clicks \(0m05s-0m09s\)\.(mp4|webm)$/);
  const video = await inspect(file.data);
  // 5 → 9.95 s at 24 fps: 119 frames; the audio is exactly as long.
  expect(video).toMatchObject({ width: 720, height: 720, frames: 119 });
  expect(video.duration).toBeCloseTo(119 / 24, 1);
  expect(video.audioDuration).toBeCloseTo(119 / 24, 1);
  expect(errors).toEqual([]);
});

test('the video shows the track overlay and the cover art (LS-15, LS-18, LS-19)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    // The overlay with its progress and time, and the cover art as the logo.
    const settings = { coverLogo: true, overlay: { on: true, progress: true, time: true } };
    localStorage.setItem('vibe-visualizer:settings:v1', JSON.stringify(settings));
  });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'tagged.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(4, { title: 'Sunrise', artist: 'The Testers', cover: COVER }),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await expect(page.getByTestId('export-overlay')).toHaveText("(with the track's title)");
  await expect(page.getByTestId('export-cover')).toHaveText('(its cover art as the logo)');
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 150_000 });

  const file = await download(page);
  expect(file.name).toMatch(/^The Testers - Sunrise\.(mp4|webm)$/);
  expect(await inspect(file.data)).toMatchObject({ width: 720, height: 720, frames: 96 });
  // In the middle: the cover in the logo, and the text at the bottom left.
  const frame = await videoFrame(page, file.data, 2);
  test.skip(!frame, 'This browser cannot play the video it made.');
  const text = { x: 0.04, y: 0.74, width: 0.5, height: 0.22 };
  const [overlay, ...quarters] = await measure(page, frame!, [
    text,
    ...logoQuarters({ width: 720, height: 720 }),
  ]);
  expect(overlay!.bright).toBeGreaterThan(0.03);
  expect(showsCover(quarters)).toBe(true);
  expect(errors).toEqual([]);
});

/**
 * The level (RMS of the left channel) of the video's sound over 50 ms from each of `times`,
 * decoded by the page; null if this browser cannot decode it.
 */
async function soundLevels(page: Page, data: Buffer, times: number[]): Promise<number[] | null> {
  return page.evaluate(
    async ({ bytes, times }) => {
      const binary = atob(bytes);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
      try {
        const buffer = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(array.buffer);
        const channel = buffer.getChannelData(0);
        return times.map((seconds) => {
          const from = Math.round(seconds * buffer.sampleRate);
          const to = Math.min(channel.length, from + Math.round(0.05 * buffer.sampleRate));
          let sum = 0;
          for (let i = from; i < to; i++) sum += channel[i]! ** 2;
          return Math.sqrt(sum / Math.max(1, to - from));
        });
      } catch {
        return null;
      }
    },
    { bytes: data.toString('base64'), times },
  );
}

test('tracks of the queue become one video with chapters and fades (EX-05, EX-14, EX-16)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    // Each track's title over its part, and its cover art as the logo.
    const settings = { coverLogo: true, overlay: { on: true } };
    localStorage.setItem('vibe-visualizer:settings:v1', JSON.stringify(settings));
  });
  await page.goto('/');
  const cyan = createPng(64, 64, () => [30, 220, 230]);
  const tagged = (title: string, artist: string, cover?: Buffer) => ({
    name: `${title}.wav`,
    mimeType: 'audio/wav',
    buffer: createTaggedWav(3, { title, artist, cover }),
  });
  await page
    .getByTestId('file-input')
    .setInputFiles([
      tagged('One', 'Alpha', COVER),
      tagged('Two', 'Beta'),
      tagged('Three', 'Gamma', cyan),
    ]);
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(3);
  for (const item of await items.all()) await expect(item).toHaveAttribute('data-status', 'ready');

  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-range-tracks').check();
  const choices = page.getByTestId('export-track-choice');
  await expect(choices).toHaveCount(3);
  // Without the second track the video is shorter; all three again.
  await choices.nth(1).uncheck();
  await expect(page.getByTestId('export-track')).toHaveText('2 tracks, from One');
  await expect(page.getByTestId('export-length')).toContainText('0:06');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('export-track')).toHaveText('3 tracks, from One');
  await expect(page.getByTestId('export-length')).toContainText('0:09');
  await page.getByTestId('export-fade').selectOption('1');
  await expect(page.getByTestId('export-fades')).toHaveText('(fading in and out over 1 s)');
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 200_000 });

  // The chapters for YouTube, where each track starts; three seconds are too short for YouTube.
  const chapters = '0:00 Alpha – One\n0:03 Beta – Two\n0:06 Gamma – Three';
  expect(await page.getByTestId('export-chapters').textContent()).toBe(chapters);
  await expect(page.getByTestId('export-done')).toContainText('at least 10 s long');
  const [text] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-chapters-save').click(),
  ]);
  expect(text.suggestedFilename()).toMatch(/^Alpha - One and 2 more - chapters\.txt$/);
  expect(await readFile(await text.path(), 'utf8')).toBe(`${chapters}\n`);

  const file = await download(page);
  expect(file.name).toMatch(/^Alpha - One and 2 more\.(mp4|webm)$/);
  const video = await inspect(file.data);
  expect(video).toMatchObject({ width: 720, height: 720, frames: 216 });
  expect(video.audioDuration).toBeCloseTo(9, 1);

  // Black at the start and the end; in between, each track with its cover (the second has
  // none: the logo) and its title.
  const shots: Buffer[] = [];
  for (const seconds of [0, 1.5, 4.5, 7.5, 8.98]) {
    const frame = await videoFrame(page, file.data, seconds);
    test.skip(!frame, 'This browser cannot play the video it made.');
    shots.push(frame!);
  }
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const title = { x: 0.04, y: 0.74, width: 0.5, height: 0.22 };
  const look = async (frame: Buffer) => {
    const [all, overlay, ...quarters] = await measure(page, frame, [
      whole,
      title,
      ...logoQuarters({ width: 720, height: 720 }),
    ]);
    const brightness = all!.mean.reduce((sum, value) => sum + value, 0) / 3;
    return { brightness, text: overlay!.bright, quarters };
  };
  const [start, one, two, three, end] = await Promise.all(shots.map(look));
  expect(start!.brightness).toBeLessThan(2);
  expect(end!.brightness).toBeLessThan(5);
  expect(showsCover(one!.quarters)).toBe(true);
  expect(showsCover(two!.quarters)).toBe(false);
  const isCyan = (quarter: { mean: [number, number, number] }) =>
    quarter.mean[0] < 90 && quarter.mean[1] > 180 && quarter.mean[2] > 180;
  expect(two!.quarters.some(isCyan)).toBe(false);
  expect(three!.quarters.every(isCyan)).toBe(true);
  for (const part of [one, two, three]) expect(part!.text).toBeGreaterThan(0.01);

  // The sound fades in and out with the picture.
  const levels = await soundLevels(page, file.data, [0, 1.5, 8.9]);
  if (levels) {
    expect(levels[0]).toBeLessThan(0.01);
    expect(levels[1]).toBeGreaterThan(0.15);
    expect(levels[2]).toBeLessThan(0.02);
  }
  expect(errors).toEqual([]);
});

test('a video of tracks takes the colours of each: its cover art, or its own (VE-12)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const settings = { coverColors: true, visualMode: 'kaleidoscope' };
    localStorage.setItem('vibe-visualizer:settings:v1', JSON.stringify(settings));
  });
  await page.goto('/');
  const tagged = (title: string, cover?: Buffer) => ({
    name: `${title}.wav`,
    mimeType: 'audio/wav',
    buffer: createTaggedWav(3, { title, artist: 'The Testers', cover }),
  });
  await page.getByTestId('file-input').setInputFiles([
    tagged(
      'Blue',
      createPng(32, 32, () => [30, 70, 235]),
    ),
    tagged('Orange'),
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(2);
  for (const item of await items.all()) await expect(item).toHaveAttribute('data-status', 'ready');
  // The second track has no cover art: it gets a colour of its own, orange.
  await items.nth(1).hover();
  await items.nth(1).getByTestId('queue-rename').click();
  await page.getByTestId('track-colors-own').click();
  await page.getByTestId('track-colors-pick').first().fill('#fa7814');
  await page.getByRole('button', { name: 'Remove the last colour' }).click();
  await expect(page.getByTestId('track-colors-pick')).toHaveCount(1);
  await page.getByTestId('track-name-save').click();

  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-range-tracks').check();
  await expect(page.getByTestId('export-cover-colors')).toHaveText(
    '(in the colours of the tracks)',
  );
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 200_000 });
  const file = await download(page);

  // Blue in the first track; orange in the second, once it has blended in.
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const colour = async (seconds: number) => {
    const frame = await videoFrame(page, file.data, seconds);
    test.skip(!frame, 'This browser cannot play the video it made.');
    const [region] = await measure(page, frame!, [whole]);
    return region!.mean;
  };
  const [r1, g1, b1] = await colour(2);
  expect(b1).toBeGreaterThan(Math.max(r1, g1) + 5);
  const [r2, g2, b2] = await colour(5.5);
  expect(r2).toBeGreaterThan(Math.max(g2, b2) + 5);
  expect(errors).toEqual([]);
});

/** Three tagged tracks of `seconds` in the queue; the third has the name of the first. */
async function addBatchTracks(page: Page, seconds: number) {
  const tagged = (file: string, title: string, artist: string) => ({
    name: file,
    mimeType: 'audio/wav',
    buffer: createTaggedWav(seconds, { title, artist }),
  });
  await page
    .getByTestId('file-input')
    .setInputFiles([
      tagged('one.wav', 'One', 'Alpha'),
      tagged('two.wav', 'Two', 'Beta'),
      tagged('again.wav', 'One', 'Alpha'),
    ]);
  const items = page.getByTestId('queue-item');
  await expect(items).toHaveCount(3);
  for (const item of await items.all()) await expect(item).toHaveAttribute('data-status', 'ready');
}

test('a video of each track, waiting in browser storage (EX-09)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await addBatchTracks(page, 3);
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-range-tracks').check();
  await page.getByTestId('export-per-track').check();
  await expect(page.getByTestId('export-track')).toHaveText('3 videos, one of each track');
  await expect(page.getByTestId('export-length')).toContainText('0:09 in all');
  await page.getByTestId('export-start').click();
  // One after the other, and the top bar counts them.
  await expect(page.getByTestId('export-file')).toContainText('Video 1 of 3');
  await expect(page.getByTestId('export-button')).toContainText('1/3');
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 200_000 });
  await expect(page.getByTestId('export-done')).toContainText('Your 3 videos are ready.');

  // Each named after its track; the second of the same name gets a number.
  const links = page.getByTestId('export-video-download');
  await expect(links).toHaveCount(3);
  const names: string[] = [];
  for (const link of await links.all()) {
    const [file] = await Promise.all([page.waitForEvent('download'), link.click()]);
    names.push(file.suggestedFilename());
    const video = await inspect(await readFile(await file.path()));
    expect(video).toMatchObject({ width: 720, height: 720, frames: 72 });
    expect(video.audioDuration).toBeCloseTo(3, 1);
  }
  expect(names).toEqual([
    expect.stringMatching(/^Alpha - One\.(mp4|webm)$/),
    expect.stringMatching(/^Beta - Two\.(mp4|webm)$/),
    expect.stringMatching(/^Alpha - One \(2\)\.(mp4|webm)$/),
  ]);
  // Deleted from browser storage, they are gone.
  await page.getByRole('button', { name: 'Delete from browser storage' }).click();
  await expect(page.getByTestId('export-start')).toBeVisible();
  const kept = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      names.push(name);
    }
    return names;
  });
  expect(kept).not.toContain('export-videos');
  expect(errors).toEqual([]);
});

test('a video of each track, into a folder you pick (EX-09)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    // The folder you would pick: one in the Origin Private File System.
    (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker =
      async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('picked', { create: true });
  });
  await page.goto('/');
  await addBatchTracks(page, 2);
  // A video of that name is already in the folder: it stays.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('picked', { create: true });
    for (const name of ['Beta - Two.mp4', 'Beta - Two.webm']) {
      const file = await folder.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write('old');
      await writable.close();
    }
  });
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-range-tracks').check();
  await page.getByTestId('export-per-track').check();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 200_000 });
  await expect(page.getByTestId('export-done')).toContainText('Saved into the folder you chose.');
  await expect(page.getByTestId('export-video-download')).toHaveCount(0);

  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('picked');
    const found: { name: string; data: string }[] = [];
    const entries = folder as unknown as { values(): AsyncIterable<FileSystemFileHandle> };
    for await (const handle of entries.values()) {
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      found.push({ name: handle.name, data: btoa(binary) });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  });
  const videos = files.filter((file) => file.data !== btoa('old'));
  expect(videos.map((file) => file.name)).toEqual([
    expect.stringMatching(/^Alpha - One \(2\)\.(mp4|webm)$/),
    expect.stringMatching(/^Alpha - One\.(mp4|webm)$/),
    expect.stringMatching(/^Beta - Two \(2\)\.(mp4|webm)$/),
  ]);
  for (const file of videos) {
    expect(await inspect(Buffer.from(file.data, 'base64'))).toMatchObject({ frames: 48 });
  }
  expect(errors).toEqual([]);
});

test('the picture on the stage is saved as a PNG thumbnail (EX-10)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const settings = { coverLogo: true, overlay: { on: true } };
    localStorage.setItem('vibe-visualizer:settings:v1', JSON.stringify(settings));
  });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'tagged.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(8, { title: 'Sunrise', artist: 'The Testers', cover: COVER }),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(() => elapsed(page)).toBeGreaterThan(2);
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');

  const save = async (action: () => Promise<void>) => {
    const [file] = await Promise.all([page.waitForEvent('download'), action()]);
    const data = await readFile(await file.path());
    // The size from the PNG's header.
    return {
      name: file.suggestedFilename(),
      data,
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  };
  // YouTube's thumbnail size, named after the track, with the cover and the title.
  const picture = await save(() => moreAction(page, 'picture-button'));
  expect(picture).toMatchObject({ name: 'The Testers - Sunrise.png', width: 1280, height: 720 });
  expect(picture.data.length).toBeLessThan(2 * 1024 * 1024);
  const [title, ...quarters] = await measure(page, picture.data, [
    { x: 0.04, y: 0.74, width: 0.5, height: 0.22 },
    ...logoQuarters({ width: 1280, height: 720 }),
  ]);
  expect(title!.bright).toBeGreaterThan(0.01);
  expect(showsCover(quarters)).toBe(true);

  // In the stage's aspect ratio; C saves it too.
  await page.getByTestId('aspect-select').selectOption('9:16');
  const upright = await save(() => page.keyboard.press('c'));
  expect(upright).toMatchObject({ width: 720, height: 1280 });
  expect(errors).toEqual([]);
});

test('an interrupted export resumes after a reload', async ({ page }) => {
  // Two scenes per frame in software rendering, and the frames after the last whole segment
  // twice: about 2¼ min here and 3½ min on CI, the slowest test there. A runner may be slower.
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'tagged.wav',
    mimeType: 'audio/wav',
    buffer: createTaggedWav(8, { title: 'Sunrise', artist: 'The Testers', cover: COVER }),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  // The Logo Spectrum with the Kaleidoscope behind it (VE-08), so both scenes carry over: Bloom
  // Halo. Its logo stands still, as does that of the preset after it, Ribbon Lines, so that the
  // cover can be found at the end.
  await page.getByRole('tab', { name: 'Visuals' }).click();
  await page.getByTestId('preset-select').selectOption('Bloom Halo');
  // The presets switch every 5 s (PR-02): the resumed part goes on switching where it was.
  await page.getByText('Preset switching', { exact: true }).click();
  await page.getByTestId('auto-presets').check();
  await page
    .getByRole('radiogroup', { name: 'Switch every' })
    .getByRole('radio', { name: 'Seconds' })
    .click();
  await page.getByRole('slider', { name: 'Seconds', exact: true }).focus();
  await page.keyboard.press('Home');
  // Reduce flashing (VE-06) too: its settled level carries over as well.
  await page.getByText('Display', { exact: true }).click();
  await page.getByTestId('reduce-flashing').check();
  // The cover art as the logo (LS-15) is kept with the job, the overlay (LS-18) in its plan.
  await page.getByText('Logo', { exact: true }).click();
  await page.getByTestId('cover-logo').check();
  await page.getByText('Track info', { exact: true }).click();
  await page.getByTestId('overlay-on').check();
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-switching')).toHaveText('(switching presets every 5 s)');
  await expect(page.getByTestId('export-calm')).toHaveText('(flashing reduced)');
  await chooseSmallFormat(page);
  await page.getByTestId('export-start').click();

  // Wait until the first of the three segments is finished, then reload mid-render.
  const button = page.getByTestId('export-button');
  await expect
    .poll(async () => Number(/(\d+) %/.exec((await button.textContent()) ?? '')?.[1] ?? 0), {
      timeout: 180_000,
    })
    .toBeGreaterThan(45);
  await page.reload();

  // The queue is empty now: the audio pass was done, so the export needs no file to resume.
  await expect(page.getByTestId('export-note')).toContainText('interrupted');
  await page.getByTestId('export-note').click();
  await expect(page.getByTestId('export-interrupted')).toContainText('% rendered');
  await page.getByTestId('export-resume').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 270_000 });

  const file = await download(page);
  expect(file.name).toMatch(/^The Testers - Sunrise\.(mp4|webm)$/);
  const video = await inspect(file.data);
  expect(video).toMatchObject({ width: 720, height: 720, frames: 192 });
  expect(video.duration).toBeCloseTo(8, 1);
  expect(video.audioDuration).toBeCloseTo(8, 1);
  // The resumed part still shows the cover art in the logo.
  const frame = await videoFrame(page, file.data, 7);
  if (frame) {
    const quarters = await measure(page, frame, logoQuarters({ width: 720, height: 720 }));
    expect(showsCover(quarters)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('an export goes on by itself after the graphics card was reset (NF-09)', async ({ page }) => {
  // Part of it is rendered twice: about 1½ min on CI.
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 8);
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-start').click();

  // Once the first of the three segments is finished, the graphics context is lost.
  const button = page.getByTestId('export-button');
  await expect
    .poll(async () => Number(/(\d+) %/.exec((await button.textContent()) ?? '')?.[1] ?? 0), {
      timeout: 120_000,
    })
    .toBeGreaterThan(45);
  const worker = page.workers().find((entry) => entry.url().includes('export.worker'));
  await worker!.evaluate(() => {
    const call = { id: -1, method: 'loseContext', args: null };
    self.dispatchEvent(new MessageEvent('message', { data: call }));
  });

  // The video pass starts again from that segment, in a new context: the video is whole.
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 180_000 });
  const video = await inspect((await download(page)).data);
  expect(video).toMatchObject({ width: 720, height: 720, frames: 192 });
  expect(video.duration).toBeCloseTo(8, 1);
  expect(errors).toEqual([]);
});

test('an export can be paused, continued and cancelled', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await addTrack(page, 8);
  await page.getByTestId('export-button').click();
  await chooseSmallFormat(page);
  await page.getByTestId('export-start').click();
  const progress = page.getByTestId('export-progress');
  await expect(progress).toHaveAttribute('data-phase', 'video', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByTestId('export-button')).toContainText('Paused');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('export-button')).toContainText('Exporting');
  await page.getByTestId('export-cancel').click();
  // Back to the settings, with nothing left to resume after a reload.
  await expect(page.getByTestId('export-start')).toBeVisible();
  await expect(page.getByTestId('export-button')).toHaveText('Export');
  await page.reload();
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('export-note')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the stage follows the aspect ratio and shows safe areas', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByTestId('visual-stage');
  await expect(stage).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
  const ratio = async () => {
    const box = (await stage.boundingBox())!;
    return box.width / box.height;
  };
  expect(await ratio()).toBeCloseTo(16 / 9, 1);
  await page.getByTestId('aspect-select').selectOption('9:16');
  await expect.poll(ratio).toBeCloseTo(9 / 16, 1);
  await moreAction(page, 'safe-areas-toggle');
  await expect(page.getByTestId('safe-areas')).toContainText('Buttons');
  // Choosing the TikTok preset in the export dialog keeps 9:16; YouTube switches back.
  await page.getByTestId('export-button').click();
  await expect(page.getByRole('radio', { name: /TikTok/ })).toBeChecked();
  await page.getByRole('radio', { name: /YouTube 1080p60/ }).check();
  await expect.poll(ratio).toBeCloseTo(16 / 9, 1);
  await page.reload();
  await expect(page.getByTestId('aspect-select')).toHaveValue('16:9');
  await expect(page.getByTestId('safe-areas')).toBeVisible();
});
