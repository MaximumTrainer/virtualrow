import { defineConfig } from '@playwright/test';
import ci from './playwright.config.ci';
import { ENDURANCE_SPEC } from './viewports';

/**
 * The long-running route traverses (#272), on their own.
 *
 * These row a route from one end to the other, which answers a different
 * question from the rest of the suite: not "does this build work" but "does it
 * still work an entire route later". They take a couple of minutes each, so
 * they are kept out of the job that verifies a deploy and given their own.
 *
 * Everything else - the browser flags, the software rasteriser, the built app
 * under test - is inherited, so the two jobs are looking at the same thing.
 */
export default defineConfig({
  ...ci,
  // One project, and no responsive matrix: a traverse says nothing extra at a
  // second viewport, and would cost another two minutes to say it.
  projects: [{ name: 'endurance', testMatch: ENDURANCE_SPEC }],
  // A traverse is minutes long by design, and a retry costs that again.
  retries: 1,
});
