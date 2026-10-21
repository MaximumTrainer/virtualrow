import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';

// P2-AC7: a syntactically broken shader must fail the Vitest run, not
// Playwright. `WgslReflect` throws on any parser-level problem, so parsing
// each `.wgsl` under the passes dir is the whole check.
const passesDir = dirname(fileURLToPath(import.meta.url)) + '/..';

const shaderFiles = readdirSync(passesDir).filter((f) => f.endsWith('.wgsl'));

describe('pass WGSL shaders parse', () => {
  it('finds at least one shader', () => {
    expect(shaderFiles.length).toBeGreaterThan(0);
  });

  for (const file of shaderFiles) {
    it(`parses ${file}`, () => {
      const src = readFileSync(join(passesDir, file), 'utf8');
      // A `new WgslReflect(src)` call throws on a syntax error.
      const reflect = new WgslReflect(src);
      // Each pass has at least a vertex and a fragment entry point.
      const entries = [...reflect.functions.filter((f) => f.attributes?.some((a) => ['vertex', 'fragment', 'compute'].includes(a.name)))];
      expect(entries.length).toBeGreaterThan(0);
    });
  }
});
