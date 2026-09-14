/** Types for the pre-commit TDD guard, consumed by src/__tests__/tddGuard.test.ts. */

export type StagedFile = { status: string; path: string };
export type TestFile = { path: string; content: string };
export type Finding = { path: string; severity: 'error' | 'warning'; message: string };
export type FocusedTest = { path: string; line: number; marker: string };
export type LoweredThreshold = { metric: string; from: number; to: number | null };

export function parseCoverageExclusions(configSource: string): string[];

export function classifyStagedFiles(
  stagedFiles: StagedFile[],
  coverageExclusions?: string[],
): { production: StagedFile[]; tests: StagedFile[]; exempt: StagedFile[]; other: StagedFile[] };

export function auditPairing(input: {
  production: StagedFile[];
  stagedTests: TestFile[];
  existingTests: TestFile[];
}): Finding[];

export function findFocusedTests(stagedTests: TestFile[]): FocusedTest[];

export function findLoweredThresholds(input: { before: string; after: string }): LoweredThreshold[];
