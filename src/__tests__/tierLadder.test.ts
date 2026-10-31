/**
 * #455 Phase 1 — lock the five-tier ladder (`basic` / `low` / `medium` /
 * `high` / `extra-high`) against regression. The engine's per-tier gates
 * (`shadowConfigFor`, `tierCapsFor`, `RENDER_BUDGET`) are already covered by
 * their own tests; this file locks the invariants that cut across them:
 *
 * - **AC3** — no inline tier-string comparison escapes the central helpers.
 * - **AC10** — `RENDER_BUDGET` is monotone non-decreasing on `triangles` and
 *   `p95Ms` across the five tiers.
 * - **AC11** — the `__VIRTUALROW_PERFORMANCE_MODE` test seam resolves the five
 *   tier names unchanged, and the legacy `'auto'` falls back to the
 *   `DEFAULT_TIER` (`medium`) per the migration policy.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { RENDER_BUDGET } from '../lib/renderer/renderBudget';
import { KNOWN_TIERS, DEFAULT_TIER } from '../lib/renderer/engine/shadowConfig';
import {
  normalizePerformanceModeOverride,
  type PerformanceMode,
} from '../components/rower3d/constants';

const TIER_ORDER: readonly PerformanceMode[] = ['basic', 'low', 'medium', 'high', 'extra-high'];

describe('#455 AC10 — RENDER_BUDGET monotonically widens across the tier ladder', () => {
  it('non-decreases on triangles across basic → low → medium → high → extra-high', () => {
    const triangles = TIER_ORDER.map((tier) => RENDER_BUDGET[tier].triangles);
    for (let i = 1; i < triangles.length; i++) {
      expect(triangles[i]).toBeGreaterThanOrEqual(triangles[i - 1]);
    }
  });

  it('non-decreases on p95Ms across basic → low → medium → high → extra-high', () => {
    const p95 = TIER_ORDER.map((tier) => RENDER_BUDGET[tier].p95Ms);
    for (let i = 1; i < p95.length; i++) {
      expect(p95[i]).toBeGreaterThanOrEqual(p95[i - 1]);
    }
  });

  it('has a budget row for every KNOWN_TIERS entry', () => {
    for (const tier of KNOWN_TIERS) {
      expect(RENDER_BUDGET[tier]).toBeTruthy();
    }
  });

  it('sits DEFAULT_TIER in the middle of the ladder (medium)', () => {
    expect(DEFAULT_TIER).toBe('medium');
    expect(TIER_ORDER.indexOf(DEFAULT_TIER)).toBe(2);
  });
});

describe('#455 AC11 — the __VIRTUALROW_PERFORMANCE_MODE seam resolves consistently', () => {
  it('accepts each of the five tier names unchanged', () => {
    for (const tier of TIER_ORDER) {
      expect(normalizePerformanceModeOverride(tier)).toBe(tier);
    }
  });

  it("maps legacy 'auto' to the medium default (migration policy, NFR6)", () => {
    expect(normalizePerformanceModeOverride('auto')).toBe(DEFAULT_TIER);
  });

  it('rejects everything else as null, so the resolver falls through', () => {
    expect(normalizePerformanceModeOverride('nonsense')).toBeNull();
    expect(normalizePerformanceModeOverride(undefined)).toBeNull();
    expect(normalizePerformanceModeOverride(null)).toBeNull();
    expect(normalizePerformanceModeOverride(42)).toBeNull();
  });
});

/**
 * #455 AC3 — grep gate across `src/lib/renderer/` for the inline tier-string
 * comparisons the ladder is supposed to centralise through the per-tier
 * helpers. The *gate sites* (pass code, draw code) read `tierCapsFor` /
 * `shadowConfigFor` / `RENDER_BUDGET` / the small set of tier-predicate
 * modules that exist precisely to centralise one axis.
 *
 * The allowlist below is those tier-helper modules themselves: a tier switch
 * belongs there, not in a draw pass. Adding a new one of these should be a
 * conscious choice — the allowlist pushes back on the easier path of letting
 * `=== 'high'` leak into a new pass.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(here, '..', 'lib', 'renderer');

const TIER_HELPER_ALLOWLIST = new Set(
  [
    'lib/renderer/engine/shadowConfig.ts',
    'lib/renderer/engine/tierCaps.ts',
    'lib/renderer/engine/shaderGrass.ts',
    'lib/renderer/engine/textureLoader.ts',
    'lib/renderer/renderBudget.ts',
  ].map((rel) => resolve(here, '..', rel)),
);

const walkTs = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
};

describe('#455 AC3 — the renderer centralises tier gates', () => {
  it('has no inline tier-string comparison inside src/lib/renderer/ outside the tier-helper allowlist', () => {
    const pattern = /(===|!==)\s*['"](basic|low|medium|high|extra-high)['"]/;
    const offenders: string[] = [];
    for (const file of walkTs(rendererRoot)) {
      if (TIER_HELPER_ALLOWLIST.has(file)) continue;
      const contents = readFileSync(file, 'utf8');
      if (pattern.test(contents)) offenders.push(file);
    }
    expect(
      offenders,
      'a renderer file is comparing a tier string inline — read tierCapsFor / shadowConfigFor / RENDER_BUDGET instead, or if the predicate belongs there, add it to a tier-helper module and widen the allowlist (#455 AC3)',
    ).toEqual([]);
  });
});
