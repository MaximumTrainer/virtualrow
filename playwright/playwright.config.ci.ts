import { defineConfig } from '@playwright/test';
import { responsiveProjects } from './viewports';

/**
 * CI-specific Playwright configuration
 * Use with: npm run test:e2e:ci
 * 
 * Optimized for GitHub Actions environment with:
 * - Software GL rendering via SwiftShader
 * - Single worker to avoid port conflicts
 * - Extended timeouts and retries for CI reliability
 * - GPU sandbox workarounds for headless Chromium
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
    // The same path the deploy publishes under, not the domain root.
    //
    // deploy-pages.yml builds with --base=/virtualrow/app/ and this used to
    // build without one, so an asset URL written from the root worked in dev,
    // worked in the suite, and 404'd in production - which is exactly what
    // happened to every crewed scull and all 130 scenery models (#251, #286).
    // Specs navigate relatively, so they are unaffected by the prefix.
    baseURL: process.env.BASE_URL || 'http://localhost:5173/virtualrow/app/',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000, // 10 seconds
    // Ensure GPU rendering works in headless CI by enabling swiftshader/software GL fallback
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
    // Only once something has already failed.
    //
    // `retain-on-failure` means record for every test and delete after a
    // pass - so the suite was encoding video of a software-rasterised WebGL
    // canvas, and capturing traces with DOM snapshots, for all ~212 tests,
    // in a config whose stated purpose was to stop paying for captures on
    // tests that pass. `on-first-retry` captures nothing until a test has
    // failed once, and retries are 2 (#289).
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  webServer: process.env.BASE_URL ? undefined : {
    // The built app, not the dev server.
    //
    // Vite dev serves every module separately and runs a development build of
    // React, where StrictMode mounts each component twice - so the scene was
    // built, torn down and built again for every spec. Measured on three of
    // the heavier 3D specs locally: 168s of test time on the dev server, 126s
    // on the built app.
    //
    // That did not translate to CI, and the comment here used to claim it had.
    // Comparing the merge of #279 against its own parent - a diff of these two
    // files and nothing else - the e2e jobs went ubuntu 18m to 18m, windows 39m
    // to 38m, macos 26m to 27m. What actually relieved the Windows job was
    // moving the route traverses into their own job.
    //
    // It is kept because the double mount is real work the suite need not do,
    // and because a bundle is closer to what a rower loads than a dev server
    // is - though not identical: the deploy builds with --base=/virtualrow/app/
    // and this does not, which is the gap that let every GLB 404 in production
    // while dev and Playwright both served happily from / (#251).
    // Both through npm, so they run at the package root: a bare `vite preview`
    // takes its cwd from this config's directory and looks for playwright/dist.
    command:
      'npm run build -- --base=/virtualrow/app/ && ' +
      'npm run preview -- --base=/virtualrow/app/ --port 5173 --strictPort',
    url: 'http://localhost:5173/virtualrow/app/',
    reuseExistingServer: false,
    // Long enough to build and then serve.
    //
    // 240s was not: a local run hit "Timed out waiting 240000ms from
    // config.webServer" on a cold tsbuildinfo, and a CI machine is slower
    // again. A timeout here reports nothing about the app, so the budget is
    // generous on purpose.
    timeout: 360 * 1000,
    // `npm run build` is `tsc -b && vite build`, and tsc writes its diagnostics
    // to stdout - which Playwright discards unless asked for it. Without this a
    // type error surfaces only as "Process from config.webServer was not able
    // to start. Exit code: 2", with no file and no line.
    stdout: 'pipe',
  },
});
