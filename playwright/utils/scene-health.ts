import { expect, type Page } from '@playwright/test';
import { describeSceneHealth, CONTEXT_LOST_TEXT } from '../../src/utils/sceneHealth';

/**
 * Fail a spec that is passing while the 3D scene is not there.
 *
 * Specs were asserting a canvas existed, telemetry was produced, or nothing
 * threw — all true of a stage showing
 * "The 3D view lost the graphics context — restoring…" instead of a river.
 *
 * Call this in any spec that claims the scene works. The one exception is
 * webgl-context-recovery.spec.ts, which causes the loss deliberately and
 * asserts the recovery.
 */
export async function expectSceneAlive(page: Page, context = 'the 3D scene'): Promise<void> {
  const observation = await page.evaluate(() => {
    const marker = document.querySelector('.rower3d-fallback-marker');
    return {
      lost: (window as unknown as { __ROWER3D_WEBGL_LOST?: boolean }).__ROWER3D_WEBGL_LOST === true,
      markerText: marker?.textContent ?? '',
      canvasCount: document.querySelectorAll('.rower3d-canvas-container canvas').length,
    };
  });

  const health = describeSceneHealth(observation);

  expect(health.alive, `${context}: ${health.reason}`).toBe(true);
}

/**
 * The banner text, for specs that want to assert its absence directly rather
 * than through the helper.
 */
export { CONTEXT_LOST_TEXT };
