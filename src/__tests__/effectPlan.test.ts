import { describe, it, expect } from 'vitest';
import { effectPlanFor, effectCost, EFFECT_NAMES } from '../components/rower3d/effectPlan';
import { QUALITY_TIERS } from '../components/rower3d/canvasSurface';
import type { PerformanceMode } from '../components/rower3d/constants';

const ORDER: PerformanceMode[] = ['low', 'auto', 'high'];
const withSun = { hasSun: true };

describe('the low tier runs no effects at all', () => {
  it('has an empty plan, whether or not a sun is available', () => {
    expect(effectPlanFor('low', withSun).effects).toEqual([]);
    expect(effectPlanFor('low', { hasSun: false }).effects).toEqual([]);
  });

  it('needs no composer, so none is mounted', () => {
    expect(effectPlanFor('low', withSun).composer).toBe(false);
  });
});

describe('the middle tier is genuinely lighter than the top', () => {
  const auto = effectPlanFor('auto', withSun);

  it('does not run ambient occlusion', () => {
    // SSAO is the expensive one: a full-resolution pass that also forces the
    // composer's normal pass. On integrated hardware it is what turned a
    // working scene into a GPU reset a second later (#232).
    expect(auto.effects).not.toContain('ssao');
  });

  it('does not force a normal pass', () => {
    expect(auto.normalPass).toBe(false);
  });

  it('runs neither depth of field nor god rays', () => {
    expect(auto.effects).not.toContain('depthOfField');
    expect(auto.effects).not.toContain('godRays');
  });

  it('still colours and tones the scene', () => {
    expect(auto.effects).toEqual(
      expect.arrayContaining(['bloom', 'hueSaturation', 'brightnessContrast', 'vignette', 'toneMapping']),
    );
  });
});

describe('the high tier keeps everything it had', () => {
  const high = effectPlanFor('high', withSun);

  it('runs ambient occlusion with the normal pass it needs', () => {
    expect(high.effects).toContain('ssao');
    expect(high.normalPass).toBe(true);
  });

  it('runs god rays only when there is a sun to cast them', () => {
    expect(high.effects).toContain('godRays');
    expect(effectPlanFor('high', { hasSun: false }).effects).not.toContain('godRays');
  });
});

describe('no tier runs an effect the tier above it skips', () => {
  const plans = ORDER.map((tier) => effectPlanFor(tier, withSun));

  it.each(EFFECT_NAMES)('%s is only ever added as quality rises', (effect) => {
    const present = plans.map((plan) => (plan.effects.includes(effect) ? 1 : 0));

    expect(present).toEqual([...present].sort((a, b) => a - b));
  });

  it('gets strictly more expensive with each tier', () => {
    const costs = plans.map(effectCost);

    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(ORDER.length);
  });

  it('never enables the normal pass without the effect that needs it', () => {
    for (const plan of plans) {
      if (plan.normalPass) expect(plan.effects).toContain('ssao');
    }
  });
});

describe('every tier has a plan of its own', () => {
  it('covers each quality tier, so none falls through to another tier’s stack', () => {
    // The old code chose by if/else and ended on an unguarded `return` holding
    // the second-heaviest stack — reachable by any mode that was not 'auto'
    // and had no sun.
    for (const tier of QUALITY_TIERS) {
      expect(() => effectPlanFor(tier, withSun)).not.toThrow();
    }
  });

  it('treats an unknown mode as the lightest, not the heaviest', () => {
    const unknown = effectPlanFor('nonsense' as PerformanceMode, withSun);

    expect(effectCost(unknown)).toBeLessThanOrEqual(effectCost(effectPlanFor('auto', withSun)));
  });
});
