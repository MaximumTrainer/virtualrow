import { defineConfig } from '@playwright/test';

/**
 * CI-specific Playwright configuration
 * Use with: npm run test:e2e:ci
 * 
 * Excludes tests with known issues in GitHub Actions environment:
 * - WebGL context loss in headless Chromium causing 3D animation tests to fail
 * - Network firewall restrictions blocking external map tile requests
 * 
 * Use --grep-invert flag to exclude: "plays a single route with PM5 & HR simulators"
 * This test requires stable WebGL context which is not available in headless CI.
 */
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
      // NOTE: SwiftShader enables software GL rendering in headless mode.
      // `--enable-unsafe-swiftshader` is required for newer Chromium versions
      // where automatic SwiftShader fallback was changed. This flag bypasses
      // GPU sandbox restrictions and should only be used in CI/test environments.
      args: ['--enable-unsafe-webgl', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
    },
    // Capture screenshots as test evidence - both on failure and success
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
  },
});
