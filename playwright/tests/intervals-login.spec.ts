/**
 * intervals-login.spec.ts — Intervals.icu Authentication Flow E2E Tests
 *
 * These tests validate the full OAuth authentication flow with intervals.icu:
 *   - Happy path: valid credentials → successful login → authenticated user session
 *   - Sad path:   invalid credentials → error displayed → user remains unauthenticated
 *
 * Required environment variables (tests are skipped when not set):
 *   INTERVALS_TEST_USER     — valid intervals.icu account email
 *   INTERVALS_TEST_PASSWORD — valid intervals.icu account password
 *
 * Optional environment variables:
 *   BASE_URL — target VirtualRow deployment URL
 *              (defaults to the Playwright config baseURL: http://localhost:5173)
 *
 * These tests navigate through the actual intervals.icu OAuth flow and therefore
 * require a real registered client ID (VITE_INTERVALS_CLIENT_ID) and internet
 * access. They are automatically skipped in standard CI where only the placeholder
 * client ID is set and real test credentials are absent.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

const TEST_USER = process.env.INTERVALS_TEST_USER ?? '';
const TEST_PASSWORD = process.env.INTERVALS_TEST_PASSWORD ?? '';

/**
 * Deliberately invalid credentials used for the sad-path test.
 * No real intervals.icu account exists for these values.
 */
const INVALID_TEST_EMAIL = 'invalid-test-account@example-does-not-exist.invalid';
const INVALID_TEST_PASSWORD = 'WrongPassword!@#$%^&*InvalidTest123';

/**
 * True when a real (non-placeholder) intervals.icu OAuth client ID is in use.
 * When BASE_URL is set we assume the deployed app has a real registered client ID.
 * When running locally, VITE_INTERVALS_CLIENT_ID must be present and must not be
 * the CI placeholder value ("playwright-e2e-client").
 */
const CLIENT_ID = process.env.VITE_INTERVALS_CLIENT_ID ?? '';
const HAS_REAL_CLIENT_ID =
  !!process.env.BASE_URL ||
  (CLIENT_ID.length > 0 && CLIENT_ID !== 'playwright-e2e-client');

/**
 * True when real OAuth credentials and a real client ID have been injected via
 * environment variables. Both tests in this file require a live intervals.icu
 * client ID to reach the login form, so we gate on the same flag for the
 * sad-path test as well.
 */
const CREDENTIALS_AVAILABLE = TEST_USER.length > 0 && TEST_PASSWORD.length > 0 && HAS_REAL_CLIENT_ID;

// Basic sanity-check on the credential format to surface configuration mistakes early.
if (CREDENTIALS_AVAILABLE && !TEST_USER.includes('@')) {
  throw new Error('INTERVALS_TEST_USER must be a valid email address containing "@"');
}

/** Navigate to the app home page with the Web Bluetooth mock pre-installed. */
async function gotoWithMocks(page: Page): Promise<void> {
  const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
  await page.addInitScript({ content: initScript });
  await page.goto('./');
  await page.waitForSelector('.app-header', { timeout: 10_000 });
}

/**
 * Fill in and submit the intervals.icu login form.
 *
 * Uses a layered locator strategy (label → type attribute → name attribute) for
 * resilience against minor DOM changes on the external OAuth provider page.
 */
async function fillIntervalsLoginForm(page: Page, email: string, password: string): Promise<void> {
  // Locate the email/username field
  const emailField = page
    .getByLabel(/email/i)
    .or(page.locator('input[type="email"]'))
    .or(page.locator('input[name="email"]'))
    .first();
  await emailField.waitFor({ state: 'visible', timeout: 10_000 });
  await emailField.fill(email);

  // Locate the password field
  const passwordField = page
    .getByLabel(/password/i)
    .or(page.locator('input[type="password"]'))
    .or(page.locator('input[name="password"]'))
    .first();
  await passwordField.fill(password);

  // Submit the login form
  await page
    .getByRole('button', { name: /sign.?in|log.?in|submit/i })
    .first()
    .click();
}

// ─── Authentication flow tests ──────────────────────────────────────────────

