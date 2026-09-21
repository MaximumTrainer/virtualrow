import { describe, it, expect } from 'vitest';
import {
  QUALITY_TIERS,
  canvasSurfaceFor,
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

const ORDER: PerformanceMode[] = ['low', 'auto', 'high'];

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
  const low = canvasSurfaceFor('low');

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
  const high = canvasSurfaceFor('high');

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
  const [low, medium, high] = ORDER.map(canvasSurfaceFor);

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

