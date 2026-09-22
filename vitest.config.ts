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
      // Measured 2026-09-03 completing issue #67: 87.92% lines / 82.65%
      // branches / 83.02% functions (was 87.13 / 81.70 / 81.71 before the
      // structured-workout library, overlay and hook landed). The two
      // WorkoutGenerator/WorkoutProgressDisplay exclusions went with it: those
      // files never existed, and the workout UI that does is unit-tested.
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
        //
        // boatComponents.tsx and skyComponents.tsx came off this list with
        // #343: `rowerScene.smoke.test.tsx` mounts the real scene through
        // @react-three/test-renderer, so they are unit-tested now and the TDD
        // guard asks for a test when they change. That is the point of the
        // exercise - this list is where the wrong-axis normal (#298) and the
        // rower who never moved (#273) both survived review.
        //
        // Rower3D.tsx stays for now. The smoke tests reach 56% of its lines and
        // 23% of its functions, because most of what is left is per-frame
        // decisions inlined in one 1100-line useFrame. Admitting it at 23%
        // would drag the whole gate down to buy a floor too low to catch
        // anything. It comes off when #328, #329 and #331 move those decisions
        // into pure modules, which is what #343 asks for and they deliver.
        'src/components/Rower3D.tsx',
        'src/components/rower3d/effectComponents.tsx',
        'src/components/rower3d/waterComponents.tsx',
        'src/components/rower3d/bankComponents.tsx',
        'src/components/rower3d/routeStripChunks.tsx',
        'src/components/rower3d/vegetationComponents.tsx',
        // Same class as its siblings above: an R3F component that loads GLBs and
        // suspends. Its logic lives in sceneryPlacement.ts and sceneryAssets.ts,
        // both unit-tested; the component itself is covered by Playwright.
        'src/components/rower3d/sceneryModels.tsx',
        // 3D scene asset packs — large, mostly geometry/material constants.
        // Dev-only on-screen simulators (Bluetooth/PM5/HR/route generator UIs).
        'src/components/PM5Simulator.tsx',
        'src/components/HeartRateSimulator.tsx',
        'src/components/HeartRateZonesChart.tsx',
        'src/components/FTMSDevice.tsx',
        'src/components/RouteImport.tsx',
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
        //
        // Two things moved it on 2026-09-21, and they pull opposite ways.
        //
        // #340 set lines and statements to 91 from a 91.02 reading taken on its
        // own branch, while main measured 90.95 - so `npm run coverage`, and
        // with it every `pre-push`, failed on a tree nobody had changed. A
        // floor set within a rounding error of its measurement is not a floor.
        //
        // #343 then brought boatComponents.tsx and skyComponents.tsx into the
        // measurement for the first time, by mounting the real scene in Vitest.
        // That is ~640 statements at about 73% joining the denominator: the
        // ratio falls, the amount of checked code rises. Against the floor
        // these changes started from - 88 / 82 / 83 - every axis is up.
        //
        // So: a point clear of the reading, so the gate answers "did this
        // regress" rather than "did the last digit move", and per-file floors
        // below so the two newly measured files cannot slip whatever the
        // global does.
        // Raised by #345: deleting a WebGPU probe nothing used, and testing
        // Canvas3DErrorBoundary for the first time, put the reading at
        // 91.23 / 83.80 / 87.32. Lines and functions go up; branches stay,
        // being only 0.80 clear of 84 and not worth a floor that flaps.
        lines: 91,
        statements: 91,
        branches: 83,
        functions: 87,
        // boatComponents moved on every axis when #322 took the physics engine
        // out and `boatComponents.test.tsx` started mounting the controller:
        // lines 79 -> 85, functions 50 -> 75, branches 77 -> 70. The branch
        // ratio fell because the denominator grew - 12 of 17 covered where it
        // was 10 of 13 - which is the same shape as admitting a file to the
        // measurement, one file down. Two axes up, one recorded where it lands.
        '**/boatComponents.tsx': { lines: 85, statements: 85, branches: 70, functions: 75 },
        // skyComponents was 60 / 100 / 50 when #343 admitted it. #325 mounts it
        // directly to prove the sky stays out of the fog, taking lines to 88.52
        // and functions to 100. Branches read 100 only because there were four
        // of them; there are twenty now, 15 covered. A per-file 100 is a floor
        // that any new branch breaks, which is what happened here - 70 is the
        // reading rounded down with room to move.
        '**/skyComponents.tsx': { lines: 88, statements: 88, branches: 70, functions: 100 },
      },
    },
  },
});
