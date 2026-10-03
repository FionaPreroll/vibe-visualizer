/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import { buildInfo } from './vite-plugins/build-info.ts';
import { productionHeaders } from './vite-plugins/production-headers.ts';
import { signalsmithStretchWasm } from './vite-plugins/signalsmith-stretch-wasm.ts';
import {
  buildToolNotices,
  emscriptenNotice,
  ffmpegNotice,
  PACKAGE_TEXTS,
} from './vite-plugins/third-party-extras.ts';
import { thirdPartyNotices } from './vite-plugins/third-party-notices.ts';

// SharedArrayBuffer (used for the audio ring buffers) requires cross-origin isolation. The dev
// server sends only that (the content security policy would stop its hot reloading); the
// preview server sends all the headers of production, from public/_headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// The parts of others in the app, with their licences, for About → Licences.
const notices = thirdPartyNotices({
  appName: 'FibeStation',
  // Its WASM comes in through a virtual module.
  packages: ['signalsmith-stretch'],
  texts: PACKAGE_TEXTS,
  extra: [ffmpegNotice(packageJson.bugs.email), emscriptenNotice(), ...buildToolNotices()],
  ours: (name) => name.startsWith('@fibestation/'),
});

export default defineConfig({
  plugins: [svelte(), signalsmithStretchWasm(), buildInfo(packageJson.version), notices.main],
  worker: {
    format: 'es',
    plugins: () => [signalsmithStretchWasm(), notices.worker()],
  },
  server: { headers: crossOriginIsolation },
  preview: { headers: productionHeaders() },
  test: {
    include: [
      'src/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'vite-plugins/**/*.test.ts',
      'tests/eval/**/*.test.ts',
    ],
    environment: 'node',
  },
});
