import { defineConfig, devices } from '@playwright/test';

// PW_CHROMIUM_PATH lets environments with a pre-installed Chromium (e.g. cloud sandboxes) skip
// the browser download.
const executablePath = process.env['PW_CHROMIUM_PATH'] || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath,
          // Software WebGL for headless runs without a GPU; autoplay without a user gesture.
          args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
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
