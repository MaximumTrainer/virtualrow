import { defineConfig } from '@playwright/test';

/**
 * Viewport matrix for responsive coverage (issue #195).
 *
 * Until now every spec ran at a single 1280x720, which is why phone, tablet and
 * short-landscape clipping went unnoticed. `responsive.spec.ts` runs once per
 * entry below; every other spec keeps running at the default viewport only, so
 * suite runtime does not multiply.
 */
export const RESPONSIVE_VIEWPORTS = [
  { name: 'phone-portrait', width: 375, height: 667 },
  { name: 'phone-small', width: 320, height: 568 },
  { name: 'phone-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'uhd', width: 3840, height: 2160 },
  { name: 'short-wide', width: 1280, height: 500 },
] as const;

const RESPONSIVE_SPEC = '**/responsive.spec.ts';

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
  timeout: 120_000, // 120 seconds — generous budget for WebGL/BLE mock setup overhead
  retries: 2,
  // In CI, force single worker to avoid parallel servers and port conflicts
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  projects: [
    // Everything except the responsive matrix, at the historical viewport.
    { name: 'default', testIgnore: RESPONSIVE_SPEC },
    ...RESPONSIVE_VIEWPORTS.map((v) => ({
      name: v.name,
      testMatch: RESPONSIVE_SPEC,
      use: {
        viewport: { width: v.width, height: v.height },
        // 4K at dpr 2 would allocate a 7680x4320 backing store for no extra signal.
        deviceScaleFactor: 1,
        hasTouch: v.width <= 812,
        isMobile: false,
      },
    })),
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
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
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60 * 1000,
  },
});
