import { test } from '../fixtures/crash-watch';
import { expectSceneAliveThroughout } from '../utils/scene-health';

/**
 * The river has to still be there a minute in.
 *
 * Rower3D.tsx mounts the Canvas inside App's Suspense boundary. Everything that
 * dresses the river - models, textures, environments - loads late, and a
 * suspension is caught by the nearest boundary above it. With no boundary of
 * its own inside the Canvas, a GLB resolving a few seconds into a row hid the
 * whole Canvas: React keeps the DOM but destroys the effects, R3F disposes the
 * renderer on the way down, and the WebGL context goes with it.
 *
 * Measured on the demo row before the fix: one scene context created at ~1.6s,
 * a re-suspension at ~4.2s, and the context lost at ~6.0s - 'The 3D view lost
 * the graphics context - restoring...' written across the river while the rower
 * was still rowing. Every spec passed, because they all finished looking before
 * six seconds had gone by.
 *
 * This one keeps watching.
 */

/**
 * Long enough to cross the window the scene used to die in, twice over.
 *
 * Run against the code without the boundary, this failed at 13.4s and 15.1s on
 * two attempts. 30s keeps a margin over that without charging the suite for
 * time that proves nothing - it is one of about eighty specs sharing a 30 minute
 * job.
 */
const WATCH_MS = 30_000;

test('the scene keeps its graphics context for the whole row', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  // No BLE harness, and no pinned tier: this is the path a real session takes,
  // which is the one that loads the GLB scull and the scenery kits late.
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });

  await expectSceneAliveThroughout(page, WATCH_MS, 'the demo row');
});
