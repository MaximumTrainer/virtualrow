import { test, expect } from '../fixtures/crash-watch';

// #542 P0 (AC4): the SvelteKit scaffold boots and serves at the deploy base
// path. This is the whole of the ported UI for now — P1 adds the real screens
// and their specs; here we only prove the shell loads under the same base path
// the production deploy uses.
test('the SvelteKit scaffold serves at the base path', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('virtualrow');
  await expect(page.getByTestId('svelte-scaffold')).toBeVisible();
  expect(page.url()).toContain('/virtualrow/app/');
});
