import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  QUALITY_TIERS,
  canvasSurfaceFor,
  drawsCaustics,
  drawsGroundCover,
  drawsPostStack,
  drawsScenery,
  drawsShadows,
  drawsSunMesh,
  drawsWaterReflection,
  maxDpr,
  type CanvasSurface,
} from '../components/rower3d/canvasSurface';
import { budgetFor } from '../components/rower3d/sceneryPlacement';
import type { PerformanceMode } from '../components/rower3d/constants';

/**
 * The whole point of this file: every quality tier is checked against every
 * surface setting, so a combination that cannot work — multisampling on the
 * tier that exists because the GPU is weak, a discrete-adapter request from a
 * scene that has already given up shadows — fails here rather than on a
 * rower's laptop.
 */

const ORDER: PerformanceMode[] = ['basic', 'low', 'medium', 'high', 'extra-high'];

/** Ranks a surface setting so "never richer than the tier above" is checkable. */
const rank = (surface: CanvasSurface) => ({
  antialias: surface.antialias ? 1 : 0,
  shadows: surface.shadows ? 1 : 0,
  shadowMapSize: surface.shadowMapSize,
  dpr: maxDpr(surface.dpr),
  adapter: { 'low-power': 0, default: 1, 'high-performance': 2 }[surface.powerPreference],
});

describe('QUALITY_TIERS', () => {
  it('names every tier the scene can run at, in order', () => {
    expect(QUALITY_TIERS).toEqual(ORDER);
  });

  it('has a surface for each, so no tier falls through to a default', () => {
    for (const tier of QUALITY_TIERS) {
      expect(canvasSurfaceFor(tier)).toBeDefined();
    }
  });
});

describe('the low tier asks for nothing it cannot afford', () => {
  const low = canvasSurfaceFor('basic');

  it.each([
    ['multisampling', () => low.antialias, false],
    ['shadow maps', () => low.shadows, false],
  ])('does not request %s', (_label, read, expected) => {
    expect(read()).toBe(expected);
  });

  it('does not ask for the discrete adapter', () => {
    // This is the combination that cost a rower their scene: a low-quality
    // scene on a surface built for a GPU the browser was not even using.
    expect(low.powerPreference).not.toBe('high-performance');
  });

  it('renders one device pixel per CSS pixel', () => {
    expect(maxDpr(low.dpr)).toBe(1);
  });
});

describe('the high tier gets what it pays for', () => {
  const high = canvasSurfaceFor('extra-high');

  it('takes multisampling, shadows and the discrete adapter', () => {
    expect(high.antialias).toBe(true);
    expect(high.shadows).toBe(true);
    expect(high.powerPreference).toBe('high-performance');
  });

  it('allows a retina drawing buffer', () => {
    expect(maxDpr(high.dpr)).toBeGreaterThan(1);
  });
});

describe('the middle tier sits between the two, not alongside high', () => {
  const low = canvasSurfaceFor('basic');
  const medium = canvasSurfaceFor('medium');
  const high = canvasSurfaceFor('extra-high');

  it('keeps shadows but not the largest shadow map', () => {
    expect(medium.shadows).toBe(true);
    expect(medium.shadowMapSize).toBeLessThan(high.shadowMapSize);
    expect(medium.shadowMapSize).toBeGreaterThan(low.shadowMapSize);
  });

  it('does not claim the discrete adapter', () => {
    // `auto` means "decide for me". Demanding the discrete GPU is a decision,
    // and on a hybrid laptop it is the one that refuses to open a context.
    expect(medium.powerPreference).toBe('default');
  });

  it('caps the drawing buffer below the high tier', () => {
    expect(maxDpr(medium.dpr)).toBeGreaterThanOrEqual(maxDpr(low.dpr));
    expect(maxDpr(medium.dpr)).toBeLessThan(maxDpr(high.dpr));
  });
});

