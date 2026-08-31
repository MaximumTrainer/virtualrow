import fs from 'node:fs';
import path from 'node:path';
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

/**
 * Open the Routes screen (issue #219, R3).
 *
 * Below 768px the nav is behind the hamburger, so this opens that first —
 * which is also what makes the mobile nav part of the responsive matrix rather
 * than something only the desktop projects ever exercise.
 */
async function openRoutesScreen(page: Page) {
  const toggle = page.locator('.nav-toggle');
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await expect(page.locator('.view-container--search')).toBeVisible();
}

async function startDemo(page: Page) {
  // Wait for the map canvas before clicking. It is the last thing to paint on
  // the Row screen and the thing that intercepts pointer events aimed at the
  // controls beside it, so clicking earlier spends the whole action timeout in
  // Playwright's interception retry loop on a loaded machine.
  await expect(page.locator('.map-container canvas')).toBeVisible({ timeout: 20_000 });
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
    // The one door to route discovery (issue #219, AC2.2).
    await expectHitTestable(page, '.btn-change-route', 'Change route');
  });

  test('the routes list is reachable on the Routes screen', async ({ page }) => {
    // The route list lives on its own screen now (issue #219, R3). The import
    // and search sections above it stay gated on sign-in, so the auth-feature
    // surface is enabled the way the rest of the suite does it — this exercises
    // the whole screen's layout at each viewport, not just the list.
    await page.addInitScript(() => {
      (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
    });
    await page.goto('./');
    await openRoutesScreen(page);

    await expectHitTestable(page, '.route-item', 'first route in the list');
    await expectHitTestable(page, '.btn-back-to-row', 'Back to Row');
  });

  test('the device strips are short, wide rectangles side by side', async ({ page }, testInfo) => {
    // issue #219, AC5.1/AC5.2. Geometry is asserted where there is room for the
    // side-by-side layout; the narrower projects cover stacking through the
    // overflow and hit-test checks above.
    test.skip(
      !['laptop', 'desktop'].includes(testInfo.project.name),
      'strip geometry is specified at laptop and above',
    );
    await page.goto('./');

    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.routes-devices-row > .device-panel')).map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      }),
    );

    expect(boxes.length, 'expected a rower strip and a heart-rate strip').toBe(2);
    for (const b of boxes) {
      expect(b.h, `strip is ${b.h}px tall, over the 96px budget`).toBeLessThanOrEqual(96);
      expect(
        b.w,
        `strip is ${b.w}x${b.h} — not a horizontal rectangle`,
      ).toBeGreaterThan(2 * b.h);
    }
    expect(
      Math.abs(boxes[0].top - boxes[1].top),
      'the two strips should sit side by side, not stacked',
    ).toBeLessThanOrEqual(2);
  });

  test('the stage takes the majority of the main panel', async ({ page }, testInfo) => {
    // issue #219, AC4.1/AC4.2 — the game area is the product, so it gets the
    // space the stats panel and chrome used to borrow.
    const floors: Record<string, number> = {
      desktop: 0.65,
      laptop: 0.55,
      'phone-landscape': 0.45,
    };
    const floor = floors[testInfo.project.name];
    test.skip(floor === undefined, 'stage proportion is specified at these viewports');

    await page.goto('./');
    await startDemo(page);
    await expect(page.locator('.activity-route-stage')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.btn-activity-control').first()).toBeVisible({ timeout: 20_000 });

    // Poll rather than measure once: the R3F canvas mounts lazily and the stat
    // cards grow as their values arrive, so the first frame after the stage
    // appears is not yet the settled layout.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const main = document.querySelector('.app-main');
            const stage = document.querySelector('.activity-route-stage');
            if (!main || !stage) return 0;
            return stage.getBoundingClientRect().height / main.getBoundingClientRect().height;
          }),
        {
          timeout: 15_000,
          message: `stage never reached the ${Math.round(floor * 100)}% floor of the main panel`,
        },
      )
      .toBeGreaterThanOrEqual(floor);
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
    // DOM click: the WebGL canvas can still intercept pointer events in
    // headless Chromium even though the backdrop-filter layers are gone
    // (issue #219, R1).
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
    // Every rendered control, not a hand-maintained list: the acceptance
    // criterion is "every interactive control", and a list only ever covers
    // the controls someone remembered (issue #195, Phase 4).
    const measure = () =>
      page.evaluate(() => {
        const bad: { tag: string; cls: string; text: string; w: number; h: number }[] = [];
        const controls = document.querySelectorAll(
          'button, [role="button"], input[type="range"], input[type="checkbox"], select',
        );
        for (const el of Array.from(controls)) {
          const r = el.getBoundingClientRect();
          // Skip anything deliberately hidden.
          if (r.width === 0 && r.height === 0) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (r.height < 44 - 0.5 || r.width < 44 - 0.5) {
            bad.push({
              tag: el.tagName,
              cls: (el as HTMLElement).className,
              text: (el.textContent ?? '').trim().slice(0, 20),
              w: Math.round(r.width),
              h: Math.round(r.height),
            });
          }
        }
        return bad;
      });

    await page.goto('./');
    expect(await measure(), 'routes view controls under 44px').toEqual([]);

    // The debug panel and the PM5 simulator inside it only exist once opened.
    await page.evaluate(() => (document.querySelector('.btn-debug-toggle') as HTMLButtonElement | null)?.click());
    await expect(page.locator('.debug-info-panel')).toBeVisible();
    expect(await measure(), 'debug panel controls under 44px').toEqual([]);
    await page.evaluate(() => (document.querySelector('.debug-close-btn') as HTMLButtonElement | null)?.click());

    await startDemo(page);
    await expect(page.locator('.btn-activity-control').first()).toBeVisible({ timeout: 20_000 });
    expect(await measure(), 'workout view controls under 44px').toEqual([]);

    await page.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());
    await expect(page.locator('.guest-summary-modal')).toBeVisible({ timeout: 20_000 });
    expect(await measure(), 'summary modal controls under 44px').toEqual([]);
  });

  test('no webfont is fetched', async ({ page }) => {
    // issue #219, AC1.2 — the app runs on the system stack, so the Inter
    // @import (a render-blocking request to fonts.googleapis.com for a face the
    // system already covers) is gone and must stay gone.
    const fontRequests: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
        fontRequests.push(url);
      }
    });

    await page.goto('./');
    await expect(page.locator('.route-info-overlay h2')).toBeVisible();

    expect(fontRequests, `webfont requests: ${fontRequests.join(', ')}`).toEqual([]);

    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily.toLowerCase());
    expect(family).not.toContain('inter');
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

