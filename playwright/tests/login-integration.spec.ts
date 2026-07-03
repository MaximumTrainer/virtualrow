/**
 * login-integration.spec.ts — OAuth callback login flow integration tests.
 *
 * These tests run against the real VirtualRow app (served by Vite dev server or a
 * build preview) and verify the end-to-end login flow by:
 *  1. Priming sessionStorage with a valid PKCE state + code verifier.
 *  2. Intercepting the CORS proxy endpoints so no real intervals.icu calls are made.
 *  3. Navigating to the app root with OAuth callback query params (?code=&state=).
 *  4. Asserting that the app transitions to the authenticated state.
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

const OAUTH_CODE = 'integration-test-oauth-code';
const OAUTH_STATE = 'integration-test-state';
const PKCE_VERIFIER = 'integration-test-pkce-verifier';

/** Navigate to the app with OAuth callback params, with auth session primed. */
async function setupCallbackNavigation(
  page: Page,
  tokenResponse: Record<string, unknown>,
  profileResponse: Record<string, unknown>,
  options: { numericIdReturns404?: boolean } = {},
): Promise<void> {
  const bluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
  await page.addInitScript({ content: bluetoothScript });

  // Prime sessionStorage with the PKCE state + code verifier before app boots
  await page.addInitScript(
    ({ state, verifier }: { state: string; verifier: string }) => {
      sessionStorage.setItem('vr_auth_state', state);
      sessionStorage.setItem('vr_auth_code_verifier', verifier);
    },
    { state: OAUTH_STATE, verifier: PKCE_VERIFIER },
  );

  // Intercept the token exchange POST
  await page.route('**/proxy/api/oauth/token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tokenResponse),
    });
  });

  if (options.numericIdReturns404) {
    const numericId = String(tokenResponse['athlete_id']);
    // First attempt: numeric path returns 404 (intervals.icu internal athletes use i-prefix)
    await page.route(`**/proxy/api/v1/athlete/${numericId}`, async (route) => {
      await route.fulfill({ status: 404 });
    });
    // Second attempt: i-prefixed path returns the profile
    await page.route(`**/proxy/api/v1/athlete/i${numericId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(profileResponse),
      });
    });
  } else {
    // Single profile path succeeds
    const athleteId = String(tokenResponse['athlete_id'] ?? '');
    await page.route(`**/proxy/api/v1/athlete/${athleteId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(profileResponse),
      });
    });
  }

  await page.goto(`./?code=${OAUTH_CODE}&state=${OAUTH_STATE}`);
  await page.waitForSelector('.app-header', { timeout: 10_000 });
}

// ─── Happy-path tests ──────────────────────────────────────────────────────────

