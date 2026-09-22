import { describe, it, expect } from 'vitest';
import { cloudsFor } from '../components/rower3d/cloudPlan';
import { getThemeConfig } from '../components/rower3d/themeConfig';

/**
 * Issue #326 — what the sky costs, per tier.
 *
 * Every cloud is a drei `Cloud`, and each is rebuilt per instance from the
 * theme's `segments` — up to forty sprites apiece. Eight of those is three
 * hundred and twenty transparent quads over the whole sky, sorted and blended
 * every frame, on hardware the low tier exists because it could not manage
 * shadows.
 *
 * The tier decides, not the theme. A theme says what the sky looks like where
 * there is room for it.
 */
const theme = getThemeConfig('willowbrook').clouds;

describe('cloudsFor', () => {
  it('draws no clouds at all on the low tier', () => {
    expect(cloudsFor('low', 'willowbrook').count).toBe(0);
  });

  it('keeps auto to a handful', () => {
    expect(cloudsFor('auto', 'willowbrook').count).toBeLessThanOrEqual(6);
  });

  it('never asks for more than the theme authored', () => {
    for (const mode of ['low', 'auto', 'high'] as const) {
      expect(cloudsFor(mode, 'willowbrook').count).toBeLessThanOrEqual(theme.count);
    }
  });

  // The segment count is the per-cloud cost, and it is the one that multiplies.
  it('spends the theme’s detail only where there is room for it', () => {
    expect(cloudsFor('high', 'willowbrook').segments).toBe(theme.segments);
    expect(cloudsFor('auto', 'willowbrook').segments).toBeLessThan(theme.segments);
  });

  it('gives back the rest of the theme untouched', () => {
    const plan = cloudsFor('auto', 'willowbrook');

    expect(plan.color).toBe(theme.color);
    expect(plan.opacity).toBe(theme.opacity);
    expect(plan.speed).toBe(theme.speed);
  });
});
