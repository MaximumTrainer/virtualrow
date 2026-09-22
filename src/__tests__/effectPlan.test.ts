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

/**
 * Issue #327 — the frame is tone-mapped once.
 *
 * The renderer is built with `ACESFilmicToneMapping` and the composer ends on a
 * `ToneMapping` pass set to ACES as well, so wherever a composer was mounted
 * the frame was graded twice. That crushes the mid-tones, and it is part of why
 * `sceneExposure` had to be dragged down to 0.55 to stop the sky blowing out
 * (#269) - the exposure was compensating for a second grade nobody had noticed.
 *
 * Which of the two runs is now a property of the plan, so it is decided in one
 * place and can be asserted without a GPU.
 */
describe('exactly one tone-mapping stage', () => {
  it('leaves it on the renderer when there is no composer', () => {
    const plan = effectPlanFor('low', { hasSun: false });

    expect(plan.composer, 'the low tier grew a composer').toBe(false);
    expect(plan.toneMapOnRenderer, 'nothing would tone-map the frame at all').toBe(true);
  });

  it.each(['auto', 'high'] as const)('hands it to the composer at %s', (mode) => {
    const plan = effectPlanFor(mode, { hasSun: true });

    expect(plan.composer).toBe(true);
    expect(plan.effects, 'the composer has no tone-mapping pass to hand it to').toContain(
      'toneMapping',
    );
    expect(plan.toneMapOnRenderer, 'the frame is tone-mapped twice').toBe(false);
  });

  it('never tone-maps in both places, whatever the tier', () => {
    for (const mode of ['low', 'auto', 'high'] as const) {
      const plan = effectPlanFor(mode, { hasSun: true });
      const inComposer = plan.composer && plan.effects.includes('toneMapping');

      expect(
        Number(plan.toneMapOnRenderer) + Number(inComposer),
        `${mode} tone-maps ${Number(plan.toneMapOnRenderer) + Number(inComposer)} times`,
      ).toBe(1);
    }
  });
});

/**
 * Issue #327 — depth of field blurred the whole world.
 *
 * `worldFocusDistance 10` with `worldFocusRange 25`, from a camera six metres
 * behind the boat, put everything past about thirty-five metres into bokeh.
 * Since #321 made a unit a metre that is the entire far bank, permanently.
 */
describe('depth of field', () => {
  it('is not in the auto stack at all', () => {
    expect(effectPlanFor('auto', { hasSun: true }).effects).not.toContain('depthOfField');
  });

  it('is kept for high, where it is focused on the boat each frame', () => {
    expect(effectPlanFor('high', { hasSun: true }).effects).toContain('depthOfField');
  });

  it('keeps the tiers in cost order with it gone from auto', () => {
    const low = effectCost(effectPlanFor('low', { hasSun: true }));
    const auto = effectCost(effectPlanFor('auto', { hasSun: true }));
    const high = effectCost(effectPlanFor('high', { hasSun: true }));

    expect(low).toBeLessThan(auto);
    expect(auto).toBeLessThan(high);
  });
});
