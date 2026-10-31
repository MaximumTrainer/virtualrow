import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Only ever lint what git tracks. Build output, coverage reports and
  // agent worktrees each carry their own copies of the source tree (and their
  // own node_modules), which otherwise land in the problem count and make the
  // CI gate below unmeasurable.
  globalIgnores([
    'dist',
    'build',
    // #542 P0: SvelteKit's generated output and type files (`.svelte-kit/`) are
    // not hand-written source and do not follow the project's lint rules.
    '.svelte-kit',
    'coverage',
    'test-results',
    'playwright-report',
    '.claude',
    'src/wasm-pkg',
  ]),

  // Baseline for every TypeScript file in the repo, React or not.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },

  // #550 AC6/NFR: on `next/svelte-webgpu` the WebGPU surface lives in
  // `src/lib/renderer/` (the hand-written engine). `@webgpu/types` is allowed
  // there and nowhere else; `three` is forbidden there, which is what makes
  // the engine framework-free.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/renderer/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@webgpu/types',
              message:
                "Import from 'src/lib/renderer/engine/health' or add new types under src/lib/renderer. " +
                '#550 NFR keeps `@webgpu/types` inside the renderer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message:
                "The engine is framework-free (#550 NFR). Port the math you need into src/lib/renderer/math instead of importing three.",
            },
          ],
          patterns: ['three/*'],
        },
      ],
    },
  },

  // A spec that imports the base `test` is a spec whose renderer can die
  // without anyone noticing.
  //
  // playwright/fixtures/crash-watch.ts wraps `test` with a guard that fails a
  // test whose page crashed, or whose tab was killed and reloaded without a
  // page-hide — the #301 shape, which raises no `crash` event at all. It is an
  // auto fixture, so a spec gets it by importing from there and nowhere else;
  // it re-exports everything else Playwright offers, so that is one import
  // line rather than two.
  //
  // A rule rather than a convention because the failure is silent: the suite
  // stays green either way, which is exactly the problem (#310).
  {
    files: ['playwright/tests/**/*.spec.ts'],
    ignores: [
      'playwright/tests/crash-detection.spec.ts',
      // #473 Phase 2: seeds a sessionStorage telemetry log with the "run-start
      // without page-hide" shape, which is exactly what crash-watch flags as a
      // crash — using the fixture would fail the spec for doing its job.
      'playwright/tests/crash-telemetry.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                "Import from '../fixtures/crash-watch' instead, so a renderer that dies " +
                'during this spec fails it. That module re-exports expect, Page and the ' +
                'rest unchanged.',
            },
          ],
        },
      ],
    },
  },
])
