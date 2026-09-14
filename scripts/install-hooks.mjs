#!/usr/bin/env node
/**
 * Points git at the version-controlled hooks in .githooks/.
 *
 * Runs from the `prepare` npm script, so `npm install` wires the gate up for
 * every clone. Silent no-op outside a git work tree (a tarball install, a
 * container build) — a missing repository is not an error worth failing on.
 */
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();

try {
  git('rev-parse', '--is-inside-work-tree');
} catch {
  process.exit(0);
}

git('config', 'core.hooksPath', '.githooks');
console.log('git hooks: core.hooksPath → .githooks (pre-commit, pre-push)');
