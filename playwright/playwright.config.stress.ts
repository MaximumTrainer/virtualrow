import { defineConfig } from '@playwright/test';
import ci from './playwright.config.ci';
import { HEAVY_SPEC } from './viewports';

/**
 * The heavy stress traverse (#301), on a schedule.
 *
 * A 20 km course of 2000 points, driven at 2 Hz with two round trips into the
 * page per tick — the configuration that killed the tab twice while #272 was
 * being written, and which was reduced away for cost rather than explained.
 *
 * Kept out of the push path because it is expensive and because it is a
 * question rather than a guard: the point is to find out whether the failure is
 * real and what causes it. Everything else is inherited from the CI config, so
 * it looks at the same built app on the same software rasteriser.
 */
export default defineConfig({
  ...ci,
  projects: [{ name: 'stress', testMatch: HEAVY_SPEC }],
  // No retries: a retry would hide exactly the intermittency being measured.
  retries: 0,
});
