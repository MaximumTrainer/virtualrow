import { test, expect, type Page } from '@playwright/test';

/**
 * Issue #195 — the layout clips instead of degrading outside ~1280x720.
 *
 * Runs once per viewport in the config's matrix. No `mock-bluetooth.js`: this is
 * a real signed-out visitor, and the demo control is what gets us into a session
 * without hardware.
 */

/**
 * Is this element the thing a tap at its centre would actually hit?
 *
 * `toBeVisible()` is not enough — the #195 bug is elements rendered inside the
 * viewport but covered by, or clipped out of, an `overflow:hidden` ancestor, so
 * a real tap lands on the ancestor instead.
 */
async function isHitTestable(page: Page, selector: string) {
  // Scroll it into view first. The acceptance criteria allow content to be
  // reached "by scroll where needed" — what must never happen is an element
  // that no amount of scrolling can reach, which is the #195 bug: an
  // overflow:hidden ancestor with no scrollable container leaves scrollIntoView
  // a no-op and the element permanently off-screen.
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  }, selector);
  // Give the scroll a frame or two to settle before measuring; at 150ms the
  // measurement could still land mid-scroll and report the pre-scroll stack.
  await page.waitForTimeout(400);

  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return { found: false, hit: false, reason: 'not in DOM' };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { found: true, hit: false, reason: 'zero size' };

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
      return {
        found: true,
        hit: false,
        reason: `outside viewport (centre ${Math.round(cx)},${Math.round(cy)} vs ${window.innerWidth}x${window.innerHeight})`,
      };
    }

    const top = document.elementFromPoint(cx, cy);
    const hit = !!top && (top === el || el.contains(top) || top.contains(el));
    return {
      found: true,
      hit,
      reason: hit
        ? 'ok'
        : `covered by ${top ? `${top.tagName}.${(top as HTMLElement).className}` : 'nothing'}`
          + ` (element at ${Math.round(r.top)}..${Math.round(r.bottom)})`,
    };
  }, selector);
}

async function expectHitTestable(page: Page, selector: string, label: string) {
  const result = await isHitTestable(page, selector);
  expect(result.found, `${label} (${selector}) should be in the DOM`).toBe(true);
  expect(result.hit, `${label} (${selector}) should be tappable — ${result.reason}`).toBe(true);
}

async function startDemo(page: Page) {
  await expectHitTestable(page, '.btn-try-demo', 'Try a demo row');
  await page.locator('.btn-try-demo').click();
  await expect(page.locator('.activity-view')).toBeVisible({ timeout: 25_000 });
}

test.describe('responsive layout', () => {
  test('no horizontal page overflow', async ({ page }) => {
    await page.goto('./');
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      overflow.scrollWidth,
      `page scrolls sideways: ${overflow.scrollWidth} > ${overflow.innerWidth}`,
    ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  });

  test('the routes view controls are reachable', async ({ page }) => {
    await page.goto('./');

    // The primary action must be tappable, not merely rendered.
    await expectHitTestable(page, '.btn-start-workout', 'Start Workout');
    // And the demo entry point that a visitor with no hardware needs.
    await expectHitTestable(page, '.btn-try-demo', 'Try a demo row');
  });

  test('the routes list is reachable', async ({ page }) => {
    // The routes list is gated on sign-in (RS-5), so it is absent for a plain
    // signed-out visitor. Enable the auth-feature surface the way the rest of
    // the suite does, so this exercises the list's *layout* at each viewport.
    await page.addInitScript(() => {
      (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
    });
    await page.goto('./');
    await expectHitTestable(page, '.route-item', 'first route in the list');
  });

  test('the device panels stay inside the viewport', async ({ page }) => {
    await page.goto('./');
    const overflowing = await page.evaluate(() => {
      const row = document.querySelector('.routes-devices-row');
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return { right: Math.round(r.right), innerWidth: window.innerWidth };
    });
    if (overflowing) {
      expect(
        overflowing.right,
        `device panels overflow the right edge: ${overflowing.right} > ${overflowing.innerWidth}`,
      ).toBeLessThanOrEqual(overflowing.innerWidth + 1);
    }
  });

  test('workout controls are reachable, and the session can be ended', async ({ page }) => {
    await page.goto('./');
    await startDemo(page);

    await expect(page.locator('.btn-activity-control').first()).toBeVisible({ timeout: 20_000 });

    await expectHitTestable(page, '.btn-end-workout', 'End Workout');
    // DOM click: the stage's compositing layer intercepts pointer events in
    // headless Chromium, as route-import-render.spec.ts also works around.
    await page.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());

    // The summary's own actions must be reachable too.
    await expect(page.locator('.guest-summary-modal')).toBeVisible({ timeout: 20_000 });
    await expectHitTestable(page, '.btn-guest-row-again', 'Row Again');
  });

  test('no console errors when the viewport is resized or rotated', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('./');
    const size = page.viewportSize()!;
    // Rotate, then step through a couple of sizes.
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(600);
    await page.setViewportSize(size);
    await page.waitForTimeout(600);

    expect(errors).toEqual([]);
  });

  test('interactive controls meet the 44px touch target floor', async ({ page }) => {
    await page.goto('./');

    const undersized = await page.evaluate(() => {
      const selectors = [
        '.nav-tab',
        '.device-selector-tab',
        '.auth-button',
        '.btn-start-workout',
        '.btn-try-demo',
        '.btn-debug-toggle',
      ];
      const bad: { selector: string; w: number; h: number }[] = [];
      for (const sel of selectors) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const r = el.getBoundingClientRect();
          // Skip anything deliberately hidden.
          if (r.width === 0 && r.height === 0) continue;
          if (r.height < 44 - 0.5) bad.push({ selector: sel, w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return bad;
    });

    expect(undersized, `controls under 44px tall: ${JSON.stringify(undersized)}`).toEqual([]);
  });

  test('no text renders below 11px', async ({ page }) => {
    await page.goto('./');

    const tiny = await page.evaluate(() => {
      const bad: { text: string; size: string; cls: string }[] = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const text = (el.textContent ?? '').trim();
        if (!text || el.children.length > 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (parseFloat(style.fontSize) < 10.5) {
          bad.push({ text: text.slice(0, 24), size: style.fontSize, cls: (el as HTMLElement).className });
        }
      }
      return bad;
    });

    expect(tiny, `text below 11px: ${JSON.stringify(tiny)}`).toEqual([]);
  });
});
