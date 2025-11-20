import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['playwright/**', 'node_modules/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/setupTests.ts'],
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
