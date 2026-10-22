import { defineConfig, devices } from '@playwright/test';

/**
 * The performance measurements (tests/perf): the app plays and exports, and what `?perf`
 * measures is written to PERF_OUT (perf-results by default), with a Chromium trace of each
 * scenario. Not part of `pnpm test:e2e`: run it with `pnpm test:perf`, then `pnpm perf:report`,
 * or with the Perf workflow on GitHub, which compares a pull request with its base.
 *
 * PERF_DIST serves another build of the app (the base's, for a comparison) instead of building
 * this checkout. Builds to measure are not minified and have source maps (`pnpm build:perf`), so
 * the long frames name their functions and the traces show the source.
 */
const executablePath = process.env['PW_CHROMIUM_PATH'] || undefined;
const dist = process.env['PERF_DIST'];
const preview = `pnpm exec vite preview --port 4174 --strictPort${dist ? ` --outDir ${dist}` : ''}`;

export default defineConfig({
  testDir: 'tests/perf',
  // The report's own unit tests (report.test.ts) are Vitest's.
  testMatch: '*.spec.ts',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The full Chromium (its new headless mode), closer to Chrome than the headless shell.
        channel: 'chromium',
        launchOptions: {
          executablePath,
          // Software WebGL for headless runs without a GPU; autoplay without a user gesture.
          args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
  webServer: {
    command: dist ? preview : `pnpm build:perf && ${preview}`,
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
