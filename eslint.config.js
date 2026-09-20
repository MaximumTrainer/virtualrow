import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Only ever lint what git tracks. Build output, coverage reports and
  // agent worktrees each carry their own copies of the source tree (and their
  // own node_modules), which otherwise land in the problem count and make the
  // CI gate below unmeasurable.
  globalIgnores([
    'dist',
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

  // React rules apply to the app only. Playwright specs and build scripts are
  // not React, and the hooks plugin cannot tell Playwright's `use` fixture
  // callback from React's `use` hook — it reported three rules-of-hooks
  // violations in an earlier fixture file for ordinary fixture
  // code.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
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
    ignores: ['playwright/tests/crash-detection.spec.ts'],
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
