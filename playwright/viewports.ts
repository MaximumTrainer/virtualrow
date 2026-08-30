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

/** The matrix as Playwright projects, plus a `default` project for every other spec. */
export function responsiveProjects(): Project[] {
  return [
    { name: 'default', testIgnore: RESPONSIVE_SPEC },
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
