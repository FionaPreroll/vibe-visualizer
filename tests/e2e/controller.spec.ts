import { expect, test, type Page } from '@playwright/test';
import { createWav } from './wav';

/**
 * A DDJ-FLX2 that is not there: Web MIDI replaced by one input and one output named like the
 * controller. The test sends what the controller would send and reads the lights it gets.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vibe-visualizer:welcome:v1', '1');
    const input = {
      id: 'flx2-in',
      name: 'DDJ-FLX2',
      type: 'input',
      state: 'connected',
      onmidimessage: null as ((event: unknown) => void) | null,
    };
    const sent: number[][] = [];
    const output = {
      id: 'flx2-out',
      name: 'DDJ-FLX2',
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

/** Messages from the controller. */
async function receive(page: Page, ...messages: number[][]): Promise<void> {
  await page.evaluate((list) => {
    (window as unknown as { midi: { receive: (...m: number[][]) => void } }).midi.receive(...list);
  }, messages);
}

/** The last velocity the app sent to a light (status and data byte), or null. */
function light(page: Page, status: number, data: number): Promise<number | null> {
  return page.evaluate(
    ([s, d]) => {
      const sent = (window as unknown as { midi: { sent: number[][] } }).midi.sent;
      const last = sent.filter((message) => message[0] === s && message[1] === d).at(-1);
      return last ? last[2]! : null;
    },
    [status, data],
  );
}

function storedSound(page: Page): Promise<{ filter: number; rate: number }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('vibe-visualizer:sound:v1') ?? '{}'));
}

/** A 14-bit knob or fader at `value` (0–1): its coarse and its fine part. */
function knob(status: number, msb: number, value: number): number[][] {
  const raw = Math.round(value * 0x3fff);
  return [
    [status, msb, raw >> 7],
    [status, msb + 0x20, raw & 0x7f],
  ];
}