test.describe('login integration: OAuth callback flow', () => {
  test(
    'happy path: i-prefixed athlete_id in token → single profile fetch → authenticated',
    async ({ page }) => {
      await setupCallbackNavigation(
        page,
        {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          athlete_id: 'i12345',
        },
        {
          id: 'i12345',
          firstname: 'Integration',
          lastname: 'Tester',
          email: 'integration@example.com',
        },
      );

      // User menu trigger signals a successful authenticated session
      await expect(page.locator('.auth-user-trigger')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.auth-button--signin')).not.toBeVisible();

      // Verify the athlete ID is persisted in sessionStorage
      const athleteId = await page.evaluate(() => sessionStorage.getItem('vr_auth_athlete_id'));
      expect(athleteId).toBe('i12345');
    },
  );

  test(
    'happy path: numeric athlete_id in token (as returned by intervals.icu) → 404 on numeric path → 200 on i-prefixed path → authenticated',
    async ({ page }) => {
      // Reproduces the reported 405 bug: intervals.icu returns athlete_id as an integer.
      // The app must try /api/v1/athlete/12345, get 404, then try /api/v1/athlete/i12345.
      await setupCallbackNavigation(
        page,
        {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          athlete_id: 12345, // numeric, as returned by real intervals.icu token exchange
        },
        {
          id: 'i12345',
          firstname: 'Numeric',
          lastname: 'Athlete',
          email: 'numeric@example.com',
        },
        { numericIdReturns404: true },
      );

      // Should successfully authenticate despite the numeric → i-prefix path resolution
      await expect(page.locator('.auth-user-trigger')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.auth-button--signin')).not.toBeVisible();

      const athleteId = await page.evaluate(() => sessionStorage.getItem('vr_auth_athlete_id'));
      expect(athleteId).toBe('i12345');
    },
  );

  test(
    'login end-to-end verification: token response returns athlete_id, profile request uses it, and authenticated user is created',
    async ({ page }) => {
      // Focused verification of the full login round-trip. Explicitly asserts:
      //  1. Token exchange responds with a non-empty athlete_id
      //  2. Profile request URL contains that same athlete_id
      //  3. Profile response contains an id
      //  4. The authenticated user menu appears (isAuthenticated === true)
      //  5. The athlete id is persisted in sessionStorage for subsequent sessions
      //
      // This is the scenario the user was hitting in production: verify the
      // whole handshake works and the athlete_id is present at every hop.

      const TOKEN_ATHLETE_ID = 'i98765';
      const bluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
      await page.addInitScript({ content: bluetoothScript });

      await page.addInitScript(
        ({ state, verifier }: { state: string; verifier: string }) => {
          sessionStorage.setItem('vr_auth_state', state);
          sessionStorage.setItem('vr_auth_code_verifier', verifier);
        },
        { state: OAUTH_STATE, verifier: PKCE_VERIFIER },
      );

      // Capture the exact token response body served to the app
      let tokenResponseBody: Record<string, unknown> | null = null;
      await page.route('**/proxy/api/oauth/token**', async (route) => {
        tokenResponseBody = {
          access_token: 'verified-access-token',
          refresh_token: 'verified-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          athlete_id: TOKEN_ATHLETE_ID,
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(tokenResponseBody),
        });
      });

      // Capture the exact profile URL that the app requests
      let profileRequestUrl: string | null = null;
      let profileResponseBody: Record<string, unknown> | null = null;
      await page.route(`**/proxy/api/v1/athlete/${TOKEN_ATHLETE_ID}`, async (route) => {
        profileRequestUrl = route.request().url();
        profileResponseBody = {
          id: TOKEN_ATHLETE_ID,
          firstname: 'Verified',
          lastname: 'Rower',
          email: 'verified@example.com',
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(profileResponseBody),
        });
      });

      await page.goto(`./?code=${OAUTH_CODE}&state=${OAUTH_STATE}`);
      await page.waitForSelector('.app-header', { timeout: 10_000 });

      // 4. Wait for authenticated user state
      await expect(page.locator('.auth-user-trigger')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.auth-button--signin')).not.toBeVisible();

      // 1. The token response was served with a non-empty athlete_id
      expect(tokenResponseBody, 'token exchange must have been called').not.toBeNull();
      expect(tokenResponseBody!['athlete_id'], 'token response must include a non-empty athlete_id')
        .toBeTruthy();
      expect(String(tokenResponseBody!['athlete_id']).length).toBeGreaterThan(0);

      // 2. The profile request URL contains the athlete_id from the token
      expect(profileRequestUrl, 'profile request must have been made').not.toBeNull();
      expect(profileRequestUrl!).toContain(`/proxy/api/v1/athlete/${TOKEN_ATHLETE_ID}`);
      // The profile URL must NOT be the ID-less /proxy/api/v1/athlete endpoint (returns 405)
      expect(profileRequestUrl!).not.toMatch(/\/proxy\/api\/v1\/athlete(?:\?|$)/);

      // 3. The profile response contained an id
      expect(profileResponseBody, 'profile response must have been served').not.toBeNull();
      expect(profileResponseBody!['id'], 'profile response must include an id').toBe(TOKEN_ATHLETE_ID);

      // 5. The athlete id is persisted in sessionStorage
      const persistedAthleteId = await page.evaluate(() => sessionStorage.getItem('vr_auth_athlete_id'));
      expect(persistedAthleteId).toBe(TOKEN_ATHLETE_ID);

      // Also verify the user object was stored with the correct id
      const persistedUserJson = await page.evaluate(() => sessionStorage.getItem('vr_auth_user'));
      expect(persistedUserJson, 'user must be persisted in sessionStorage').not.toBeNull();
      const persistedUser = JSON.parse(persistedUserJson!) as { id: string; name: string };
      expect(persistedUser.id).toBe(TOKEN_ATHLETE_ID);
      expect(persistedUser.name).toBe('Verified Rower');

      // No sign-in error should be visible
      await expect(page.locator('.auth-login-error')).not.toBeVisible();
    },
  );
});

// ─── Sad-path tests ────────────────────────────────────────────────────────────

test.describe('login integration: error paths', () => {
  test(
    'sign-in fails when token exchange returns an error',
    async ({ page }) => {
      const bluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
      await page.addInitScript({ content: bluetoothScript });

      await page.addInitScript(
        ({ state, verifier }: { state: string; verifier: string }) => {
          sessionStorage.setItem('vr_auth_state', state);
          sessionStorage.setItem('vr_auth_code_verifier', verifier);
        },
        { state: OAUTH_STATE, verifier: PKCE_VERIFIER },
      );

      // Token exchange fails
      await page.route('**/proxy/api/oauth/token**', async (route) => {
        await route.fulfill({ status: 400, body: JSON.stringify({ error: 'invalid_grant' }) });
      });

      await page.goto(`./?code=${OAUTH_CODE}&state=${OAUTH_STATE}`);
      await page.waitForSelector('.app-header', { timeout: 10_000 });

      // User remains unauthenticated
      await expect(page.locator('.auth-button--signin')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.auth-user-trigger')).not.toBeVisible();
    },
  );

  test(
    'sign-in fails gracefully when token response omits athlete_id (no profile path available)',
    async ({ page }) => {
      const bluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
      await page.addInitScript({ content: bluetoothScript });

      await page.addInitScript(
        ({ state, verifier }: { state: string; verifier: string }) => {
          sessionStorage.setItem('vr_auth_state', state);
          sessionStorage.setItem('vr_auth_code_verifier', verifier);
        },
        { state: OAUTH_STATE, verifier: PKCE_VERIFIER },
      );

      // Token exchange succeeds but omits athlete_id
      await page.route('**/proxy/api/oauth/token**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'mock-access-token',
            expires_in: 3600,
            token_type: 'Bearer',
            // No athlete_id — app must fail gracefully without calling /api/v1/athlete (405)
          }),
        });
      });

      await page.goto(`./?code=${OAUTH_CODE}&state=${OAUTH_STATE}`);
      await page.waitForSelector('.app-header', { timeout: 10_000 });

      // App should remain unauthenticated and show an error
      await expect(page.locator('.auth-button--signin')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.auth-user-trigger')).not.toBeVisible();
    },
  );

  test(
    'state mismatch prevents callback from completing (CSRF protection)',
    async ({ page }) => {
      const bluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
      await page.addInitScript({ content: bluetoothScript });

      // Store a DIFFERENT state in sessionStorage — simulates a CSRF attempt
      await page.addInitScript(() => {
        sessionStorage.setItem('vr_auth_state', 'legitimate-state');
        sessionStorage.setItem('vr_auth_code_verifier', 'test-verifier');
      });

      await page.route('**/proxy/api/oauth/token**', async (route) => {
        // Should never be called due to state mismatch
        await route.fulfill({ status: 200, body: JSON.stringify({}) });
      });

      // Navigate with a mismatched state
      await page.goto(`./?code=${OAUTH_CODE}&state=tampered-state`);
      await page.waitForSelector('.app-header', { timeout: 10_000 });

      // Must remain unauthenticated
      await expect(page.locator('.auth-button--signin')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.auth-user-trigger')).not.toBeVisible();
    },
  );
});
