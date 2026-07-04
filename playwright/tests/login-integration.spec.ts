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

      // Verify the authenticated user snapshot is persisted in sessionStorage
      const persistedUser = await page.evaluate(() => {
        const raw = sessionStorage.getItem('vr_auth_user');
        return raw ? (JSON.parse(raw) as { id: string }) : null;
      });
      expect(persistedUser?.id).toBe('i12345');
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

      const persistedUser = await page.evaluate(() => {
        const raw = sessionStorage.getItem('vr_auth_user');
        return raw ? (JSON.parse(raw) as { id: string }) : null;
      });
      expect(persistedUser?.id).toBe('i12345');
    },
  );

  test(
    'login end-to-end verification: token response returns athlete_id, profile request uses it, and authenticated user is created',
    async ({ page }) => {
      // Focused verification of the full login round-trip. Explicitly asserts:
      //  - Token exchange endpoint is hit with a non-empty athlete_id in the response
      //  - Profile request URL contains that athlete_id (never the 405-returning ID-less form)
      //  - Profile response contains an id
      //  - The authenticated user menu appears (isAuthenticated === true)
      //  - The athlete id + user are persisted in sessionStorage for subsequent sessions
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

      // Observe every request the app makes to the proxy — this gives us a
      // complete picture of the observed traffic (unlike a route filter, which
      // silently misses non-matching URLs). We use this to prove that the
      // ID-less /proxy/api/v1/athlete endpoint was never called.
      const observedAthleteRequestUrls: string[] = [];
      page.on('request', (req) => {
        const url = req.url();
        if (url.includes('/proxy/api/v1/athlete')) {
          observedAthleteRequestUrls.push(url);
        }
      });

      // Serve a token response with a non-empty athlete_id
      await page.route('**/proxy/api/oauth/token**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'verified-access-token',
            refresh_token: 'verified-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
            athlete_id: TOKEN_ATHLETE_ID,
          }),
        });
      });

      // Serve the profile response for the expected athlete-specific URL.
      // Any other URL the app hits will be recorded above but not fulfilled by
      // this handler, which is exactly what we want for the regression guard.
      let profileFulfilled = false;
      await page.route(`**/proxy/api/v1/athlete/${TOKEN_ATHLETE_ID}**`, async (route) => {
        profileFulfilled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: TOKEN_ATHLETE_ID,
            firstname: 'Verified',
            lastname: 'Rower',
            email: 'verified@example.com',
          }),
        });
      });

      await page.goto(`./?code=${OAUTH_CODE}&state=${OAUTH_STATE}`);
      await page.waitForSelector('.app-header', { timeout: 10_000 });

      // Wait for authenticated user state — proves the full handshake succeeded
      await expect(page.locator('.auth-user-trigger')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.auth-button--signin')).not.toBeVisible();

      // The app must have hit the athlete-specific profile endpoint
      expect(profileFulfilled, 'app must call the athlete-specific profile endpoint').toBe(true);

      // Every observed athlete request must have included an ID segment — the
      // app must NEVER hit the 405-returning /proxy/api/v1/athlete (no ID) URL.
      expect(observedAthleteRequestUrls.length).toBeGreaterThan(0);
      for (const url of observedAthleteRequestUrls) {
        expect(
          url,
          `unexpected ID-less athlete endpoint request: ${url}`,
        ).not.toMatch(/\/proxy\/api\/v1\/athlete(?:\?|$)/);
        expect(
          url,
          `athlete request should include the athlete_id path segment: ${url}`,
        ).toMatch(/\/proxy\/api\/v1\/athlete\/[^/?#]+/);
      }
      // At least one athlete request must have used the athlete_id from the token
      expect(observedAthleteRequestUrls.some((u) => u.includes(`/proxy/api/v1/athlete/${TOKEN_ATHLETE_ID}`)))
        .toBe(true);

      // The authenticated user must be persisted in sessionStorage
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
