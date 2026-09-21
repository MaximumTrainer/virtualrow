import { defineConfig } from '@playwright/test';
import ci from './playwright.config.ci';
import { VISUAL_SPEC } from './viewports';

/**
 * The visual baseline suite (#340).
 *
 * Every ticket in the visual backlog changes pixels. Two specs took
 * screenshots before this and exactly one baseline existed, so the only way to
 * tell a fix from a regression was to look at the app and remember what it used
 * to look like. This renders one frozen frame per theme, tier and viewport and
 * compares it with a committed PNG.
 *
 * Everything but the projects is inherited from the CI config, so the app under
 * the camera is the built bundle served at the deploy's base path, drawn by the
 * same SwiftShader rasteriser. That inheritance is the point: a baseline is a
 * picture of one renderer, and the moment two machines record it the suite
 * measures the machines.
 *
 * No retries. A retry of a screenshot comparison either produces the same
 * answer, in which case it cost a minute of SwiftShader time, or a different
 * one - which is a flaky frame, and the thing most worth knowing about.
 */
export default defineConfig({
  ...ci,
  testDir: './tests',
  projects: [{ name: 'visual', testMatch: VISUAL_SPEC }],
  // Beside the specs rather than under a per-platform folder: the shots are
  // recorded on one platform on purpose, so a `-linux` suffix would only
  // suggest the others exist.
  snapshotPathTemplate: '{testDir}/visual/__snapshots__/{arg}{ext}',
  // One at a time. Parallel WebGL contexts on a software rasteriser contend for
  // the same CPU, and a frame that renders slowly is a frame that gets
  // photographed half-finished.
  workers: 1,
  retries: 0,
});
