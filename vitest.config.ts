import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  test: {
    exclude: ['playwright/**', 'node_modules/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/setupTests.ts'],
    environmentMatchGlobs: [
      ['src/__tests__/*.perf.test.ts', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['playwright/**', 'src/main.tsx', 'src/types/**'],
      thresholds: {
        lines: 60,
        functions: 40,
        statements: 60,
        branches: 65,
      },
    },
  },
});
