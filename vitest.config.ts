import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `.glsl` files are shaders, not modules (#341).
  //
  // They are imported with `?raw` and spliced into three's own shaders at
  // `onBeforeCompile`, which is the only thing that can compile them. Without
  // this, `vitest related` - which walks the module graph of a changed file -
  // hands one to the JS parser and fails on the first line of GLSL that is not
  // also valid JavaScript. The direct run never hit it, so the pre-commit hook
  // was the first thing to notice.
  assetsInclude: ['**/*.glsl'],
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
        // #379 took the reading from 92.69 / 84.71 / 88.58 on main to
        // 92.81 / 84.93 / 88.74 (lines / branches / functions), by moving the
        // procedural landscape's layout out of the excluded bankComponents.tsx
        // into a tested module. Branches go up, now 0.93 clear of 84; lines
        // (0.81 clear of 92) and functions (0.74 clear of 88) stay, by the
        // same rule as above.
        // #333 took main's 92.81 / 84.93 / 88.74 to 93.12 / 85.35 / 89.25 with
        // the billboard foliage: four new modules, all measured and reached,
        // and the cone trees they replace gone from an excluded file. Lines
        // are now 1.12 clear of 92 and functions 1.25 clear of 88, so both
        // move up a point; branches (0.35 clear of 85) stay.
        //
        // #335 and #344 then moved the metric strip out of App.tsx and onto
        // the stage, turning ~90 lines of untested JSX in a 1600-line
        // component into a component, a plan module and two hooks that are
        // covered outright: 93.26 / 85.60 / 89.47. The floors stay where #333
        // left them. Nothing is a point clear of the next integer - lines are
        // 0.26 past 93, branches 0.60 past 85, functions 0.47 past 89 - and a
        // floor set inside that margin is one that flaps.
        //
        // #346 put the conditions presets under test - the preset table, the
        // sun's one position, the remembered choice and the picker, all new
        // modules covered outright. The reading is 93.60 / 86.14 / 90.16. By
        // the rule above, branches and functions are each more than a point
        // clear of the next integer (1.14 and 1.16), so both move up; lines
        // are 0.60 past 93 and stay.
        lines: 92,
        statements: 92,
        branches: 85,
        functions: 89,
        // boatComponents moved on every axis when #322 took the physics engine
        // out and `boatComponents.test.tsx` started mounting the controller:
        // lines 79 -> 85, functions 50 -> 75, branches 77 -> 70. The branch
        // ratio fell because the denominator grew - 12 of 17 covered where it
        // was 10 of 13 - which is the same shape as admitting a file to the
        // measurement, one file down. Two axes up, one recorded where it lands.
        // #323's wake module is pure and canvas-only, so all of it is reachable
        // from jsdom and all of it is reached. Pinned at the reading so the
        // scene's one testable-in-full module cannot quietly stop being one.
        '**/wakeTexture.ts': { lines: 100, statements: 100, branches: 100, functions: 100 },
        // #379's two new modules decide where the water ends and where the
        // procedural landscape stands, and both are pure and reached in full.
        // Pinned for the same reason as the wake: the layout slipped out of
        // measurement once, inside an excluded component, and kept measuring
        // from the centreline while the water beside it widened.
        '**/sceneryClearance.ts': { lines: 100, statements: 100, branches: 100, functions: 100 },
        '**/landscapeLayout.ts': { lines: 100, statements: 100, branches: 100, functions: 100 },
        // #333's foliage: the leaf texture and the material are reached in
        // full, the plan and the component on every line with one branch each
        // unreached (97.36 and 97.29). Pinned so the modules
        // that decide where a forest stands, and what it costs to draw, stay
        // measured the way the landscape beside them is.
        '**/foliageTexture.ts': { lines: 100, statements: 100, branches: 100, functions: 100 },
        '**/foliageMaterial.ts': { lines: 100, statements: 100, branches: 100, functions: 100 },
        '**/foliagePlan.ts': { lines: 100, statements: 100, branches: 97, functions: 100 },
        '**/foliageComponents.tsx': { lines: 100, statements: 100, branches: 97, functions: 100 },
        '**/boatComponents.tsx': { lines: 85, statements: 85, branches: 70, functions: 75 },
        // skyComponents was 60 / 100 / 50 when #343 admitted it. #325 mounts it
        // directly to prove the sky stays out of the fog, taking lines to 88.52
        // and functions to 100. Branches read 100 only because there were four
        // of them; there are twenty now, 15 covered. A per-file 100 is a floor
        // that any new branch breaks, which is what happened here - 70 is the
        // reading rounded down with room to move.
        // #364 then took out the horizon's switch on a theme's silhouette
        // type, of which only the hills could be reached: 89.04 / 77.27 on
        // main became 98.38 / 100. A point under the lines, and branches held
        // back for the same reason as before.
        '**/skyComponents.tsx': { lines: 97, statements: 97, branches: 90, functions: 100 },
      },
    },
  },
});
