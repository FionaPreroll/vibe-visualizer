import { defineConfig, devices } from '@playwright/test';

/**
 * The soak test (NF-06): the app plays for a long time, and its memory must stay flat. It is
 * not part of `pnpm test:e2e`: run it with `pnpm test:soak` (SOAK_MINUTES, 30 by default), or
 * with the Soak workflow on GitHub.
 */
const minutes = Number(process.env['SOAK_MINUTES'] ?? 30);
const executablePath = process.env['PW_CHROMIUM_PATH'] || undefined;

export default defineConfig({
  testDir: 'tests/soak',
  timeout: (minutes + 10) * 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The full Chromium (its new headless mode): Playwright's headless shell has no
        // performance.measureUserAgentSpecificMemory.
        channel: 'chromium',
        launchOptions: {
          executablePath,
          args: [
            // Software WebGL for headless runs without a GPU; autoplay without a user gesture.
            '--enable-unsafe-swiftshader',
            '--autoplay-policy=no-user-gesture-required',
            // The memory measured at once, not after the next idle garbage collection.
            '--enable-blink-features=ForceEagerMeasureMemory',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
