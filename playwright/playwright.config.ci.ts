import { defineConfig } from '@playwright/test';

/**
 * CI-specific Playwright configuration
 * Use with: npm run test:e2e:ci
 * 
 * Optimized for WebGL/THREE.js rendering in headless CI environments:
 * - Uses SwiftShader for software-based WebGL rendering
 * - Disables GPU features that can cause context loss in headless mode
 * - Increased timeout for software rendering performance
 * 
 * To run all tests including WebGL-heavy tests, ensure LIBGL_ALWAYS_SOFTWARE=1
 * environment variable is set in the CI pipeline.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 90 * 1000, // Increased timeout for software rendering
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10 * 1000, // Increased action timeout for WebGL operations
    // Ensure WebGL works in headless CI by enabling swiftshader/software GL fallback
    launchOptions: {
      // Chrome flags for stable WebGL in headless mode:
      // - SwiftShader provides software GL rendering
      // - Disable GPU features that can cause context loss
      // - Use single process to reduce memory pressure
      args: [
        '--enable-unsafe-webgl',
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-gpu-rasterization',
        '--disable-gpu-compositing',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage', // Prevent shared memory issues in Docker/CI
        '--disable-setuid-sandbox',
        '--single-process', // Reduce memory fragmentation
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
    timeout: 60 * 1000, // Give dev server time to start
  },
});
