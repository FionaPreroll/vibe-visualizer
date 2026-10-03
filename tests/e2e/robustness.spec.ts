import { expect, test, type Page } from '@playwright/test';
import { createWav } from './wav';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vibe-visualizer:welcome:v1', '1'));
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Keeps the audio contexts and worklet nodes the app makes, as `window.audio`. */
async function watchAudio(page: Page) {
  await page.addInitScript(() => {
    const audio = { contexts: [] as AudioContext[], nodes: [] as AudioWorkletNode[] };
    Object.assign(window, { audio });
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) {
        super(options);
        audio.contexts.push(this);
      }
    };
    const Node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Node {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        audio.nodes.push(this);
      }
    };
  });
}

type Audio = { contexts: AudioContext[]; nodes: AudioWorkletNode[] };

async function playClicks(page: Page) {
  await page.getByTestId('file-input').setInputFiles({
    name: 'Clicks.wav',
    mimeType: 'audio/wav',
    buffer: createWav(30, 44100),
  });
  await expect(page.getByTestId('queue-item')).toHaveAttribute('data-status', 'ready');
  const play = page.getByTestId('play-button');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
}

test('the music pauses with a message when the sound stops by itself (NF-09)', async ({ page }) => {
  const errors = collectErrors(page);
  await watchAudio(page);
  await page.goto('/');
  await playClicks(page);
  const play = page.getByTestId('play-button');
  const alert = page.getByTestId('app-error');

  // The system interrupts the sound (Safari says so): paused, and Play goes on.
  await page.evaluate(() => {
    const context = (window as unknown as { audio: Audio }).audio.contexts[0]!;
    Object.defineProperty(context, 'state', { value: 'interrupted', configurable: true });
    context.dispatchEvent(new Event('statechange'));
  });
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await expect(alert).toHaveText('The system interrupted the sound. Press Play to go on.');
  await page.evaluate(() => {
    const context = (window as unknown as { audio: Audio }).audio.contexts[0]!;
    delete (context as { state?: unknown }).state;
  });
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect(alert).toHaveCount(0);

  // A message the engine cannot take fails in the worklet: the engine reports it and goes on.
  await page.evaluate(() => {
    const node = (window as unknown as { audio: Audio }).audio.nodes[0]!;
    node.port.postMessage({ type: 'sound', settings: null });
  });
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await expect(alert).toContainText('The sound engine failed (');
  await expect(alert).toContainText('). Press Play to go on.');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await expect(alert).toHaveCount(0);
  // It still plays.
  const elapsed = page.getByTestId('elapsed');
  const before = Number(await elapsed.getAttribute('data-seconds'));
  await expect
    .poll(async () => Number(await elapsed.getAttribute('data-seconds')))
    .toBeGreaterThan(before + 0.5);

  // The audio device fails (Chromium tells), or the worklet stops for good.
  await page.evaluate(() => {
    const context = (window as unknown as { audio: Audio }).audio.contexts[0]!;
    context.dispatchEvent(new Event('error'));
  });
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await expect(alert).toHaveText(
    'The audio output failed. Check the output device. Press Play to go on.',
  );
  await page.evaluate(() => {
    const node = (window as unknown as { audio: Audio }).audio.nodes[0]!;
    node.dispatchEvent(new Event('processorerror'));
  });
  await expect(alert).toHaveText('The sound engine stopped. Reload the page to go on.');
  expect(errors).toEqual([]);
});

test('a browser without a feature the app needs says so instead (NF-02)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    delete (window as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    // Graphics acceleration turned off: WebGL 2 is refused.
    const getContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (
      this: OffscreenCanvas,
      ...args: Parameters<typeof getContext>
    ) {
      return args[0] === 'webgl2' ? null : getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto('/');
  const unsupported = page.getByTestId('unsupported');
  await expect(unsupported).toContainText('FibeStation cannot run in this browser');
  await expect(unsupported).toContainText('AudioWorklet: the sound is played and analysed in it.');
  await expect(unsupported).toContainText('WebGL 2: the visuals are drawn with it.');
  await expect(unsupported).toContainText('turn on graphics acceleration');
  await expect(page.getByTestId('visual-stage')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an error nobody handles shows, with details to copy and report (NF-10)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByTestId('visual-stage')).toHaveAttribute('data-status', 'running', {
    timeout: 15_000,
  });
  const notice = page.getByTestId('problem');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Test failure');
    });
  });
  await expect(notice).toContainText('Something went wrong: Test failure');
  await page.getByTestId('problem-copy').click();
  await expect(page.getByTestId('problem-copy')).toHaveText('Copied');
  const details = await page.evaluate(() => navigator.clipboard.readText());
  expect(details).toContain('App: Test failure');
  expect(details).toContain(`Browser: ${await page.evaluate(() => navigator.userAgent)}`);
  await expect(page.getByTestId('problem-report')).toHaveAttribute(
    'href',
    /^mailto:fipreroll\+app@gmail\.com\?subject=.*App%3A%20Test%20failure/,
  );

  // A promise rejected without a handler counts too; a cancelled one does not.
  await page.evaluate(() => {
    void Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    void Promise.reject(new Error('Rejected'));
  });
  await expect(notice).toContainText('Something went wrong (2 times): Rejected');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});
