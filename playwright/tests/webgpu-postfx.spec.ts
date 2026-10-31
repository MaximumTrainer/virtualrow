/**
 * #584 AC5.3 — post-fx per-tier mount on the WebGPU engine.
 *
 * Ported from the retired `rower3d-postfx.spec.ts`, which checked that the
 * post-processing composer didn't throw and that `drawCalls` advanced. Here
 * the engine mounts the real `/row` ride at each tier and we assert the pass
 * tree draws (drawCalls > 0) and, on a real adapter, the GPU frame timer is
 * live (`gpuMs > 0`, the #584 AC3 counter from the `timestamp-query` feature).
 *
 * The unit half (ac4PortedBehaviors.test.ts "(C) post-fx") asserts the pass
 * tree assembles at every tier and the SSAO/DOF caps gate correctly; this is
 * the real-`/row` e2e half. On a runner without a hardware adapter each tier
 * declines, and the spec asserts the well-formed decline (#542 NFR5).
 */
import { expect, test } from '../fixtures/crash-watch';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  assertWellFormedDecline,
  forceRender,
  installRideHarness,
  pinTier,
  readRenderStats,
  readRideTelemetry,
  startDemoRide,
  waitForRideOutcome,
} from './helpers/engineRide';

test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

// The tiers whose post-fx differs: basic (no SSAO/DOF), high (SSAO on), and
// extra-high (SSAO + DOF). One mount per tier.
const TIERS = ['basic', 'high', 'extra-high'] as const;

for (const tier of TIERS) {
  test(`post-fx draws at tier=${tier} (#584 AC5.3)`, async ({ page }) => {
    await pinTier(page, tier);
    await installRideHarness(page);
    await startDemoRide(page);

    if ((await waitForRideOutcome(page)) === 'fallback') {
      await assertWellFormedDecline(page);
      return;
    }

    // Draw at least one frame (the ride loop is not free-running under test).
    await forceRender(page);

    const stats = await readRenderStats(page);
    expect(stats, 'render stats are published').toBeTruthy();
    expect(stats?.drawCalls ?? 0, 'the pass tree issues draws').toBeGreaterThan(0);

    // #584 AC3 — on a real adapter with `timestamp-query`, the GPU frame timer
    // fills `gpuMs`. (Rides only reach this branch on a GPU runner; the
    // timer itself landed in #614.)
    const telemetry = await readRideTelemetry(page);
    expect(telemetry.frame?.gpuMs ?? 0, 'the GPU frame timer is live').toBeGreaterThan(0);
  });
}
