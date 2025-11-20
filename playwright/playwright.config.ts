import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60 * 1000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 5 * 1000,
    // Ensure WebGL works in headless CI by enabling swiftshader/software GL fallback
    launchOptions: {
      // NOTE: swiftshader enables software GL rendering in headless mode. The
      // `--enable-unsafe-swiftshader` flag is required for some Chromium builds
      // when automatic fallback is deprecated. This is only intended for CI
      // or test environments and may have lower security guarantees.
      args: ['--enable-unsafe-webgl', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu']
    },
    // Diagnostics and artifacts for debugging flaky tests in CI
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
  },
});
