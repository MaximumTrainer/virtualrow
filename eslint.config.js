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
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
