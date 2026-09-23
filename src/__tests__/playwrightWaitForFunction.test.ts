import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

/**
 * `page.waitForFunction(fn, arg, options)` takes its options third.
 *
 * Twenty-four calls in the E2E suite passed `{ timeout }` second, where
 * Playwright hands it to the page function as its argument and waits the
 * config's default 10 s instead. The one at virtualrow.spec.ts's heart-rate
 * wait asked for 15 s and failed on windows at 10 s - "Timeout 10000ms
 * exceeded" - on a runner drawing about a frame a second (#390, #397).
 *
 * The type checker cannot see this: the argument slot accepts anything.
 */

const OPTION_KEYS = new Set(['timeout', 'polling']);

const specFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });

/** Every `waitForFunction(fn, { timeout | polling })` - options in the argument slot. */
const misplacedOptions = (file: string): string[] => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'waitForFunction' &&
      node.arguments.length === 2
    ) {
      const second = node.arguments[1];
      const looksLikeOptions =
        ts.isObjectLiteralExpression(second) &&
        second.properties.some(
          (p) => p.name !== undefined && ts.isIdentifier(p.name) && OPTION_KEYS.has(p.name.text),
        );
      if (looksLikeOptions) {
        const { line } = source.getLineAndCharacterOfPosition(second.getStart());
        found.push(`${file}:${line + 1} ${second.getText()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

describe('waitForFunction in the E2E suite', () => {
  it('passes its options third, where Playwright reads them', () => {
    const offenders = specFiles('playwright').flatMap(misplacedOptions);
    expect(offenders, 'use waitForFunction(fn, undefined, { timeout })').toEqual([]);
  });

  it('would catch the mistake it guards against', () => {
    const probe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wff-')), 'probe.ts');
    fs.writeFileSync(probe, 'await page.waitForFunction(() => true, { timeout: 15_000 });\n');
    expect(misplacedOptions(probe)).toHaveLength(1);
    fs.writeFileSync(probe, 'await page.waitForFunction(() => true, undefined, { timeout: 15_000 });\n');
    expect(misplacedOptions(probe)).toHaveLength(0);
    fs.rmSync(path.dirname(probe), { recursive: true });
  });
});
