import { test, expect } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';
import {
  countContextsFrom,
  allContexts,
  webglContexts,
  contextState,
  telemetry,
  bannerText,
} from '../utils/gl-context';

/**
 * The app must stop taking its own context away (#309, R7 and R8).
 *
 * Every context loss anyone has explained in this repository was self-inflicted:
 *
 *   - capability probes opening contexts, and a browser evicting the oldest —
 *     the scene's — at the moment a new one is created. Seven contexts for one
 *     demo row, nine `webglcontextlost` events inside 1.5 s (#261).
 *   - a late GLB re-suspending the tree, so R3F disposed the renderer mid-row.
 *     Created ~1.6 s, re-suspended ~4.2 s, lost ~6.0 s (`2a4d160`).
 *   - the scene-health guard creating the context it audits (`12eafda`).
 *
 * All three are fixed, and until now nothing held them fixed. Probed on
 * 2026-09-20 the app opens four webgl2 contexts, all inside the first 829 ms,
 * and none afterwards over a 34 s row.
 *
 * Not one of those losses was the driver's doing, which is why this spec is a
 * budget rather than a recovery test.
 */

/**
 * The ceiling, and it ratchets down like coverage does.
 *
 * Three probes that release before the scene's own is created, plus the
 * scene's. It went 7 → 5 → 4 across #261's fixes and must never go back up;
 * lower it if a change removes a probe.
 */
const CONTEXT_BUDGET = 4;

/** All four were open by 829 ms when measured; this leaves room on a slow box. */
const BUDGET_WINDOW_MS = 4_000;

/** Long enough to cross the window the scene used to die in, twice over. */
const WATCH_MS = 30_000;

test('a row opens the contexts it needs and no more', async ({ page }) => {
  test.slow();

  await countContextsFrom(page);
  // The visitor's own path, which is the one that loads the GLB scull and the
  // scenery kits late — the shape that used to take the renderer down.
  await page.addInitScript(() => {
    (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the demo row');

  await page.waitForTimeout(WATCH_MS);

  const everyContext = await allContexts(page);
  const contexts = await webglContexts(page);
  const at = contexts.map((c) => Math.round(c.at));

  // Counted as creations, not calls: a repeat getContext on a canvas that
  // already has one returns the same object and evicts nothing. Asking that
  // question instead gave six, because expectSceneAlive asks every canvas
  // whether its context is lost.
  //
  // Said first, because "0 webgl2 contexts" reads as a triumph and is usually
  // a guard that never ran.
  expect(
    everyContext.length,
    'getContext was never called, so the counter was not installed and this measured nothing',
  ).toBeGreaterThan(0);

  expect(
    contexts.length,
    `the scene opened ${contexts.length} webgl2 contexts (at ${at.join(', ')} ms). ` +
      `The budget is ${CONTEXT_BUDGET}: three probes released before the scene's own, ` +
      `plus the scene's. A browser keeps only a handful alive and evicts the oldest ` +
      `at the moment a new one is created — and the oldest is the one drawing the river (#261).`,
  ).toBeLessThanOrEqual(CONTEXT_BUDGET);

  expect(
    contexts.length,
    'the scene drew without ever opening a webgl2 context, which cannot be: ' +
      `types seen were ${JSON.stringify([...new Set(everyContext.map((c) => c.type))])}`,
  ).toBeGreaterThan(0);

  // Opened early, together, and then never again. A context asked for later in
  // a row is a probe running on a remount, which is what evicted the scene's.
  const last = Math.max(...contexts.map((c) => c.at));
  expect(
    last,
    `the last webgl2 context was opened at ${Math.round(last)} ms, ` +
      `well after the scene's own (at ${at.join(', ')} ms)`,
  ).toBeLessThan(BUDGET_WINDOW_MS);
});

test('a row nobody interferes with never loses its context', async ({ page }) => {
  test.slow();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the demo row');

  await page.waitForTimeout(WATCH_MS);

  // A counter, not a sample.
  //
  // scene-context-endurance.spec.ts watches for the banner every 250 ms, which
  // cannot see a loss that is restored between two samples — the rower still
  // saw it. `losses` only ever goes up, so it catches what sampling misses.
  const state = await contextState(page);
  expect(state, 'the scene never reported its context state').not.toBeNull();
  expect(
    state!.losses,
    `the scene lost its context ${state!.losses} time(s) in ${WATCH_MS / 1000}s of rowing ` +
      `(last reason: ${state!.lostReason ?? 'none given'})`,
  ).toBe(0);

  const log = await telemetry(page);
  expect(
    log.filter((e) => e.kind === 'context-lost'),
    'the telemetry recorded a context loss on an undisturbed row',
  ).toEqual([]);

  expect(await bannerText(page)).toBe('');
  expect(errors, 'the page reported errors while rowing').toEqual([]);
});
