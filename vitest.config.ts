import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['playwright/**', 'node_modules/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Coverage is measured against logic that *should* be unit-tested. The
      // exclusions below are validated by Playwright E2E or are vendor / pure
      // data assets that would skew the unit-test gate.
      exclude: [
        'playwright/**',
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
        // Thresholds locked to the current measured floor (rounded down) so the
        // gate enforces "don't regress". Ratchet upward as coverage improves.
        // Keys map to the v8 reporter's metric names.
        lines: 55,        // % of executable lines covered
        statements: 55,   // % of statements covered (mirrors `lines` for v8)
        branches: 65,     // % of branch arms covered
        functions: 50,    // % of declared functions invoked at least once
      },
    },
  },
});