test.describe('intervals.icu authentication flow', () => {
  test(
    'happy path: valid credentials result in an authenticated session',
    async ({ page }) => {
      test.skip(
        !CREDENTIALS_AVAILABLE,
        'INTERVALS_TEST_USER and INTERVALS_TEST_PASSWORD env vars are not set',
      );

      await gotoWithMocks(page);

      // 1. The sign-in button must be visible in the app header
      const signinBtn = page.locator('.auth-button--signin');
      await expect(signinBtn).toBeVisible({ timeout: 5_000 });

      // 2. Click sign-in — the app redirects the browser to intervals.icu
      await signinBtn.click();
      await page.waitForURL(/intervals\.icu/, { timeout: 15_000 });

      // 3. Complete the intervals.icu login form with valid credentials
      await fillIntervalsLoginForm(page, TEST_USER, TEST_PASSWORD);

      // 4. After a successful credential check, intervals.icu may show an OAuth
      //    consent / authorization screen before redirecting back to the app.
      //    Only click the consent button if it becomes visible; ignore if absent.
      const authorizeBtn = page.getByRole('button', {
        name: /authoriz|allow|grant|connect/i,
      });
      try {
        await authorizeBtn.first().waitFor({ state: 'visible', timeout: 8_000 });
        await authorizeBtn.first().click();
      } catch {
        // No consent screen appeared — intervals.icu redirected straight back
      }

      // 5. Wait for the OAuth callback redirect back to the VirtualRow app
      await page.waitForURL(/auth\/callback/, { timeout: 30_000 });
      await page.waitForSelector('.app-header', { timeout: 15_000 });

      // 6. Assert authenticated state — wait for the user account menu trigger to appear,
      //    which signals that the token exchange and session setup has completed.
      await expect(page.locator('.auth-user-trigger')).toBeVisible({ timeout: 15_000 });
      // The sign-in button must have been replaced by the user menu
      await expect(page.locator('.auth-button--signin')).not.toBeVisible();
    },
  );

  test(
    'sad path: invalid credentials show an error and the user remains unauthenticated',
    async ({ page }) => {
      test.skip(
        !CREDENTIALS_AVAILABLE,
        'Skipped — a real OAuth client ID (paired with INTERVALS_TEST_USER) is required to reach the intervals.icu login form',
      );

      await gotoWithMocks(page);

      // 1. The sign-in button must be visible in the app header
      const signinBtn = page.locator('.auth-button--signin');
      await expect(signinBtn).toBeVisible({ timeout: 5_000 });

      // 2. Click sign-in — the app redirects the browser to intervals.icu
      await signinBtn.click();
      await page.waitForURL(/intervals\.icu/, { timeout: 15_000 });

      // 3. Submit deliberately invalid credentials (no real account exists for these)
      await fillIntervalsLoginForm(page, INVALID_TEST_EMAIL, INVALID_TEST_PASSWORD);

      // 4. Build a combined locator for any user-facing error indicator on the page.
      //    Using .or() chains all candidates into a single locator so Playwright can
      //    check them concurrently and return as soon as one becomes visible.
      const errorLocator = page
        .getByRole('alert')
        .or(page.locator('[class*="error"], [class*="alert"]'))
        .or(page.getByText(/invalid|incorrect|wrong|failed|not found|no account/i));

      // Wait for the error indicator to appear — the test will fail here with a
      // clear message if no error is shown within the timeout.
      await errorLocator.first().waitFor({ state: 'visible', timeout: 10_000 });

      // 5. The user must still be on the intervals.icu domain — no redirect back to app
      expect(page.url()).toMatch(/intervals\.icu/);

      // 6. Assert the error indicator is visible
      await expect(
        errorLocator.first(),
        'An error indicator should be visible after an invalid login attempt',
      ).toBeVisible({ timeout: 2_000 });

      // 7. Navigate back to the app and confirm the user is still unauthenticated
      await page.goto('./');
      await page.waitForSelector('.app-header', { timeout: 10_000 });
      await expect(page.locator('.auth-button--signin')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('.auth-user-trigger')).not.toBeVisible();
    },
  );
});