/* ============================================================================
   STYLE PINNING (issue #195, Phase 0)

   The plan asks for per-viewport screenshots so "the style stays pinned while
   layout changes". Pixel snapshots are not portable here: the E2E job runs on
   ubuntu, windows and macos, Playwright keys image snapshots by platform, and
   the stage renders WebGL through SwiftShader — three sets of baselines, none
   of them stable.

   These pins assert the same acceptance criterion ("same colours, radii,
   shadows, fonts") directly and deterministically: the computed style of the
   elements that carry the design, recorded in a committed fixture. A layout
   change leaves them untouched; a restyle shows up in review as a fixture diff.

   Regenerate after an intended restyle:
     UPDATE_STYLE_PINS=1 npx playwright test --config=playwright/playwright.config.ts \
       responsive.spec.ts --project=laptop --project=desktop
   ============================================================================ */

const PINNED_PROPERTIES = [
  'backgroundColor',
  'backgroundImage',
  'color',
  'borderRadius',
  'borderColor',
  'borderWidth',
  'boxShadow',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'textTransform',
] as const;

const PINNED_SELECTORS = {
  routes: [
    '.app-header',
    '.app-title',
    '.nav-tab',
    '.nav-tab.active',
    '.app-main',
    '.device-panel',
    '.panel-title',
    '.device-selector-tab',
    '.route-details-panel .route-info-overlay',
    '.route-details-panel .route-info-overlay .route-info-header h2',
    '.route-info-overlay .meta-badge',
    '.btn-start-workout',
    '.btn-change-route',
    '.btn-try-demo',
  ],
  // The route list and its controls moved to their own screen (issue #219, R3),
  // so they are captured after navigating rather than from the Row screen.
  routeSearch: [
    '.route-search-section',
    '.btn-back-to-row',
    '.routes-list',
    '.route-item',
    '.route-item .badge',
    '.filter-btn',
    '.btn-import-route',
  ],
  workout: [
    '.activity-route-stage',
    '.activity-route-summary',
    '.activity-route-summary h2',
    '.activity-stat-card',
    '.activity-stat-label',
    '.activity-stat-value',
    '.btn-activity-control',
    '.btn-activity-control--danger',
    '.activity-map-overlay',
  ],
  summary: [
    '.guest-summary-modal',
    '.guest-summary-route',
    '.guest-stat',
    '.guest-stat-label',
    '.guest-stat-value',
    '.btn-guest-row-again',
    '.btn-guest-exit',
  ],
} as const;

