import { defineConfig } from '@playwright/test';

/**
 * CI-specific Playwright configuration
 * Use with: npm run test:e2e:ci
 * 
 * Optimized for GitHub Actions environment with:
 * - Software GL rendering via SwiftShader for WebGL fallback (WebGPU requires hardware)
 * - Single worker to avoid port conflicts
 * - Extended timeouts and retries for CI reliability
 * - GPU sandbox workarounds for headless Chromium
 * 
 * Note: The app supports WebGPU when available but falls back to WebGL in CI.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 160_000, // 160 seconds — CI machines are slower; route test has many async waits
  retries: 2,
  // In CI, force single worker to avoid parallel servers and port conflicts
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000, // 10 seconds
    // Ensure GPU rendering works in headless CI by enabling swiftshader/software GL fallback
    // Note: WebGPU requires hardware GPU support; CI uses WebGL fallback
    launchOptions: {
      // NOTE: SwiftShader enables software GL rendering in headless mode.
      // `--enable-unsafe-swiftshader` is required for newer Chromium versions
      // where automatic SwiftShader fallback was changed. This flag bypasses
      // GPU sandbox restrictions and should only be used in CI/test environments.
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
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60 * 1000, // Give dev server time to start
  },
});
