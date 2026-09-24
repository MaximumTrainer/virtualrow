import { describe, it, expect } from 'vitest';
import { cloudsFor } from '../components/rower3d/cloudPlan';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';

/**
 * Issue #326 — what the sky costs, per tier.
 *
 * Every cloud is a drei `Cloud`, and each is rebuilt per instance from the
 * config's `segments` — up to forty sprites apiece. Eight of those is three
 * hundred and twenty transparent quads over the whole sky, sorted and blended
 * every frame, on hardware the low tier exists because it could not manage
 * shadows.
 *
 * The tier decides, not the authored. A theme says what the sky looks like where
 * there is room for it.
 */
const authored = SCENE_CONFIG.clouds;

describe('cloudsFor', () => {
  it('draws no clouds at all on the low tier', () => {
    expect(cloudsFor('low').count).toBe(0);
  });

  it('keeps auto to a handful', () => {
    expect(cloudsFor('auto').count).toBeLessThanOrEqual(6);
  });

  it('never asks for more than the config authored', () => {
    for (const mode of ['low', 'auto', 'high'] as const) {
      expect(cloudsFor(mode).count).toBeLessThanOrEqual(authored.count);
    }
  });

  // The segment count is the per-cloud cost, and it is the one that multiplies.
  it('spends the authored detail only where there is room for it', () => {
    expect(cloudsFor('high').segments).toBe(authored.segments);
    expect(cloudsFor('auto').segments).toBeLessThan(authored.segments);
  });

  it('gives back the rest of the config untouched', () => {
    const plan = cloudsFor('auto');

    expect(plan.color).toBe(authored.color);
    expect(plan.opacity).toBe(authored.opacity);
    expect(plan.speed).toBe(authored.speed);
  });
});

/**
 * Issue #346 — the tier caps whatever the conditions asked for.
 *
 * `cloudsFor` takes the config now, because an overcast sky is sixteen clouds
 * rather than eight. The tier ceiling still has the last word: overcast on a
 * machine that cannot draw eight clouds is not a reason to draw sixteen.
 */
describe('clouds under the conditions presets', () => {
  const overcast = {
    ...SCENE_CONFIG,
    clouds: { ...SCENE_CONFIG.clouds, count: 16, opacity: 0.9 },
  };

  it('reads the config it is handed, not the authored one', () => {
    expect(cloudsFor('high', overcast).opacity).toBe(0.9);
  });

  it('still caps the count at what the tier can draw', () => {
    expect(cloudsFor('high', overcast).count).toBeLessThanOrEqual(12);
    expect(cloudsFor('low', overcast).count).toBe(0);
  });

  it('falls back to the authored config when handed none', () => {
    expect(cloudsFor('high').opacity).toBe(SCENE_CONFIG.clouds.opacity);
  });
});
