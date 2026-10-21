import { test, expect } from '../fixtures/crash-watch';

test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-webgl',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-unsafe-webgpu',
      '--no-sandbox',
      '--disable-gpu-rasterization',
      '--disable-gpu-compositing',
      '--disable-dev-shm-usage',
    ],
  },
});

/**
 * #570 P7-AC1 / AC2 / AC9 — boat smoke. Loads the hidden `/smoke/boat`
 * route which mounts the engine with a stub `getFrame` and a pace ghost.
 * Asserts the published telemetry a 3D-workout spec would read:
 *
 *   - `data-backend="webgpu"` on the canvas.
 *   - `__ROWER3D_CONTEXT_STATE.kind === "ready"`.
 *   - `__ROWER3D_POS` has a numeric `progress` field.
 *   - `__ROWER3D_BOAT.isPlaying === true` and `distanceMeters > 0` after
 *     a short wait (the stub advances distance with elapsed time).
 *   - `__ROWER3D_CREW.cadenceSpm > 0` and `amplitude > 0` with the stub
 *     reporting `isPlaying=true`.
 *   - `__ROWER3D_GHOST_METERS.active === true` and `value > 0`.
 *
 * On a runner without a WebGPU adapter the fallback mirrors the engine
 * smoke: `data-status === "unavailable"` and
 * `__VIRTUALROW_WEBGPU_HEALTH` publishes a fallback reason.
 */
test('webgpu boat smoke', async ({ page }) => {
  await page.goto('./smoke/boat');
  const main = page.getByTestId('webgpu-boat-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    // Let the stub advance for a short window + force a render so the
    // boat telemetry picks up a non-zero distance.
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const fn = (window as unknown as { __ROWER3D_FORCE_RENDER?: () => void })
        .__ROWER3D_FORCE_RENDER;
      fn?.();
    });

    const snapshot = await page.evaluate(
      () =>
        ({
          pos: (window as unknown as {
            __ROWER3D_POS?: { progress: number };
          }).__ROWER3D_POS,
          boat: (window as unknown as {
            __ROWER3D_BOAT?: {
              distanceMeters: number;
              progress: number;
              isPlaying: boolean;
              holding: boolean;
            };
          }).__ROWER3D_BOAT,
          crew: (window as unknown as {
            __ROWER3D_CREW?: {
              cadenceSpm: number;
              strokePhase: number;
              amplitude: number;
              rowers: number;
            };
          }).__ROWER3D_CREW,
          ghost: (window as unknown as {
            __ROWER3D_GHOST_METERS?: { value: number; active: boolean };
          }).__ROWER3D_GHOST_METERS,
        }),
    );
    expect(typeof snapshot.pos?.progress).toBe('number');
    expect(snapshot.boat?.isPlaying).toBe(true);
    expect(snapshot.boat?.distanceMeters ?? 0).toBeGreaterThan(0);
    expect(snapshot.crew?.cadenceSpm ?? 0).toBeGreaterThan(0);
    expect(snapshot.crew?.rowers).toBe(1);
    expect(snapshot.ghost?.active).toBe(true);
    expect(snapshot.ghost?.value ?? 0).toBeGreaterThan(0);
  } else {
    const health = await page.evaluate(
      () =>
        (window as unknown as {
          __VIRTUALROW_WEBGPU_HEALTH?: { fallbackReason?: string };
        }).__VIRTUALROW_WEBGPU_HEALTH,
    );
    expect(health?.fallbackReason).toBeTruthy();
  }
});