test('a DDJ-FLX2 plays, sets hot cues, filters and changes the tempo (CTL-02, CTL-03)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['midi']);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');

  await page.getByTestId('controller-button').click();
  const dialog = page.getByTestId('controller-dialog');
  await dialog.getByTestId('controller-connect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await expect(dialog.getByTestId('controller-devices')).toContainText('Pioneer DJ DDJ-FLX2');
  // The lights start off.
  expect(await light(page, 0x90, 0x0b)).toBe(0);
  await page.keyboard.press('Escape');

  // PLAY/PAUSE plays; its light follows.
  await receive(page, [0x90, 0x0b, 0x7f], [0x90, 0x0b, 0x00]);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(() => light(page, 0x90, 0x0b)).toBe(0x7f);

  // Pad 1 in hot cue mode sets cue 1, and its light (with and without SHIFT) goes on.
  const pads = page.getByTestId('cue-pad');
  await receive(page, [0x97, 0x00, 0x7f], [0x97, 0x00, 0x00]);
  await expect(pads.first()).toHaveAttribute('data-set', 'true');
  await expect.poll(() => light(page, 0x97, 0x00)).toBe(0x7f);
  expect(await light(page, 0x98, 0x00)).toBe(0x7f);
  // SHIFT + pad 1 deletes it.
  await receive(page, [0x98, 0x00, 0x7f], [0x98, 0x00, 0x00]);
  await expect(pads.first()).toHaveAttribute('data-set', 'false');
  await expect.poll(() => light(page, 0x97, 0x00)).toBe(0);

  // CFX: taken over in the middle, then to the right, a high-pass.
  await receive(page, ...knob(0xb6, 0x17, 0.5), ...knob(0xb6, 0x17, 0.75));
  await expect.poll(async () => (await storedSound(page)).filter).toBeCloseTo(0.5, 2);
  // The tempo slider at the bottom: +8 % in the default range; it has to reach the value
  // (the middle) first.
  await receive(page, ...knob(0xb0, 0x00, 1));
  await page.waitForTimeout(200);
  expect((await storedSound(page)).rate ?? 1).toBe(1);
  await receive(page, ...knob(0xb0, 0x00, 0.5), ...knob(0xb0, 0x00, 1));
  await expect.poll(async () => (await storedSound(page)).rate).toBeCloseTo(1.08, 3);
  // The channel fader is the volume.
  const volume = page.getByLabel('Volume');
  await receive(page, ...knob(0xb0, 0x13, 0.8), ...knob(0xb0, 0x13, 0.4));
  await expect.poll(async () => Number(await volume.inputValue())).toBeCloseTo(0.4, 1);

  // Deck 2 does nothing yet.
  await receive(page, [0x91, 0x0b, 0x7f], [0x91, 0x0b, 0x00]);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');

  // PLAY again pauses; the light blinks while paused.
  await receive(page, [0x90, 0x0b, 0x7f], [0x90, 0x0b, 0x00]);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');

  // The jog wheel seeks: 100 steps of its top are 100 × 1.8 s / 460 = 0.39 s, and 16 times as
  // far with SHIFT held.
  const elapsed = async () =>
    Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
  const paused = await elapsed();
  const turn = (data: number) => Array.from({ length: 10 }, () => [0xb0, data, 0x40 + 10]);
  await receive(page, ...turn(0x22));
  await expect.poll(elapsed).toBeCloseTo(paused + 0.391, 1);
  await receive(page, [0x90, 0x3f, 0x7f], ...turn(0x29), [0x90, 0x3f, 0x00]);
  const jogged = paused + 0.391 + 6.26;
  await expect.poll(elapsed).toBeCloseTo(jogged, 1);
  // A pad right after it sets its cue there.
  await receive(page, [0x97, 0x01, 0x7f], [0x97, 0x01, 0x00]);
  await expect(pads.nth(1)).toHaveAttribute('data-set', 'true');
  // (On the nearest beat, and shown in whole seconds.)
  const label = (await pads.nth(1).getAttribute('aria-label')) ?? '';
  expect(Number(/^Cue 2 at 0:(\d\d)$/.exec(label)?.[1])).toBeCloseTo(jogged, -0.5);

  // CUE as on a CDJ, with the in marker as the cue point. Paused away from it, CUE moves it
  // to the playhead (on the beat), and its light goes on.
  const cue = (pressed: boolean) => [0x90, 0x0c, pressed ? 0x7f : 0x00];
  await receive(page, cue(true), cue(false));
  const inMark = page.getByTestId('mark-in');
  await expect(inMark).toBeVisible();
  expect(Number(await inMark.getAttribute('aria-valuenow'))).toBeCloseTo(jogged, -0.5);
  await expect.poll(() => light(page, 0x90, 0x0c)).toBe(0x7f);
  const cuePoint = await elapsed();
  // Held at the cue point, it plays until let go, then goes back.
  await receive(page, cue(true));
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await page.waitForTimeout(400);
  await receive(page, cue(false));
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  await expect.poll(elapsed).toBeCloseTo(cuePoint, 1);
  // PLAY while CUE is held plays on; CUE while playing goes back and pauses.
  await receive(page, cue(true), [0x90, 0x0b, 0x7f], [0x90, 0x0b, 0x00], cue(false));
  await page.waitForTimeout(400);
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await receive(page, cue(true), cue(false));
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');
  await expect.poll(elapsed).toBeCloseTo(cuePoint, 1);

  // After a reload the controller comes back by itself, as MIDI is allowed.
  await page.reload();
  await page.getByTestId('controller-button').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await dialog.getByTestId('controller-disconnect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Not connected');
  // The lights go off when it is let go.
  expect(await light(page, 0x90, 0x0b)).toBe(0);
});

test('the MIDI monitor shows what a controller sends', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('controller-button').click();
  const dialog = page.getByTestId('controller-dialog');
  await dialog.getByTestId('controller-connect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await dialog.getByText('MIDI monitor').click();
  await receive(
    page,
    [0x97, 0x02, 0x7f],
    [0xb0, 0x21, 0x41],
    [0x90, 0x7e, 0x7f],
    [0xb6, 0x17, 0x40],
  );
  const monitor = dialog.getByTestId('controller-monitor');
  await expect(monitor).toContainText('97 02 7F');
  await expect(monitor).toContainText('deck 1 pad 3 (hotcue) pressed');
  await expect(monitor).toContainText('deck 1 jog +1');
  await expect(monitor).toContainText('not used');
  await expect(monitor).toContainText('first half of a value');
});
