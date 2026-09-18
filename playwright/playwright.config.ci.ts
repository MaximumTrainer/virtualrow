import { defineConfig } from '@playwright/test';
import { responsiveProjects } from './viewports';

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
  // Same responsive matrix as the local config (issue #195). Rendering one
  // viewport in CI is what let the phone and short-landscape clipping through.
  projects: responsiveProjects(),
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
    // Only when something went wrong.
    //
    // A screenshot of a passing test is a framebuffer readback and a PNG
    // encode, per test, on a software rasteriser - paid about a hundred times a
    // run for images nobody opens. Failures still capture one, which is the
    // case where it earns its cost.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL ? undefined : {
    // The built app, not the dev server.
    //
    // Vite dev serves every module separately and runs a development build of
    // React, where StrictMode mounts each component twice - so the scene was
    // built, torn down and built again for every spec, and the suite paid for
    // it. A production build ignores StrictMode's double invoke. Measured on
    // three of the heavier 3D specs: 168s of test time on the dev server, 126s
    // on the built app, with scene-contrast going from 30.6s to 13.6s.
    //
    // It is also the artifact a rower actually loads, which is the one worth
    // asserting against.
    // Both through npm, so they run at the package root: a bare `vite preview`
    // takes its cwd from this config's directory and looks for playwright/dist.
    command: 'npm run build && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    // Long enough to build and then serve.
    timeout: 240 * 1000,
  },
});
