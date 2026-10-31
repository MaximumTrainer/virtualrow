/**
 * #584 AC5.1 — context budget on the WebGPU engine.
 *
 * Ported from the retired `gl-context-budget.spec.ts`. The React/WebGL scene
 * opened as many as seven WebGL2 contexts for a single demo row (#261); the
 * hand-written WebGPU engine must open exactly one adapter + one device for the
 * life of a session and must never probe for a WebGL context as a fallback.
 *
 * The unit half of this (ac4PortedBehaviors.test.ts "(A) context budget")
 * asserts the same against the mock device; this is the real-`/row` e2e half
 * that the AC asks for, keyed off the real `navigator.gpu` / canvas APIs via
 * {@link installGpuProbe}.
 *
 * Branches on the engine outcome like every ride spec: on a real adapter
 * ('ready') it asserts the one-adapter/one-device budget; on a runner without
 * a hardware adapter ('fallback') it still asserts the engine never fell back
 * to WebGL and the decline is well-formed (#542 NFR5).
 */
import { expect, test } from '../fixtures/crash-watch';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  assertWellFormedDecline,
  installGpuProbe,
  installRideHarness,
  readGpuProbe,
  startDemoRide,
  waitForRideOutcome,
} from './helpers/engineRide';

test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

test('the engine opens one adapter + one device and never probes WebGL (#584 AC5.1)', async ({
  page,
}) => {
  await installGpuProbe(page);
  await installRideHarness(page);
  await startDemoRide(page);

  const outcome = await waitForRideOutcome(page);
  const probe = await readGpuProbe(page);
  expect(probe, 'the context-budget probe was installed before navigation').toBeTruthy();

  // Invariant on BOTH paths: the engine is WebGPU-only. Whether it attached or
  // declined, it must never have asked the canvas for a WebGL(2) context —
  // that was the old React fallback the engine deliberately dropped.
  expect(probe?.contextKinds, 'no webgl probe').not.toContain('webgl');
  expect(probe?.contextKinds, 'no webgl2 probe').not.toContain('webgl2');

  if (outcome === 'fallback') {
    // No hardware adapter: the engine declined cleanly. It may still have
    // requested an adapter to discover that, which is correct.
    await assertWellFormedDecline(page);
    return;
  }

  // Attached on a real adapter: one adapter + one device for the session, and
  // the canvas was only ever asked for a 'webgpu' context.
  expect(probe?.adapters, 'exactly one adapter request').toBe(1);
  expect(probe?.devices, 'exactly one device request').toBe(1);
  expect(probe?.contextKinds, 'the canvas is a webgpu surface').toContain('webgpu');
});