type Pins = Record<string, Record<string, Record<string, string> | null>>;

async function capturePins(page: Page, selectors: readonly string[], properties: readonly string[]) {
  return page.evaluate(
    ({ selectors, properties }) => {
      const out: Record<string, Record<string, string> | null> = {};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) {
          out[sel] = null;
          continue;
        }
        const computed = window.getComputedStyle(el);
        const props: Record<string, string> = {};
        for (const p of properties) {
          const value = computed[p as keyof CSSStyleDeclaration] as string;
          // macOS Chromium reports `BlinkMacSystemFont` as `system-ui`, and
          // quoting of multi-word families varies, so the raw string is not
          // comparable across the three E2E runners. Canonicalise it: which
          // families a rule asks for is the thing under test, not how the
          // engine spells them back.
          props[p] =
            p === 'fontFamily'
              ? value
                  .toLowerCase()
                  .replace(/["']/g, '')
                  .replace(/\bblinkmacsystemfont\b/g, 'system-ui')
                  .split(',')
                  .map((f) => f.trim())
                  .join(', ')
              : value;
        }
        out[sel] = props;
      }
      return out;
    },
    { selectors: [...selectors], properties: [...properties] },
  );
}

test.describe('visual style pins', () => {
  // Two viewports is what the acceptance criteria name, and the pins are about
  // colour/radius/shadow/font rather than layout, so the rest add no signal.
  test('colours, radii, shadows and fonts are unchanged', async ({ page }, testInfo) => {
    test.skip(
      !['laptop', 'desktop'].includes(testInfo.project.name),
      'pinned at 1366x768 and 1920x1080 only',
    );
    // The routes list is behind the auth-feature surface, as in "the routes list
    // is reachable" above; without it half the pinned selectors are absent.
    await page.addInitScript(() => {
      (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
    });
    await page.goto('./');
    await expect(page.locator('.btn-try-demo')).toBeVisible();

    const actual: Pins = {
      routes: await capturePins(page, PINNED_SELECTORS.routes, PINNED_PROPERTIES),
    };

    await openRoutesScreen(page);
    await expect(page.locator('.route-item').first()).toBeVisible();
    actual.routeSearch = await capturePins(page, PINNED_SELECTORS.routeSearch, PINNED_PROPERTIES);

    // The summary modal is for a guest session, which `__PLAYWRIGHT_TESTING`
    // suppresses — so the workout and summary pins come from a second page
    // without it, i.e. a real signed-out visitor.
    const visitor = await page.context().newPage();
    await visitor.setViewportSize(page.viewportSize()!);
    await visitor.goto('./');
    await visitor.locator('.btn-try-demo').click();
    await expect(visitor.locator('.activity-view')).toBeVisible({ timeout: 25_000 });
    await expect(visitor.locator('.btn-activity-control').first()).toBeVisible({ timeout: 20_000 });
    actual.workout = await capturePins(visitor, PINNED_SELECTORS.workout, PINNED_PROPERTIES);

    await visitor.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());
    await expect(visitor.locator('.guest-summary-modal')).toBeVisible({ timeout: 20_000 });
    actual.summary = await capturePins(visitor, PINNED_SELECTORS.summary, PINNED_PROPERTIES);
    await visitor.close();

    const fixture = path.join(testInfo.project.testDir, '..', 'fixtures', `style-pins.${testInfo.project.name}.json`);
    if (process.env.UPDATE_STYLE_PINS) {
      fs.writeFileSync(fixture, `${JSON.stringify(actual, null, 2)}\n`, 'utf-8');
      test.info().annotations.push({ type: 'style-pins', description: `rewrote ${fixture}` });
      return;
    }

    const expected = JSON.parse(fs.readFileSync(fixture, 'utf-8')) as Pins;
    expect(actual, `style drifted from ${fixture} — rerun with UPDATE_STYLE_PINS=1 if intended`).toEqual(expected);
  });
});
