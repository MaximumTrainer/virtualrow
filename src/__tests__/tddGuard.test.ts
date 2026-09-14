import { describe, it, expect } from 'vitest';
import {
  parseCoverageExclusions,
  classifyStagedFiles,
  auditPairing,
  findFocusedTests,
  findLoweredThresholds,
} from '../../scripts/tdd-guard.mjs';

const vitestConfigSource = `
export default defineConfig({
  test: {
    exclude: ['playwright/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      exclude: [
        'scripts/**',
        'src/types/**',
        'src/components/rower3d/**',
        'src/main.tsx',
      ],
      thresholds: { lines: 87, statements: 87, branches: 82, functions: 83 },
    },
  },
});
`;

const exclusions = ['scripts/**', 'src/types/**', 'src/components/rower3d/**', 'src/main.tsx'];

describe('parseCoverageExclusions', () => {
  it('reads the coverage exclusion globs, not the test-run exclusions', () => {
    expect(parseCoverageExclusions(vitestConfigSource)).toEqual(exclusions);
  });

  it('returns an empty list when the config has no coverage block', () => {
    expect(parseCoverageExclusions('export default {}')).toEqual([]);
  });
});

describe('classifyStagedFiles', () => {
  it('splits staged paths into production code, tests, exempt files and everything else', () => {
    const staged = [
      { status: 'M', path: 'src/services/routeService.ts' },
      { status: 'A', path: 'src/__tests__/routeService.test.ts' },
      { status: 'A', path: 'playwright/tests/row.spec.ts' },
      { status: 'M', path: 'src/components/rower3d/waterComponents.tsx' },
      { status: 'M', path: 'src/types/route.ts' },
      { status: 'M', path: 'README.md' },
    ];

    const { production, tests, exempt, other } = classifyStagedFiles(staged, exclusions);

    expect(production.map((f) => f.path)).toEqual(['src/services/routeService.ts']);
    expect(tests.map((f) => f.path)).toEqual([
      'src/__tests__/routeService.test.ts',
      'playwright/tests/row.spec.ts',
    ]);
    expect(exempt.map((f) => f.path)).toEqual([
      'src/components/rower3d/waterComponents.tsx',
      'src/types/route.ts',
    ]);
    expect(other.map((f) => f.path)).toEqual(['README.md']);
  });

  it('ignores deleted files and type declarations', () => {
    const staged = [
      { status: 'D', path: 'src/services/oldService.ts' },
      { status: 'A', path: 'src/vendor/pm5-base.d.ts' },
    ];

    const { production, exempt } = classifyStagedFiles(staged, exclusions);

    expect(production).toEqual([]);
    expect(exempt.map((f) => f.path)).toEqual(['src/vendor/pm5-base.d.ts']);
  });
});

describe('auditPairing', () => {
  const routeServiceTest = {
    path: 'src/__tests__/routeService.test.ts',
    content: "import { routeService } from '../services/routeService';",
  };

  it('passes a new module that arrives with a test naming it', () => {
    const findings = auditPairing({
      production: [{ status: 'A', path: 'src/services/routeService.ts' }],
      stagedTests: [routeServiceTest],
      existingTests: [],
    });

    expect(findings).toEqual([]);
  });

  it('blocks a new module that arrives with no test at all', () => {
    const findings = auditPairing({
      production: [{ status: 'A', path: 'src/services/routeService.ts' }],
      stagedTests: [],
      existingTests: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'src/services/routeService.ts', severity: 'error' });
  });

  it('blocks a new module when the staged tests cover something else', () => {
    const findings = auditPairing({
      production: [{ status: 'A', path: 'src/services/routeService.ts' }],
      stagedTests: [{ path: 'src/__tests__/authService.test.ts', content: 'authService' }],
      existingTests: [],
    });

    expect(findings.map((f) => f.severity)).toEqual(['error']);
  });

  it('blocks a changed module that no test anywhere names', () => {
    const findings = auditPairing({
      production: [{ status: 'M', path: 'src/services/routeService.ts' }],
      stagedTests: [],
      existingTests: [{ path: 'src/__tests__/authService.test.ts', content: 'authService' }],
    });

    expect(findings.map((f) => f.severity)).toEqual(['error']);
  });

  it('warns — but does not block — a refactor of code an existing test covers', () => {
    const findings = auditPairing({
      production: [{ status: 'M', path: 'src/services/routeService.ts' }],
      stagedTests: [],
      existingTests: [routeServiceTest],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'src/services/routeService.ts', severity: 'warning' });
  });

  it('matches the module name on a word boundary, not a substring', () => {
    const findings = auditPairing({
      production: [{ status: 'M', path: 'src/services/routeService.ts' }],
      stagedTests: [],
      existingTests: [{ path: 'src/__tests__/x.test.ts', content: 'routeServiceHelper' }],
    });

    expect(findings.map((f) => f.severity)).toEqual(['error']);
  });
});

describe('findFocusedTests', () => {
  it('reports focused specs with their line numbers', () => {
    const staged = [
      {
        path: 'src/__tests__/routeService.test.ts',
        content: ["describe('routeService', () => {", "  it.only('imports GPX', () => {})", '})'].join('\n'),
      },
    ];

    expect(findFocusedTests(staged)).toEqual([
      { path: 'src/__tests__/routeService.test.ts', line: 2, marker: 'it.only' },
    ]);
  });

  it('reports describe.only and test.only too', () => {
    const staged = [
      { path: 'a.test.ts', content: 'describe.only(' },
      { path: 'b.test.ts', content: 'test.only(' },
    ];

    expect(findFocusedTests(staged).map((f) => f.marker)).toEqual(['describe.only', 'test.only']);
  });

  it('ignores a marker that is quoted inside another expression', () => {
    const staged = [{ path: 'a.test.ts', content: "const fixture = { content: 'it.only(' };" }];

    expect(findFocusedTests(staged)).toEqual([]);
  });

  it('leaves unfocused specs alone', () => {
    const staged = [{ path: 'a.test.ts', content: "it('rows', () => {})\ndescribe('x', () => {})" }];

    expect(findFocusedTests(staged)).toEqual([]);
  });
});

describe('findLoweredThresholds', () => {
  const configWith = (thresholds: string) => `coverage: { thresholds: ${thresholds} }`;

  it('reports a metric that was lowered', () => {
    const lowered = findLoweredThresholds({
      before: configWith('{ lines: 87, branches: 82 }'),
      after: configWith('{ lines: 80, branches: 82 }'),
    });

    expect(lowered).toEqual([{ metric: 'lines', from: 87, to: 80 }]);
  });

  it('reports a metric that was deleted', () => {
    const lowered = findLoweredThresholds({
      before: configWith('{ lines: 87, branches: 82 }'),
      after: configWith('{ lines: 87 }'),
    });

    expect(lowered).toEqual([{ metric: 'branches', from: 82, to: null }]);
  });

  it('stays quiet when thresholds hold or ratchet up', () => {
    expect(
      findLoweredThresholds({
        before: configWith('{ lines: 87, branches: 82 }'),
        after: configWith('{ lines: 90, branches: 82 }'),
      }),
    ).toEqual([]);
  });
});
