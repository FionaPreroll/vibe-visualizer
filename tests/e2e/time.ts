import type { Page } from '@playwright/test';

/**
 * The time the transport bar shows for the playhead. It follows the engine at each frame, and a
 * busy machine (a CI runner drawing in software) draws its frames late: a time read at once may
 * be a frame behind the engine, a few hundred milliseconds there.
 */

/** The time shown (seconds), as it is now. */
export async function elapsed(page: Page): Promise<number> {
  return Number(await page.getByTestId('elapsed').getAttribute('data-seconds'));
}

/** The time shown once two more frames were drawn: where the engine is, not a frame before. */
export async function shown(page: Page): Promise<number> {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  return elapsed(page);
}

/**
 * Track seconds played per second of real time: the slope through every update of the elapsed
 * time, from the first one for at least `ms`, measured in the page. Each update is recorded as it
 * comes, so a slow display rate does not matter, nor frames that are long in coming.
 */
export function speed(page: Page, ms = 2000): Promise<number> {
  return page.evaluate(async (duration) => {
    const element = document.querySelector('[data-testid="elapsed"]')!;
    const points: [number, number][] = [];
    await new Promise<void>((resolve) => {
      const done = () => {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      // Only updates: each value is fresh at the moment it is recorded.
      const observer = new MutationObserver(() => {
        const now = performance.now() / 1000;
        points.push([now, Number(element.getAttribute('data-seconds'))]);
        if (now - points[0]![0] >= duration / 1000) done();
      });
      observer.observe(element, { attributes: true, attributeFilter: ['data-seconds'] });
      // Without updates, the time stands still.
      const timer = setTimeout(done, duration + 10_000);
    });
    if (points.length < 2) return 0;
    const meanTime = points.reduce((sum, [time]) => sum + time, 0) / points.length;
    const meanValue = points.reduce((sum, [, value]) => sum + value, 0) / points.length;
    let covariance = 0;
    let variance = 0;
    for (const [time, value] of points) {
      covariance += (time - meanTime) * (value - meanValue);
      variance += (time - meanTime) ** 2;
    }
    return covariance / variance;
  }, ms);
}
