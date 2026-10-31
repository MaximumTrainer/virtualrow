import { test, expect } from '../fixtures/crash-watch';

// #542 P1 (AC2/AC4): the SvelteKit shell boots at the deploy base path and
// renders the ported chrome — the brand title, the nav with the two screens,
// and the signed-out guest notice. The per-screen content ports in later P1
// slices; here we prove the shell and its routing load under the same base
// path the production deploy uses, with the class names the specs rely on.
test('the SvelteKit shell serves the brand chrome at the base path', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('VirtualRow');
  expect(page.url()).toContain('/virtualrow/app/');

  await expect(page.locator('.app-container')).toBeVisible();
  await expect(page.locator('.app-title')).toHaveText('VirtualRow');

  // Both screens are reachable from the nav.
  const nav = page.locator('nav.app-nav');
  await expect(nav.locator('.nav-tab', { hasText: 'Row' })).toBeVisible();
  await expect(nav.locator('.nav-tab', { hasText: 'Routes' })).toBeVisible();
});

test('the Routes nav tab navigates to the route-search screen', async ({ page }) => {
  await page.goto('./');
  await page.locator('nav.app-nav').locator('.nav-tab', { hasText: 'Routes' }).click();
  await expect(page).toHaveURL(/\/virtualrow\/app\/search\/?$/);
  await expect(page.locator('.app-layout--route-search')).toBeVisible();
});
