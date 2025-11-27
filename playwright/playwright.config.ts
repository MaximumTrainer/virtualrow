import { defineConfig, devices } from '@playwright/test';

/**
 * Local Playwright configuration
 * Use with: npm run test:e2e
 * 
 * Optimized for WebGL/THREE.js rendering in headless local environments.
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
      args: [
        '--enable-unsafe-webgl',
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-gpu-rasterization',
        '--disable-gpu-compositing',
        '--disable-dev-shm-usage', // Prevent shared memory issues
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
