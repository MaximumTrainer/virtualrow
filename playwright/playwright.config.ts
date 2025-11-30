import { defineConfig } from '@playwright/test';

/**
 * Local Playwright configuration
 * Use with: npm run test:e2e
 * 
 * Optimized for WebGPU/WebGL/THREE.js rendering in headless local environments.
 * The app will automatically use WebGPU when available, falling back to WebGL.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 90_000, // 90 seconds
  retries: 2,
  // In CI, force single worker to avoid parallel servers and port conflicts
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000, // 10 seconds
    // Ensure GPU rendering works in headless CI by enabling swiftshader/software GL fallback
    // Note: WebGPU requires hardware support; in CI environments, WebGL fallback is used
    launchOptions: {
      // NOTE: swiftshader enables software GL rendering in headless mode. The
      // `--enable-unsafe-swiftshader` flag is required for some Chromium builds
      // when automatic fallback is deprecated. This is only intended for CI
      // or test environments and may have lower security guarantees.
      // Additional flags for stability:
      // --disable-gpu-rasterization, --disable-gpu-compositing: Prevent GPU sandbox issues
      // --disable-dev-shm-usage: Avoid /dev/shm limitations in containers
      args: [
        '--enable-unsafe-webgl',
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-gpu-rasterization',
        '--disable-gpu-compositing',
        '--disable-dev-shm-usage'
      ]
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
    timeout: 60 * 1000,
  },
});