describe('no setting ever goes backwards as quality rises', () => {
  const ranked = ORDER.map((tier) => ({ tier, ...rank(canvasSurfaceFor(tier)) }));

  it.each(['antialias', 'shadows', 'shadowMapSize', 'dpr', 'adapter'] as const)(
    '%s is monotonic across low → auto → high',
    (setting) => {
      const values = ranked.map((r) => r[setting]);

      expect(values).toEqual([...values].sort((a, b) => a - b));
    },
  );

  it('scenery density rises with the tier too', () => {
    const budgets = ORDER.map(budgetFor);

    expect(budgets).toEqual([...budgets].sort((a, b) => a - b));
    expect(new Set(budgets).size).toBe(ORDER.length);
  });
});


/**
 * Issue #352 — shadows with a soft edge.
 *
 * three's default shadow map is `PCFShadowMap`, which is a hard edge at the
 * resolutions this scene can afford: a scull's shadow on open water reads as a
 * cut-out. `PCFSoftShadowMap` costs a wider tap pattern and nothing else, so
 * every tier that draws shadows at all draws them soft.
 */
describe('how hard the shadow edges are', () => {
  it('asks for soft shadows wherever shadows are drawn', () => {
    for (const tier of ['medium', 'extra-high'] as const) {
      const surface = canvasSurfaceFor(tier);

      expect(surface.shadows, tier).toBe(true);
      expect(surface.softShadows, tier).toBe(true);
    }
  });

  // Nothing to soften: the low tier draws no shadow map at all.
  it('asks for nothing on a tier that draws no shadows', () => {
    const surface = canvasSurfaceFor('basic');

    expect(surface.shadows).toBe(false);
    expect(surface.softShadows).toBe(false);
  });
});

/**
 * #455 FR4 / AC3 — Rower3D.tsx's tier gates read named predicates.
 *
 * Inline string equalities against tier names leave each gate independently
 * authored, so a new tier (or a renamed one) has to be chased through every
 * site. The predicates in canvasSurface.ts carry the boundary; a change there
 * changes every gate it names. The grep below is the contract: no literal
 * tier comparison SHALL survive in Rower3D.tsx.
 */
describe('tier gates in Rower3D.tsx', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const rowerSrc = readFileSync(
    resolve(here, '../components/Rower3D.tsx'),
    'utf8',
  );

  it.each([
    "performanceMode === 'basic'",
    "performanceMode !== 'basic'",
    "performanceMode === 'low'",
    "performanceMode !== 'low'",
    "performanceMode === 'medium'",
    "performanceMode !== 'medium'",
    "performanceMode === 'high'",
    "performanceMode !== 'high'",
    "performanceMode === 'extra-high'",
    "performanceMode !== 'extra-high'",
  ])('does not spell "%s" inline', (fragment) => {
    expect(rowerSrc).not.toContain(fragment);
  });
});

describe('named predicates for the Rower3D gates', () => {
  it('turns scenery/post/water/caustics/ground-cover on from `low` upwards', () => {
    for (const predicate of [
      drawsScenery,
      drawsPostStack,
      drawsWaterReflection,
      drawsCaustics,
      drawsGroundCover,
    ]) {
      expect(predicate('basic'), predicate.name).toBe(false);
      for (const tier of ['low', 'medium', 'high', 'extra-high'] as const) {
        expect(predicate(tier), `${predicate.name}(${tier})`).toBe(true);
      }
    }
  });

  it('turns shadows on wherever the surface asks for them', () => {
    for (const tier of QUALITY_TIERS) {
      expect(drawsShadows(tier), tier).toBe(canvasSurfaceFor(tier).shadows);
    }
  });

  it('turns the godRays sun sphere on only at extra-high', () => {
    for (const tier of ['basic', 'low', 'medium', 'high'] as const) {
      expect(drawsSunMesh(tier), tier).toBe(false);
    }
    expect(drawsSunMesh('extra-high')).toBe(true);
  });
});
