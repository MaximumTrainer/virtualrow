import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Setting `exclude` *replaces* vitest's defaults rather than extending
    // them, so the node_modules glob has to be recursive: a nested
    // node_modules (an agent worktree under .claude/, say) otherwise gets
    // collected and we run our dependencies' own test suites.
    exclude: ['playwright/**', '**/node_modules/**', '.claude/**', 'dist/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Setting `exclude` *replaces* vitest's defaults rather than extending
      // them (same trap as `test.exclude` above). Without the first four
      // entries a stray worktree under .claude/ or a nested node_modules
      // inflates the denominator and the gate fails on code we don't own.
      //
      // Measured 2026-08-31 with these exclusions on the issue-221 upload branch:
      // 86.00% lines / 80.22% branches / 80.38% functions (was 84.63 / 78.82 /
      // 77.80 before the activity stream, the FIT encoder and the upload
      // service landed).
      exclude: [
        '**/node_modules/**',
        '.claude/**',
        'dist/**',
        'coverage/**',
        'playwright/**',
        // Build-time asset generators and utility scripts — not app logic.
        'scripts/**',
        // Test helpers (canvasMock and friends). Vitest drops the spec files
        // themselves, but a helper module beside them would otherwise count as
        // app code and flatter the ratio (issue #219).
        'src/__tests__/**',
        // Generated Wasm bindings — tested through the services that call them.
        'src/wasm-pkg/**',
        'src/main.tsx',
        'src/types/**',
        // R3F 3D scene components — exercised by Playwright E2E; pure utilities
        // (curve, helpers, themeConfig) are unit-tested separately.
        'src/components/Rower3D.tsx',
        'src/components/rower3d/effectComponents.tsx',
        'src/components/rower3d/waterComponents.tsx',
        'src/components/rower3d/bankComponents.tsx',
        'src/components/rower3d/vegetationComponents.tsx',
        'src/components/rower3d/skyComponents.tsx',
        'src/components/rower3d/boatComponents.tsx',
        'src/components/rower3d/themes/**',
        // 3D scene asset packs — large, mostly geometry/material constants.
        'src/components/routeLandmarks/**',
        // Dev-only on-screen simulators (Bluetooth/PM5/HR/route generator UIs).
        'src/components/PM5Simulator.tsx',
        'src/components/HeartRateSimulator.tsx',
        'src/components/HeartRateZonesChart.tsx',
        'src/components/FTMSDevice.tsx',
        'src/components/RouteImport.tsx',
        'src/components/WorkoutGenerator.tsx',
        'src/components/WorkoutProgressDisplay.tsx',
        'src/components/GuestSessionSummary.tsx',
        'src/components/ErrorBoundary.tsx',
        // Pure coordinate-data exports (no executable logic).
        'src/data/**',
        // Vendor JS + hand-written ambient declarations.
        'src/vendor/**',
      ],
      thresholds: {
        // Locked to the measured floor (rounded down) so the gate enforces
        // "don't regress". Ratchet upward as coverage improves.
        // Last measured 2026-08-31: 86.00 / 80.22 / 80.38 (issue #221).
        lines: 86,
        statements: 86,
        branches: 80,
        functions: 80,
      },
    },
  },
});
