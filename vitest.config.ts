import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // #542 P0: compile `.svelte` components in unit tests. `svelteTesting()`
  // adds the `browser` resolve condition and `@testing-library/svelte`
  // auto-cleanup. The React component tests (still present until P1) keep
  // running through vitest's default esbuild transform alongside this.
  plugins: [svelte(), svelteTesting()],
  // `.glsl` files are shaders, not modules (#341).
  //
  // They are imported with `?raw` and spliced into three's own shaders at
  // `onBeforeCompile`, which is the only thing that can compile them. Without
  // this, `vitest related` - which walks the module graph of a changed file -
  // hands one to the JS parser and fails on the first line of GLSL that is not
  // also valid JavaScript. The direct run never hit it, so the pre-commit hook
  // was the first thing to notice.
  assetsInclude: ['**/*.glsl', '**/*.wgsl'],
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
        // #542 P0: SvelteKit's build output and generated files. `npm run build`
        // runs before `npm run coverage` in pre-push and CI, so these exist on
        // disk when coverage scans; without excluding them the compiled bundle
        // joins the denominator and the gate reads ~57% instead of ~91%.
        'build/**',
        '.svelte-kit/**',
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
        'src/lib/types/**',
        // #542 AC1 — the R3F / React component excludes that used to live here
        // (Rower3D.tsx, boat/sky/water/bank/vegetation/sceneryModels.tsx, the
        // on-screen simulator panels, ErrorBoundary) all target deleted files,
        // so there is nothing to exclude. The pure utilities they relied on
        // (`curve`, `helpers`, `themeConfig`) went with them; what remains
        // under `src/components/rower3d/` is the pure-TS scenery config and
        // segment tables that `src/lib/scenery/` and the Svelte UI import.
        // Pure coordinate-data exports (no executable logic).
        'src/data/**',
        // Vendor JS + hand-written ambient declarations.
        'src/lib/vendor/**',
        // #542 P1: the SvelteKit route glue — the shell layout and each screen's
        // `+page.svelte` — is the view-machine equivalent of the old App.tsx: it
        // wires context and composes the (unit-tested) `src/lib/ui` components and
        // stores into a screen, and is exercised end-to-end by the Playwright
        // suite, not in jsdom. Same class as the R3F scene components above. The
        // components and stores it mounts stay in coverage and are unit-tested.
        'src/routes/**/+layout.svelte',
        'src/routes/**/+layout.ts',
        'src/routes/**/+page.svelte',
        'src/routes/**/+page.ts',
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
        //
        // #446 added the FIT upload round-trip test and its byte-stable
        // fixture, reaching every remaining path in `fitEncoderService.ts`
        // that the unit test's short-session sample missed (three-lap laps
        // header, split-derived lap durations, the 1250-record path). The
        // reading is 94.04 / 86.83 / 90.98. Lines and statements are each
        // more than a point clear of the next integer (2.04 clear of 92), so
        // both move up; branches (1.83 clear) and functions (1.98 clear) are
        // less than a point clear of their next integer once ratcheted, so
        // both stay.
        //
        // #542 P0 re-based these. The branch upgraded Vitest 1 -> 3 (required:
        // the SvelteKit app runs on Vite 7, but Vitest 1 bundled Vite 5 and
        // cannot host the Vite-7-era `@sveltejs/vite-plugin-svelte`). Vitest 3's
        // `@vitest/coverage-v8` switched to AST-aware remapping, which attributes
        // hits differently from v1's line counting. The SAME tests over the SAME
        // code now read 91.01 / 91.01 / 87.95 / 91.87 (lines / statements /
        // branches / functions) where v1 read 94.04 / 86.83 / 90.98. This is a
        // measurement change, not a coverage regression: a lost test suite would
        // pull every axis down, but branches and functions both ROSE. So branches
        // and functions ratchet up to the new method's floor (87 / 91); lines and
        // statements re-base to 90 — a point of margin under the 91.01 reading,
        // since a floor set at 91.01's rounding edge flaps (the rule this block
        // has followed since #340). Ratchet all four upward again from here.
        //
        // #542 AC1 re-based again. Removing the React tree is a measurement
        // change on the same shape as #542 P0 (Vitest 1 -> 3): the tests that
        // only existed to pin the React/three.js scene went with the production
        // code they covered, so the denominator shrinks AND the parity suites
        // that happened to count toward other files' per-file 100 floors are
        // gone too. Measurement after the sweep: 89.00 / 89.00 / 85.77 / 90.66.
        // Floors a point under each reading, matching the "set a floor clear of
        // its measurement so the gate stops answering 'did the last digit move'"
        // rule above. Ratchet upward from here.
        lines: 88,
        statements: 88,
        branches: 84,
        functions: 89,
        // #542 AC1 — the per-file 100-floors below used to pin the React scene's
        // pure helpers (wakeTexture, foliageMaterial, foliageTexture, foliagePlan,
        // landscapeLayout, sceneryClearance) and the per-component gates on the
        // R3F wrappers (boatComponents, skyComponents, foliageComponents).
        // Those files all left with the React tree; sceneryClearance.ts is now
        // the only one that still exists in the surviving codebase, and its
        // test was a parity suite that happened to walk the shared helper, so
        // its coverage is coming back as the Svelte renderer adds engine-side
        // tests that exercise the same math. Dropped rather than lowered: a
        // reinstated floor lands with the port that now owns the measurement.
      },
    },
  },
});
