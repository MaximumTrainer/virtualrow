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

// #592: `WgslReflect` only parses syntax, so it accepted an unresolvable
// `textureSampleLevel(texture_depth_2d, sampler, vec2<f32>, 0.0)` call —
// `texture_depth_2d`'s overload requires an i32 level, and the browser
// rejects the module at pipeline creation, blacking out extra-high. Guard
// against the class of bug: any pass that binds a depth texture must call
// `textureSampleLevel` with an integer level (ends with `i`/`u` or is a
// non-literal expression), never an abstract-float literal.
describe('textureSampleLevel on depth textures uses an integer level (#592)', () => {
  const depthTextureFiles = shaderFiles.filter((f) =>
    /\btexture_depth_(2d|cube|2d_array|cube_array)\b/.test(readFileSync(join(passesDir, f), 'utf8')),
  );
  it('finds at least one depth-sampling pass', () => {
    expect(depthTextureFiles.length).toBeGreaterThan(0);
  });
  for (const file of depthTextureFiles) {
    it(`${file} passes an integer level to textureSampleLevel`, () => {
      const src = readFileSync(join(passesDir, file), 'utf8');
      const calls = [...src.matchAll(/textureSampleLevel\s*\(([^)]*)\)/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const m of calls) {
        const parts = m[1].split(',').map((s) => s.trim());
        // level is the last positional arg; depth overloads take 4 args
        // (tex, sampler, coords, level) — array/cube variants take more,
        // but the level is still last.
        const level = parts[parts.length - 1];
        // Reject bare float literals like `0.0`, `1.5`, `-2.0`. Integer
        // literals (`0`, `0i`, `0u`) and non-literal expressions pass.
        const isFloatLiteral = /^-?\d+\.\d+f?$/.test(level) || /^-?\.\d+f?$/.test(level);
        expect(isFloatLiteral, `${file}: textureSampleLevel level "${level}" must be an integer for depth textures`).toBe(false);
      }
    });
  }
});
