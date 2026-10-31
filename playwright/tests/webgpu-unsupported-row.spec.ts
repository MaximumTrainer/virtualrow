import { test, expect } from '../fixtures/crash-watch';

// #542 AC11 / FR11 — when the browser cannot render through WebGPU (no
// `navigator.gpu`, software-only adapter, or an `attach` throw), the ride
// view shows a "needs WebGPU" screen and the rest of the site stays
// reachable. We force the first branch by stubbing `navigator.gpu` to
// `undefined` before the page scripts run; the engine's `requestDevice`
// then rejects and `attach` returns null, which is the AC11 path.
test.describe('WebGPU unsupported — ride view', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.navigator, 'gpu', {
          configurable: true,
          get() {
            return undefined;
          },
        });
      } catch {
        // Browsers that don't let the property be redefined still show the
        // unsupported screen when the engine declines; the smoke suite covers
        // the attach-returns-null branch directly.
      }
    });
  });

  test('shows the "WebGPU required" screen on /row when no adapter is available', async ({ page }) => {
    // Start a demo so the ride view mounts the engine (/row's active-session
    // branch). The "try demo" CTA lives on the Row screen (`/`).
    await page.goto('./');
    const demoCta = page.locator('.btn-try-demo').first();
    await expect(demoCta).toBeVisible({ timeout: 15_000 });
    await demoCta.click();

    // `/row` renders the stage, Canvas3DHost calls `attach`, the engine
    // declines, Canvas3DHost raises `backend='unavailable'` to the page, and
    // the page swaps the stage for `<WebGpuUnsupported>`.
    await page.waitForURL(/\/row\/?$/, { timeout: 15_000 });
    const screen = page.locator('.webgpu-unsupported');
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole('heading')).toContainText(/WebGPU/i);
    // The rest of the site stays reachable through the "Back to routes" link.
    const back = screen.getByRole('link', { name: /routes/i });
    await expect(back).toBeVisible();
  });

  test('navigating back to routes from the unsupported screen keeps the site usable', async ({ page }) => {
    await page.goto('./');
    const demoCta = page.locator('.btn-try-demo').first();
    await expect(demoCta).toBeVisible({ timeout: 15_000 });
    await demoCta.click();

    await page.waitForURL(/\/row\/?$/, { timeout: 15_000 });
    const screen = page.locator('.webgpu-unsupported');
    await expect(screen).toBeVisible({ timeout: 15_000 });

    await screen.getByRole('link', { name: /routes/i }).click();
    // We're back on the Row screen; chrome works, no "WebGPU required"
    // dialog persists on the home.
    await expect(page.locator('.webgpu-unsupported')).toHaveCount(0);
  });
});
