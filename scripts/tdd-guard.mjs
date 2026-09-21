/**
 * Outside-in TDD guard — the static half of the pre-commit gate.
 *
 * Run with no arguments it inspects the git index and reports:
 *   - production code staged without a test that names it (agents.md §1),
 *   - focused specs (`it.only` and friends) that would silently shrink the suite,
 *   - coverage thresholds edited downward in vitest.config.ts.
 *
 * Exit code 1 blocks the commit. Warnings print and pass.
 *
 * The exemption list is read from `test.coverage.exclude` in vitest.config.ts so
 * there is one source of truth: if a file counts toward the coverage gate it
 * needs a test; if it is excluded there (3D scene, vendor, generated) it does not.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.([cm]?[jt]sx?)$/;
const TEST_DIRECTORIES = ['src/__tests__', 'playwright/tests'];
const COVERAGE_METRICS = ['lines', 'statements', 'branches', 'functions'];

/** Files that never need a test of their own, on top of the coverage exclusions. */
const ALWAYS_EXEMPT = ['**/*.d.ts', 'src/setupTests.ts', 'src/assets/**', 'src/**/*.css'];

const stripComments = (source) => source.replace(/\/\/[^\n]*/g, '');

const literalsBetween = (source, open, close) =>
  [...source.slice(open, close).matchAll(/['"`]([^'"`]+)['"`]/g)].map(([, value]) => value);

/** The `exclude` globs of `test.coverage` — not the ones of `test` itself. */
export function parseCoverageExclusions(configSource) {
  const source = stripComments(configSource);
  const coverageAt = source.indexOf('coverage:');
  if (coverageAt === -1) return [];

  const excludeAt = source.indexOf('exclude:', coverageAt);
  if (excludeAt === -1) return [];

  const open = source.indexOf('[', excludeAt);
  const close = source.indexOf(']', open);
  return open === -1 || close === -1 ? [] : literalsBetween(source, open, close);
}

function globToRegExp(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      pattern += '(?:.*/)?';
      i += 2;
    } else if (char === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i += 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`);
}

const matchesAnyGlob = (filePath, globs) => globs.some((glob) => globToRegExp(glob).test(filePath));

const isTestFile = (filePath) =>
  TEST_FILE.test(filePath) || TEST_DIRECTORIES.some((directory) => filePath.startsWith(`${directory}/`));

/** Sorts staged entries into the four buckets the gate reasons about. */
export function classifyStagedFiles(stagedFiles, coverageExclusions = []) {
  const exemptGlobs = [...ALWAYS_EXEMPT, ...coverageExclusions];
  const buckets = { production: [], tests: [], exempt: [], other: [] };

  for (const file of stagedFiles) {
    if (file.status === 'D') continue;
    if (isTestFile(file.path)) buckets.tests.push(file);
    else if (matchesAnyGlob(file.path, exemptGlobs)) buckets.exempt.push(file);
    else if (file.path.startsWith('src/') && SOURCE_FILE.test(file.path)) buckets.production.push(file);
    else buckets.other.push(file);
  }

  return buckets;
}

const moduleName = (filePath) => path.basename(filePath).replace(SOURCE_FILE, '');

const namedBy = (name, tests) => {
  const mention = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return tests.some((test) => mention.test(test.content));
};

/**
 * Pairs staged production code with the tests that exercise it.
 *
 * A new module must arrive with a test in the same commit — that is the outer
 * loop of the cycle. A changed module may lean on a test that already names it,
 * which keeps pure refactors committable; that case is a warning so the author
 * still sees that no test moved.
 */
export function auditPairing({ production, stagedTests, existingTests }) {
  return production.flatMap((file) => {
    const name = moduleName(file.path);
    if (namedBy(name, stagedTests)) return [];

    if (file.status === 'A') {
      return [
        {
          path: file.path,
          severity: 'error',
          message: `new module with no staged test naming "${name}" — write the failing test first (agents.md §1)`,
        },
      ];
    }

    if (namedBy(name, existingTests)) {
      return [
        {
          path: file.path,
          severity: 'warning',
          message: 'changed with no test change staged — fine for a pure refactor, otherwise add the test that would have caught this',
        },
      ];
    }

    return [
      {
        path: file.path,
        severity: 'error',
        message: `changed but no test anywhere names "${name}" — add one before changing behaviour`,
      },
    ];
  });
}

/**
 * Focused specs silently shrink the suite, so they never reach a commit.
 *
 * Matched at the head of a line: a real focused spec opens one, while a
 * `.only` quoted inside an expression is a fixture describing the thing, not
 * the thing itself.
 */
export function findFocusedTests(stagedTests) {
  return stagedTests.flatMap((test) =>
    test.content.split(/\r?\n/).flatMap((text, index) => {
      const focused = text.match(/^\s*(describe|it|test)\.only\b/);
      return focused ? [{ path: test.path, line: index + 1, marker: `${focused[1]}.only` }] : [];
    }),
  );
}

function parseThresholds(configSource) {
  const source = stripComments(configSource);
  const at = source.indexOf('thresholds:');
  if (at === -1) return {};

  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  if (open === -1 || close === -1) return {};

  const body = source.slice(open, close);
  return Object.fromEntries(
    COVERAGE_METRICS.flatMap((metric) => {
      const found = body.match(new RegExp(`\\b${metric}\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
      return found ? [[metric, Number(found[1])]] : [];
    }),
  );
}

/**
 * Coverage thresholds ratchet up. A drop or a deletion is a blocked commit.
 *
 * With one exception, and it is the only way a smaller number can be a better
 * gate: taking a file out of `coverage.exclude` puts code nothing was measuring
 * into the denominator, so the ratio falls while the amount of tested code
 * rises. Blocking that would have the guard arguing for leaving the 3D scene
 * untested, which is the opposite of what it is for (#343). A threshold that
 * falls without the population growing is blocked exactly as before.
 */
export function findLoweredThresholds({ before, after }) {
  const was = parseThresholds(before);
  const now = parseThresholds(after);
  const measuringMore =
    parseCoverageExclusions(after).length < parseCoverageExclusions(before).length;

  return Object.entries(was).flatMap(([metric, from]) => {
    const to = now[metric];
    if (to === undefined) return [{ metric, from, to: null }];
    if (to >= from || measuringMore) return [];
    return [{ metric, from, to }];
  });
}

/* ---------------------------------------------------------------- CLI ---- */

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

const stagedEntries = () =>
  git('diff', '--cached', '--name-status', '--diff-filter=ACMR')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');
      return { status: fields[0][0], path: fields[fields.length - 1] };
    });

/** Index content, not working-tree content: the commit is what is being judged. */
const stagedContent = (filePath) => {
  try {
    return git('show', `:${filePath}`);
  } catch {
    return '';
  }
};

const headContent = (filePath) => {
  try {
    return git('show', `HEAD:${filePath}`);
  } catch {
    return '';
  }
};

function collectTestFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return TEST_FILE.test(entry.name)
      ? [{ path: entryPath, content: readFileSync(entryPath, 'utf8') }]
      : [];
  });
}

function reportFindings(findings) {
  for (const finding of findings) {
    const label = finding.severity === 'error' ? 'BLOCKED' : 'warning';
    console.log(`  ${label}  ${finding.path}`);
    console.log(`           ${finding.message}`);
  }
}

function main() {
  if (process.env.TDD_GUARD === 'off') {
    console.log('tdd-guard: skipped (TDD_GUARD=off)');
    return 0;
  }

  const staged = stagedEntries();
  if (staged.length === 0) return 0;

  const exclusions = parseCoverageExclusions(
    existsSync('vitest.config.ts') ? readFileSync('vitest.config.ts', 'utf8') : '',
  );
  const { production, tests } = classifyStagedFiles(staged, exclusions);

  const stagedTests = tests.map((file) => ({ path: file.path, content: stagedContent(file.path) }));
  const stagedTestPaths = new Set(stagedTests.map((test) => test.path));
  const existingTests = TEST_DIRECTORIES.flatMap(collectTestFiles).filter(
    (test) => !stagedTestPaths.has(test.path),
  );

  const findings = [
    ...auditPairing({ production, stagedTests, existingTests }),
    ...findFocusedTests(stagedTests).map((focused) => ({
      path: `${focused.path}:${focused.line}`,
      severity: 'error',
      message: `${focused.marker} would commit a focused suite — remove it`,
    })),
  ];

  if (staged.some((file) => file.path === 'vitest.config.ts')) {
    findings.push(
      ...findLoweredThresholds({
        before: headContent('vitest.config.ts'),
        after: stagedContent('vitest.config.ts'),
      }).map(({ metric, from, to }) => ({
        path: 'vitest.config.ts',
        severity: 'error',
        message: `coverage threshold "${metric}" ${to === null ? 'removed' : `lowered ${from} → ${to}`} — thresholds ratchet up only`,
      })),
    );
  }

  reportFindings(findings);

  const blocking = findings.filter((finding) => finding.severity === 'error');
  if (blocking.length > 0) {
    console.log(
      `\ntdd-guard: ${blocking.length} blocking finding(s). Write the test first; commit with TDD_GUARD=off only when the change genuinely carries no behaviour.`,
    );
    return 1;
  }

  console.log(
    `tdd-guard: ok — ${production.length} production file(s), ${tests.length} test file(s) staged`,
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('tdd-guard.mjs')) {
  process.exit(main());
}
