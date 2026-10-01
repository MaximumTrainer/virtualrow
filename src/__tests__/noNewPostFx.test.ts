import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * #455 AC9 / NFR1 — the five-tier migration slides values on existing axes
 * and introduces no new render pass.
 *
 * This guardrail freezes the set of postprocessing effect names imported
 * anywhere under `src/`. A new effect added later means someone widened the
 * stack beyond #455's scope; the test fails and forces the next PR to either
 * declare the new effect here or roll back. The purpose is not to ban every
 * future effect — it is to make a new one visible in review.
 *
 * The allow-list below matches the effect stack at the Phase 5 landing time:
 * `effectComponents.tsx`'s `@react-three/postprocessing` imports and the
 * `postprocessing` types it also pulls in.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

const ALLOWED_R3F_POSTPROCESSING = new Set([
  'EffectComposer',
  'Bloom',
  'ToneMapping',
  'Vignette',
  'DepthOfField',
  'SSAO',
  'GodRays',
  'HueSaturation',
  'BrightnessContrast',
]);

const ALLOWED_POSTPROCESSING = new Set([
  'ToneMappingMode',
  'ChromaticAberrationEffect',
  'DepthOfFieldEffect',
]);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
};

const importedNames = (contents: string, module: string): Set<string> => {
  const names = new Set<string>();
  const pattern = new RegExp(
    String.raw`import\s*\{([^}]+)\}\s*from\s*['"]${module.replace(
      /[/]/g,
      '\\/',
    )}['"]`,
    'g',
  );
  for (const match of contents.matchAll(pattern)) {
    for (const chunk of match[1].split(',')) {
      const name = chunk
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.add(name);
    }
  }
  return names;
};

describe('#455 AC9: the effect stack does not grow', () => {
  const files = walk(srcRoot);

  it('imports only the known effect names from @react-three/postprocessing', () => {
    const seen = new Set<string>();
    for (const file of files) {
      for (const name of importedNames(readFileSync(file, 'utf8'), '@react-three/postprocessing')) {
        seen.add(name);
      }
    }
    for (const name of seen) {
      expect(
        ALLOWED_R3F_POSTPROCESSING.has(name),
        `src/ imports "${name}" from @react-three/postprocessing — add it to the ` +
          'ALLOWED_R3F_POSTPROCESSING allow-list in src/__tests__/noNewPostFx.test.ts ' +
          'with a note on why (and update #455 NFR1 if the stack is widening).',
      ).toBe(true);
    }
  });

  it('imports only the known effect names from postprocessing', () => {
    const seen = new Set<string>();
    for (const file of files) {
      for (const name of importedNames(readFileSync(file, 'utf8'), 'postprocessing')) {
        seen.add(name);
      }
    }
    for (const name of seen) {
      expect(
        ALLOWED_POSTPROCESSING.has(name),
        `src/ imports "${name}" from postprocessing — add it to ALLOWED_POSTPROCESSING ` +
          'in src/__tests__/noNewPostFx.test.ts with a note on why.',
      ).toBe(true);
    }
  });
});
