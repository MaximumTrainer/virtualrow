/**
 * #584 AC5.4 — scene quality follows the tier on the WebGPU engine.
 *
 * Ported from the retired `scene-quality-match.spec.ts`, which checked that the
 * React canvas surface (antialias / powerPreference / DPR) matched the scene.
 * The WebGPU engine owns none of that — the UI shell owns the canvas — so the
 * ported contract is the engine's half: a tier change actually changes what the
 * engine *builds* (shadow cascades climb, draw count never drops), not the
 * adapter.
 *
 * The unit half (ac4PortedBehaviors.test.ts "(D) scene quality") asserts the
 * same against the mock device; this is the real-`/row` e2e half. It mounts the
 * ride at `basic` and `extra-high` in two separate contexts and compares. On a
 * runner without a hardware adapter both decline, and the spec asserts the
 * well-formed decline for each (#542 NFR5).
 */
import { expect, test, type Browser } from '../fixtures/crash-watch';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  assertWellFormedDecline,
  forceRender,
  installRideHarness,
  pinTier,
  readRenderStats,
  readShadows,
  startDemoRide,
  waitForRideOutcome,
} from './helpers/engineRide';

test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

interface TierSample {
  outcome: 'ready' | 'fallback';
  draws: number;
  cascades: number;
}

async function sampleTier(
  browser: Browser,
  tier: 'basic' | 'extra-high',
): Promise<{ sample: TierSample; assertDecline: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await pinTier(page, tier);
  await installRideHarness(page);
  await startDemoRide(page);
  const outcome = await waitForRideOutcome(page);

  if (outcome === 'ready') await forceRender(page);
  const stats = await readRenderStats(page);
  const shadows = await readShadows(page);
  const sample: TierSample = {
    outcome,
    draws: stats?.draws ?? 0,
    cascades: shadows?.cascades ?? 0,
  };
  return {
    sample,
    assertDecline: async () => {
      await assertWellFormedDecline(page);
      await context.close();
    },
  };
}

test('higher tier builds a richer scene than basic (#584 AC5.4)', async ({ browser }) => {
  const basic = await sampleTier(browser, 'basic');
  const top = await sampleTier(browser, 'extra-high');

  // No hardware adapter on either: both declined cleanly, nothing to compare.
  if (basic.sample.outcome === 'fallback' || top.sample.outcome === 'fallback') {
    await basic.assertDecline();
    await top.assertDecline();
    return;
  }

  // Both attached on a real adapter: the tier changed what the engine built.
  // Shadow cascades are a config-driven, route-independent signal that must
  // strictly climb; draw count must never drop (extra-high adds SSAO/DOF,
  // clouds, building + crew shadows on top of basic's flat lit scene).
  expect(top.sample.cascades, 'extra-high has more shadow cascades than basic').toBeGreaterThan(
    basic.sample.cascades,
  );
  expect(top.sample.draws, 'extra-high never draws fewer passes than basic').toBeGreaterThanOrEqual(
    basic.sample.draws,
  );
});
