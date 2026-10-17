import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * #466 AC9 / NFR1 — the FIT encoder stays hand-written.
 *
 * `@garmin/fitsdk` is a devDependency: it decodes bytes in the round-trip
 * test as an independent reader (fitUploadRoundTrip.test.ts) so our writer
 * can't mask a bug with a matching reader bug. Shipping the SDK would blow
 * past NFR2's bundle budget and reduces the round-trip test to a tautology,
 * so this guardrail freezes "no src/ file imports it".
 *
 * Test files under src/__tests__/ may import it — they do not ship — so the
 * walk skips that directory.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');
const testsDir = resolve(here);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (full === testsDir) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
};

describe('#466 AC9: @garmin/fitsdk is a devDependency only', () => {
  it('is not imported from any shipped source file', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const contents = readFileSync(file, 'utf8');
      if (/from\s+['"]@garmin\/fitsdk['"]/.test(contents) || /import\s*\(\s*['"]@garmin\/fitsdk['"]/.test(contents)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
