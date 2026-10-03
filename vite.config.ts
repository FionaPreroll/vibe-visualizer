/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import { buildInfo } from './vite-plugins/build-info.ts';
import { productionHeaders } from './vite-plugins/production-headers.ts';
import { signalsmithStretchWasm } from './vite-plugins/signalsmith-stretch-wasm.ts';

// SharedArrayBuffer (used for the audio ring buffers) requires cross-origin isolation. The dev
// server sends only that (the content security policy would stop its hot reloading); the
// preview server sends all the headers of production, from public/_headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [svelte(), signalsmithStretchWasm(), buildInfo(packageJson.version)],
  worker: {
    format: 'es',
    plugins: () => [signalsmithStretchWasm()],
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
