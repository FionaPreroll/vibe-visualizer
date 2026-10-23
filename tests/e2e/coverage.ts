import { readFileSync } from 'node:fs';
import type { CDPSession, Page } from '@playwright/test';
import MCR from 'monocart-coverage-reports';

/**
 * The end-to-end tests' coverage (#38). With E2E_COVERAGE set, the Chromium run takes V8's
 * coverage of each page and of its workers through the DevTools protocol, and the build has
 * source maps (vite.config.ts), by which monocart-coverage-reports maps the coverage of the
 * bundles back to our sources. Each test adds its own; the end of the run writes
 * coverage/e2e/lcov.info (coverage-global.ts), which CI sends to Codecov beside the unit tests'.
 */
export const COVERAGE = Boolean(process.env['E2E_COVERAGE']);

/** Where the preview server serves the app (playwright.config.ts). */
const ORIGIN = 'http://localhost:4173';

/** The file of dist/ that the preview server serves at `url`. */
function inDist(url: string): string {
  return `dist${new URL(url).pathname}`;
}

export const COVERAGE_OPTIONS: MCR.CoverageReportOptions = {
  name: 'End-to-end tests',
  outputDir: 'coverage/e2e',
  reports: [['lcovonly', { file: 'lcov.info' }], ['console-summary']],
  // The app's bundles: what their source maps hold is counted, not the bundles.
  entryFilter: (entry) => entry.url.startsWith(`${ORIGIN}/assets/`),
  // Our code, not that of the packages in the bundles.
  sourceFilter: (path) => /^(src|packages\/[^/]+\/src)\//.test(path),
  sourceMapResolver: async (url) => readFileSync(inDist(url), 'utf8'),
};

/** V8's coverage of a script: its functions with the ranges they ran, and how often. */
interface ScriptCoverage {
  url: string;
  functions: { ranges: { count: number }[] }[];
}

/** A reply of a worker to a command sent to it. */
interface Reply {
  id?: number;
  result?: { result?: ScriptCoverage[] };
}

/**
 * How often the coverage of the workers is taken: a worker can end before the test does (an
 * export's, or the visuals' of a second screen), and its coverage with it. What it runs in its
 * last half second is not counted.
 */
const WORKER_INTERVAL_MS = 500;

/** Longest wait for a worker's reply: it may end before it answers. */
const REPLY_TIMEOUT_MS = 5000;

/**
 * The coverage of a page and its workers, from its start until {@link stop}. The workers are
 * reached through the page's own session (not flattened), so that Playwright's stay its own.
 */
export class PageCoverage {
  /** The workers by their session, with the replies they owe. */
  private readonly workers = new Map<string, Map<number, (reply: Reply | null) => void>>();
  /** The scripts of each worker whose coverage was kept once in full (see {@link keep}). */
  private readonly seen = new Set<string>();
  private readonly taken: ScriptCoverage[] = [];
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | undefined;

  private constructor(private readonly cdp: CDPSession) {}

  static async start(page: Page): Promise<PageCoverage> {
    const cdp = await page.context().newCDPSession(page);
    const coverage = new PageCoverage(cdp);
    cdp.on('Target.attachedToTarget', ({ sessionId }) => void coverage.attached(sessionId));
    cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
      if (sessionId) coverage.detached(sessionId);
    });
    cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
      if (sessionId) coverage.received(sessionId, message);
    });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    // Each worker waits at its start until its coverage runs.
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
      filter: [{ type: 'worker' }, { exclude: true }],
    });
    coverage.timer = setInterval(() => void coverage.takeWorkers(), WORKER_INTERVAL_MS);
    return coverage;
  }

  /** Ends the coverage: what the page and its workers ran. */
  async stop(): Promise<ScriptCoverage[]> {
    clearInterval(this.timer);
    await this.takeWorkers();
    try {
      const { result } = await this.cdp.send('Profiler.takePreciseCoverage');
      this.taken.push(...result);
      await this.cdp.detach();
    } catch {
      // The page was closed: what its own scripts ran is lost (its workers' is not).
    }
    return this.taken;
  }

  private async attached(sessionId: string): Promise<void> {
    this.workers.set(sessionId, new Map());
    try {
      await this.send(sessionId, 'Profiler.enable');
      await this.send(sessionId, 'Profiler.startPreciseCoverage', {
        callCount: true,
        detailed: true,
      });
    } finally {
      await this.send(sessionId, 'Runtime.runIfWaitingForDebugger');
    }
  }

  private detached(sessionId: string): void {
    const pending = this.workers.get(sessionId);
    this.workers.delete(sessionId);
    for (const resolve of pending?.values() ?? []) resolve(null);
  }

  private received(sessionId: string, message: string): void {
    const reply = JSON.parse(message) as Reply;
    if (reply.id === undefined) return;
    const pending = this.workers.get(sessionId);
    pending?.get(reply.id)?.(reply);
    pending?.delete(reply.id);
  }

  /** Sends a command to a worker: its reply, or null when the worker is gone. */
  private send(sessionId: string, method: string, params: object = {}): Promise<Reply | null> {
    const pending = this.workers.get(sessionId);
    if (!pending) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => answer(null), REPLY_TIMEOUT_MS);
      const answer = (reply: Reply | null) => {
        clearTimeout(timeout);
        pending.delete(id);
        resolve(reply);
      };
      pending.set(id, answer);
      const message = JSON.stringify({ id, method, params });
      this.cdp.send('Target.sendMessageToTarget', { sessionId, message }).catch(() => answer(null));
    });
  }

  /** Takes what each worker ran since the last time. */
  private async takeWorkers(): Promise<void> {
    await Promise.all(
      [...this.workers.keys()].map(async (sessionId) => {
        const reply = await this.send(sessionId, 'Profiler.takePreciseCoverage');
        this.keep(sessionId, reply?.result?.result ?? []);
      }),
    );
  }

  /**
   * Keeps a worker's coverage. A script's first is kept whole: its functions that did not run
   * say what was not covered. After that, only the functions that ran count, which keeps what is
   * taken every half second small.
   */
  private keep(sessionId: string, scripts: ScriptCoverage[]): void {
    for (const script of scripts) {
      if (!script.url.startsWith(ORIGIN)) continue;
      const key = `${sessionId} ${script.url}`;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        this.taken.push(script);
        continue;
      }
      const ran = script.functions.filter((fn) => fn.ranges.some((range) => range.count > 0));
      if (ran.length) this.taken.push({ ...script, functions: ran });
    }
  }
}

/** The text of each bundle, read once per process. */
const sources = new Map<string, string>();
let report: MCR.CoverageReport | undefined;

/** Adds what a test ran to the coverage of the run. */
export async function addCoverage(taken: ScriptCoverage[]): Promise<void> {
  const entries = taken
    .filter((entry) => entry.url.startsWith(`${ORIGIN}/assets/`))
    .map((entry) => {
      let source = sources.get(entry.url);
      if (source === undefined) {
        source = readFileSync(inDist(entry.url), 'utf8');
        sources.set(entry.url, source);
      }
      return { ...entry, source };
    });
  report ??= MCR(COVERAGE_OPTIONS);
  if (entries.length) await report.add(entries);
}
