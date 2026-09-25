/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

import { speciesPlugin } from './scripts/vite-plugin-species.ts'

export default defineConfig({
  plugins: [vue(), tailwindcss(), speciesPlugin()],
  resolve: {
    // `@/lib` rather than `../../lib`. Mirrored in tsconfig.app.json paths —
    // both have to agree or the editor and the build disagree about imports.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // MapLibre's worker is an ES module (see AtlasMap.vue).
  worker: { format: 'es' },
  build: {
    // MapLibre is one ~800 kB module that can't be split further; it is loaded
    // once and cached. Raising the limit to just above it keeps the warning
    // meaningful for everything else.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
