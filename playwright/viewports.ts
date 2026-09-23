import type { Project } from '@playwright/test';

/**
 * Viewport matrix for responsive coverage (issue #195).
 *
 * Until this existed every spec ran at a single 1280x720, which is why phone,
 * tablet and short-landscape clipping went unnoticed. `responsive.spec.ts` runs
 * once per entry below; every other spec keeps running at the default viewport
 * only, so suite runtime does not multiply.
 *
 * Shared by the local and CI configs — the matrix is worth little if CI keeps
 * rendering one size.
 */
export const RESPONSIVE_VIEWPORTS = [
  { name: 'phone-portrait', width: 375, height: 667 },
  { name: 'phone-small', width: 320, height: 568 },
  { name: 'phone-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'uhd', width: 3840, height: 2160 },
  { name: 'short-wide', width: 1280, height: 500 },
] as const;

export const RESPONSIVE_SPEC = '**/responsive.spec.ts';

/**
 * The long-running traverses (#272), which are not part of verifying a deploy.
 *
 * They row a route from one end to the other and take a couple of minutes each.
 * That is a different question from 'does this build work', asked at a different
 * cadence, so they run in their own job - see playwright.config.endurance.ts.
 */
export const ENDURANCE_SPEC = '**/route-endurance.spec.ts';

/**
 * The heavy stress traverse (#301), which runs on a schedule and nowhere else.
 *
 * It exists to answer a question - does a 20 km course of 2000 points really
 * kill the tab under a harness making two round trips a tick - rather than to
 * guard a behaviour. It is deliberately the expensive shape, so it is not worth
 * a place on the push path until it has an answer.
 */
export const HEAVY_SPEC = '**/*.heavy.spec.ts';

/**
 * The visual baselines (#340).
 *
 * They compare the canvas against a committed PNG, and a PNG only means
 * anything on the rasteriser that drew it - so they run on one Linux job with
 * SwiftShader and nowhere else. On a developer's GPU, or on the Windows and
 * macOS legs of the verification matrix, every shot would differ for reasons
 * that have nothing to do with the change under test.
 */
export const VISUAL_SPEC = '**/visual/*.spec.ts';

/**
 * The published screenshots (#362), a visual spec whose baselines are the
 * files under `docs/` that the site serves. It matches VISUAL_SPEC too, so
 * every config that ignores the visual suite ignores this with it.
 */
export const DOCS_SCREENSHOTS_SPEC = '**/visual/docs-screenshots.spec.ts';

/** The matrix as Playwright projects, plus a `default` project for every other spec. */
export function responsiveProjects(): Project[] {
  return [
    { name: 'default', testIgnore: [RESPONSIVE_SPEC, ENDURANCE_SPEC, HEAVY_SPEC, VISUAL_SPEC] },
    ...RESPONSIVE_VIEWPORTS.map((v) => ({
      name: v.name,
      testMatch: RESPONSIVE_SPEC,
      use: {
        viewport: { width: v.width, height: v.height },
        // 4K at dpr 2 would allocate a 7680x4320 backing store for no extra signal.
        deviceScaleFactor: 1,
        hasTouch: v.width <= 812,
        isMobile: false,
      },
    })),
  ];
}
