import { defineConfig, devices } from '@playwright/test';

// PW_CHROMIUM_PATH lets environments with a pre-installed Chromium (e.g. cloud sandboxes) skip
// the browser download.
const executablePath = process.env['PW_CHROMIUM_PATH'] || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  // On CI (few cores, no GPU) one test at a time: the software-rendered exports would otherwise
  // compete for the CPU and miss their timeouts.
  workers: process.env['CI'] ? 1 : undefined,
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
    {
      // The second browser (NF-02): the main paths, the tests tagged @firefox.
      name: 'firefox',
      grep: /@firefox/,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            // Software WebGL for headless runs without a GPU; sound without a user gesture.
            'webgl.force-enabled': true,
            'media.autoplay.default': 0,
            'media.autoplay.block-webaudio': false,
          },
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
