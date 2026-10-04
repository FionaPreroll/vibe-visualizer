import { expect, test, type Page } from '@playwright/test';
import { startWithClassicLook } from './looks';
import { moreAction } from './topbar';
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

  await moreAction(page, 'controller-button');
  const dialog = page.getByTestId('controller-dialog');
  await dialog.getByTestId('controller-connect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await expect(dialog.getByTestId('controller-devices')).toContainText('Pioneer DJ DDJ-FLX2');
  // The ⋯ menu of the top bar, where the dialog is, shows that a controller is connected.
  await expect(page.getByTestId('more-dot')).toBeVisible();
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
  // The time shown follows the engine at the next frame, which comes late on a busy machine
  // (on CI, more than 250 ms late), while the jog wheel starts from where the engine stopped:
  // read the time after two frames were drawn, once it stands still.
  const shown = async () => {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    return elapsed();
  };
  const settled = async () => {
    let last = await shown();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(250);
      const now = await shown();
      if (now === last) break;
      last = now;
    }
    return last;
  };
  const paused = await settled();
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
  // The playhead goes to the marker, on the beat; the time it stands at then is the cue point.
  // (The light is no sign that it is there: until then it blinks, and is on half of the time.)
  const cuePoint = await settled();
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
  await moreAction(page, 'controller-button');
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await dialog.getByTestId('controller-disconnect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Not connected');
  // The lights go off when it is let go.
  expect(await light(page, 0x90, 0x0b)).toBe(0);
});

test('the jog wheel stays in the track, step by step', async ({ page, context }) => {
  await context.grantPermissions(['midi']);
  await page.goto('/');
  // At 16 kHz the files are resampled, and a step of the jog wheel (1.8 s / 460) moves less
  // than the 64 frames of the file the resampler needs before it gives anything: a run of steps
  // is sure to start that close to the end of a decoded block of the file (2048 frames). Such
  // a start used to be taken for the end of the file, and the next track followed.
  await page.getByTestId('file-input').setInputFiles([
    { name: 'One.wav', mimeType: 'audio/wav', buffer: createWav(10, 16000) },
    { name: 'Two.wav', mimeType: 'audio/wav', buffer: createWav(10, 16000) },
  ]);
  const items = page.getByTestId('queue-item');
  await expect(items.first()).toHaveAttribute('data-status', 'ready');
  await expect(items.nth(1)).toHaveAttribute('data-status', 'ready');
  await moreAction(page, 'controller-button');
  const dialog = page.getByTestId('controller-dialog');
  await dialog.getByTestId('controller-connect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await page.keyboard.press('Escape');
  const play = () => receive(page, [0x90, 0x0b, 0x7f], [0x90, 0x0b, 0x00]);
  await play();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await play();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');

  // 45 steps (2,800 frames of the file), far enough apart to be a seek each.
  for (let step = 0; step < 45; step++) {
    await receive(page, [0xb0, 0x22, 0x41]);
    await page.waitForTimeout(90);
  }
  await expect(items.first()).toHaveAttribute('aria-selected', 'true');
  // It plays on from there, in the same track.
  const elapsed = async () =>
    Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
  const jogged = await elapsed();
  await play();
  await expect.poll(elapsed).toBeGreaterThan(jogged + 0.5);
  await expect(items.first()).toHaveAttribute('aria-selected', 'true');
});

test('the playhead follows the jog wheel smoothly', async ({ page, context }) => {
  await context.grantPermissions(['midi']);
  await startWithClassicLook(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(60, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  await moreAction(page, 'controller-button');
  const dialog = page.getByTestId('controller-dialog');
  await dialog.getByTestId('controller-connect').click();
  await expect(dialog.getByTestId('controller-status')).toHaveText('Connected');
  await page.keyboard.press('Escape');
  const play = () => receive(page, [0x90, 0x0b, 0x7f], [0x90, 0x0b, 0x00]);
  await play();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Pause');
  await play();
  await expect(page.getByTestId('play-button')).toHaveAttribute('aria-label', 'Play');

  // Paused, 4 steps every 8 ms for 1.5 s, with the time shown read at every frame. The music
  // follows at most every 60 ms; the playhead used to wait for it, so it moved in one frame
  // out of nine.
  const shown = await page.evaluate(async () => {
    const midi = (window as unknown as { midi: { receive: (...m: number[][]) => void } }).midi;
    const elapsed = document.querySelector<HTMLElement>('[data-testid="elapsed"]')!;
    const seconds: number[] = [];
    let jogging = true;
    const frame = () => {
      seconds.push(Number(elapsed.dataset['seconds']));
      if (jogging) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        midi.receive([0xb0, 0x22, 0x44]);
        if (performance.now() - start < 1500) return;
        clearInterval(timer);
        jogging = false;
        resolve();
      }, 8);
    });
    return seconds;
  });
  const moves = shown.slice(1).filter((seconds, i) => seconds > shown[i]!).length;
  expect(moves / (shown.length - 1)).toBeGreaterThan(0.6);
});

test('the MIDI monitor shows what a controller sends', async ({ page }) => {
  await page.goto('/');
  await moreAction(page, 'controller-button');
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

test('what the controls do is in the help, which the dialog opens', async ({ page }) => {
  await page.goto('/');
  await moreAction(page, 'controller-button');
  const dialog = page.getByTestId('controller-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('controller-help').click();
  await expect(dialog).toBeHidden();
  const content = page.getByTestId('help-content');
  await expect(content).toHaveAttribute('data-section', 'dj-controller');
  await expect(content).toContainText('PLAY/PAUSE');
  await expect(content).toContainText('MIDI monitor');
});
