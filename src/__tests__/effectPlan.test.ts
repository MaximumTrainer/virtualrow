import { describe, it, expect } from 'vitest';
import { effectPlanFor, godRaysSun, effectCost, EFFECT_NAMES } from '../components/rower3d/effectPlan';
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

describe('godRaysSun — the light source the pass is given (#233)', () => {
  // GodRaysEffect.update dereferences this.lightSource.parent every frame, so
  // the pass must never be constructed without a live mesh.
  //
  // The old caller computed `performanceMode === 'high' ? sunMeshRef : undefined`
  // and the composer guarded on `!!sunMeshRef`. Both test the *ref object*,
  // which useRef makes truthy from the first render — the mesh is on `.current`,
  // and it is null until the mesh mounts, or forever in test mode where the mesh
  // is never rendered at all. So high mode threw a TypeError on every frame.
  const mesh = { isMesh: true } as unknown as import('three').Mesh;

  it('gives the pass a real mesh only in high mode', () => {
    expect(godRaysSun('high', mesh)).toBe(mesh);
  });

  it('gives nothing when the mesh has not mounted yet', () => {
    // The case the ref hid: high mode, but no light source in the scene.
    expect(godRaysSun('high', null)).toBeNull();
  });

  it('gives nothing below high mode, mesh or not', () => {
    expect(godRaysSun('auto', mesh)).toBeNull();
    expect(godRaysSun('low', mesh)).toBeNull();
  });

  it('keeps the plan and the light source in step', () => {
    // hasSun must be derived from the same answer the composer renders with,
    // or the plan can ask for a pass the composer has no sun for.
    const sun = godRaysSun('high', null);
    expect(effectPlanFor('high', { hasSun: !!sun }).effects).not.toContain('godRays');

    const live = godRaysSun('high', mesh);
    expect(effectPlanFor('high', { hasSun: !!live }).effects).toContain('godRays');
  });
});
