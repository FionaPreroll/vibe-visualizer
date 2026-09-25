/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { signalsmithStretchWasm } from './vite-plugins/signalsmith-stretch-wasm.ts';

// SharedArrayBuffer (used for the audio ring buffers) requires cross-origin isolation.
// Production hosting sends the same headers via public/_headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [svelte(), signalsmithStretchWasm()],
  worker: {
    format: 'es',
    plugins: () => [signalsmithStretchWasm()],
  },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  test: {
    include: ['src/**/*.test.ts', 'vite-plugins/**/*.test.ts'],
    environment: 'node',
  },
});
