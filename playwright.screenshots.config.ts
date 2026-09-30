import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// PW_CHANNEL=chrome takes the screenshots in Google Chrome (the Screenshots workflow does), which
// encodes H.264 like most users' browsers, so the export dialog shows an MP4 export.
const channel = process.env['PW_CHANNEL'] || undefined;

/** The README screenshots (tests/screenshots): `pnpm screenshots` writes docs/screenshots. */
export default defineConfig({
  ...base,
  testDir: 'tests/screenshots',
  workers: 1,
  reporter: 'list',
  projects: base.projects?.map((project) => ({ ...project, use: { ...project.use, channel } })),
});
