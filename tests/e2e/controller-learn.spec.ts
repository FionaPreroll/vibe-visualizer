import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { moreAction } from './topbar';
import { createWav } from './wav';

/**
 * MIDI learn (CTL-04): a controller the app has no profile for, taught control by control, kept
 * as a profile of the user's, exported, imported, and described in a report for the developer.
 * Web MIDI is replaced by one device, "Generic MIDI", that the test plays.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:welcome:v1', '1');
    const input = {
      id: 'generic-in',
      name: 'Generic MIDI',
      type: 'input',
      state: 'connected',
      onmidimessage: null as ((event: unknown) => void) | null,
    };
    const sent: number[][] = [];
    const output = {
      id: 'generic-out',
      name: 'Generic MIDI',
      type: 'output',
      state: 'connected',
      send: (data: ArrayLike<number>) => sent.push(Array.from(data)),
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null,
      sysexEnabled: false,
    };
    Object.assign(window, {
      midi: {
        sent,
        receive: (...messages: number[][]) => {
          for (const data of messages) {
            input.onmidimessage?.({ data: new Uint8Array(data), timeStamp: performance.now() });
          }
        },
      },
    });
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
    });
  });
});

async function receive(page: Page, ...messages: number[][]): Promise<void> {
  await page.evaluate((list) => {
    (window as unknown as { midi: { receive: (...m: number[][]) => void } }).midi.receive(...list);
  }, messages);
}

function sent(page: Page): Promise<number[][]> {
  return page.evaluate(() => (window as unknown as { midi: { sent: number[][] } }).midi.sent);
}

async function downloaded(page: Page, click: () => Promise<void>): Promise<[Download, unknown]> {
  const download = page.waitForEvent('download');
  await click();
  const file = await download;
  return [file, JSON.parse(await readFile((await file.path())!, 'utf8')) as unknown];
}

test('a controller without a profile is taught, kept, exported and imported (CTL-04)', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['midi']);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');

  await moreAction(page, 'controller-button');
  const dialog = page.getByTestId('controller-dialog');
  await dialog.getByTestId('controller-connect').click();
  await expect(dialog.getByTestId('controller-devices')).toContainText('not supported yet');
  await dialog.getByTestId('learn-start').click();

  // Each control: Learn, then use it; the step learns once the control rests.
  const step = (id: string) => dialog.getByTestId(`learn-step-${id}`);
  const teach = async (id: string, ...messages: number[][]) => {
    await dialog.getByTestId(`learn-listen-${id}`).click();
    await expect(step(id)).toHaveAttribute('data-state', 'listening');
    await receive(page, ...messages);
    await expect(step(id)).not.toHaveAttribute('data-state', 'listening', { timeout: 5000 });
  };
  await teach('play', [0x90, 0x30, 0x7f], [0x80, 0x30, 0x00]);
  await expect(step('play')).toHaveAttribute('data-state', 'learned');
  await expect(step('play')).toContainText('Note 90 30');
  // Its controls do nothing while it is taught.
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  await teach('pad1', [0x99, 0x24, 0x64], [0x89, 0x24, 0x00]);
  await teach('pad2', [0x99, 0x25, 0x64], [0x89, 0x25, 0x00]);
  await teach('filter', ...[0, 32, 64, 96, 127].map((value) => [0xb0, 0x10, value]));
  await expect(step('filter')).toContainText('Control change B0 10');
  await teach('jog', [0xb0, 0x11, 0x01], [0xb0, 0x11, 0x02], [0xb0, 0x11, 0x7f]);
  // A control change of 0 alone says nothing of a button.
  await teach('cue', [0xb0, 0x40, 0x00]);
  await expect(step('cue')).toHaveAttribute('data-state', 'failed');
  await expect(step('cue')).toContainText('try again');

  // The report: what each control sent and what the app learned, with the MIDI ports.
  const [reportFile, report] = await downloaded(page, () =>
    dialog.getByTestId('learn-report').click(),
  );
  expect(reportFile.suggestedFilename()).toBe('Generic MIDI report.json');
  expect(report).toMatchObject({
    format: 'fibestation-controller-report',
    device: 'Generic MIDI',
    ports: { inputs: ['Generic MIDI'], outputs: ['Generic MIDI'] },
    profile: { ports: { input: 'Generic MIDI' } },
  });
  const steps = (report as { steps: { id: string; messages: string[]; learned: unknown }[] }).steps;
  expect(steps.find((entry) => entry.id === 'play')).toMatchObject({
    messages: ['90 30 7F', '80 30 00'],
    learned: { kind: 'button', control: 'play', status: 0x90, data: 0x30 },
  });
  expect(steps.find((entry) => entry.id === 'cue')).toMatchObject({
    messages: ['B0 40 00'],
    learned: null,
  });
  expect(steps.find((entry) => entry.id === 'crossfader')).toMatchObject({ messages: [] });

  // Saved, with its lights: the controller plays the app.
  await dialog.getByTestId('learn-name').fill('My Generic');
  await dialog.getByTestId('learn-lights').check();
  await dialog.getByTestId('learn-save').click();
  await expect(dialog.getByTestId('learn-note')).toContainText('Saved as “My Generic”');
  await expect(dialog.getByTestId('controller-devices')).toContainText('My Generic');
  await dialog.getByTestId('learn-done').click();
  await page.keyboard.press('Escape');
  await receive(page, [0x90, 0x30, 0x7f], [0x80, 0x30, 0x00]);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(async () => (await sent(page)).at(-1)).toEqual([0x90, 0x30, 0x7f]);
  await receive(page, [0x99, 0x25, 0x64], [0x89, 0x25, 0x00]);
  await expect(page.getByTestId('cue-pad').nth(1)).toHaveAttribute('data-set', 'true');
  // The filter knob takes over at the app's value (the middle), then turns it down.
  await receive(page, ...[64, 48, 32, 16, 0].map((value) => [0xb0, 0x10, value]));
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vibe-visualizer:sound:v1') ?? '{}').filter,
      ),
    )
    .toBeLessThan(-0.9);

  // Exported, removed and imported again.
  await moreAction(page, 'controller-button');
  const profiles = dialog.getByTestId('controller-profiles');
  await expect(profiles).toContainText('My Generic');
  const [profileFile, profile] = await downloaded(page, () =>
    dialog.getByTestId('profile-export').click(),
  );
  expect(profileFile.suggestedFilename()).toBe('My Generic profile.json');
  expect(profile).toMatchObject({ id: 'learned-generic-midi', name: 'My Generic' });
  await dialog.getByTestId('profile-remove').click();
  await expect(profiles).toHaveCount(0);
  await expect(dialog.getByTestId('controller-devices')).toContainText('not supported yet');
  await dialog.getByTestId('profile-import').setInputFiles(await profileFile.path());
  await expect(dialog.getByTestId('learn-note')).toContainText('Imported “My Generic”');
  await expect(dialog.getByTestId('controller-devices')).toContainText('My Generic');
  // A file that is no profile is refused.
  await dialog.getByTestId('profile-import').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": 1}'),
  });
  await expect(dialog.getByTestId('learn-note')).toContainText('no controller profile');

  // Kept: after a reload the controller connects again with its profile.
  await page.reload();
  await moreAction(page, 'controller-button');
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await expect(dialog.getByTestId('controller-devices')).toContainText('My Generic');
  expect(errors).toEqual([]);
});
