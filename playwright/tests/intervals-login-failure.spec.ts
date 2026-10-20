import { test, expect, type Page, type Route } from '../fixtures/crash-watch';
import type { CrashPayload } from '../../src/lib/types/crashPayload';

/**
 * intervals-login-failure.spec.ts — Phase 1 + Phase 2 of issue #486.
 *
 * Phase 1 reproduces every failure branch of `AuthService.handleCallback` by
 * mocking the CORS proxy's token endpoint and asserts the structured
 * `authFailure` capture the production code emits via the #473 crash
 * transport (D3 = a, `kind: 'oauth-token-exchange'`).
 *
 * Phase 2 asserts the UX half of ACs 1–5: classified alert copy and the
 * Retry button's presence per class (D2 = a, D4 = a).
 *
 * The spec is self-contained: no real intervals.icu client ID, no real
 * network access. It drives the callback by seeding sessionStorage with a
 * matching PKCE state + verifier and navigating to `/?code=&state=`, which
 * is exactly what `public/auth/callback/index.html` ends up producing after
 * its own `window.location.replace`.
 */

const TOKEN_URL_PATTERN = /mt-intervals-proxy\.intervals-login\.workers\.dev\/proxy\/api\/oauth\/token/;
const CAPTURED_KEY = '__VIRTUALROW_CAPTURED_CRASHES__';

/** Opt the stub crash transport into collecting payloads for the assertions. */
const seedCapture = async (page: Page): Promise<void> => {
  await page.addInitScript(`window.${CAPTURED_KEY} = [];`);
};

/** Pre-seed the PKCE state + verifier the AuthProvider needs for a callback. */
const seedPkce = async (page: Page): Promise<void> => {
  await page.addInitScript(`try {
    sessionStorage.setItem('vr_auth_state', 'test-state');
    sessionStorage.setItem('vr_auth_code_verifier', 'test-verifier');
  } catch {}`);
};

/** Drop any workout router + 3D route redirects the shell might attempt. */
const navigateToCallback = async (page: Page): Promise<void> => {
  await page.goto('./?code=playwright-code-value&state=test-state');
};

const readCaptured = (page: Page): Promise<CrashPayload[]> =>
  page.evaluate((key) => {
    const w = window as unknown as Record<string, unknown>;
    const captured = w[key];
    return Array.isArray(captured) ? (captured as CrashPayload[]) : [];
  }, CAPTURED_KEY);

/** Install a one-shot route that answers the next token POST with `fulfill`. */
const stubTokenEndpoint = async (
  page: Page,
  fulfill: (route: Route) => Promise<void>,
): Promise<void> => {
  await page.route(TOKEN_URL_PATTERN, fulfill);
};

test.describe('#486 Phase 1 — intervals.icu login failure capture', () => {
  test.beforeEach(async ({ page }) => {
    await seedCapture(page);
    await seedPkce(page);
  });

  test('AC1 — invalid_client (H2) is captured with status 401 and the error code', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_client' }),
      });
    });

    await navigateToCallback(page);

    await expect
      .poll(async () => (await readCaptured(page)).length, {
        timeout: 5_000,
        intervals: [100, 200, 500],
      })
      .toBe(1);

    const payload = (await readCaptured(page))[0]!;
    expect(payload.kind).toBe('oauth-token-exchange');
    expect(payload.authFailure).toEqual({
      status: 401,
      errorCode: 'invalid_client',
      errorDescription: null,
      networkError: false,
    });

    // AC6: no PKCE / token-shaped substrings leak via the capture.
    const serialised = JSON.stringify(payload);
    for (const forbidden of [
      'playwright-code-value',
      'test-verifier',
      'test-state',
      'access_token',
      'refresh_token',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  test('AC2 — invalid_grant (replayed code, H3) is captured with the error description', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'authorization code has already been used',
        }),
      });
    });

    await navigateToCallback(page);

    await expect
      .poll(async () => (await readCaptured(page)).length, {
        timeout: 5_000,
        intervals: [100, 200, 500],
      })
      .toBe(1);

    const payload = (await readCaptured(page))[0]!;
    expect(payload.authFailure?.errorCode).toBe('invalid_grant');
    expect(payload.authFailure?.status).toBe(400);
    expect(payload.authFailure?.errorDescription).toContain('already been used');
    expect(payload.authFailure?.networkError).toBe(false);
  });

  test('AC3 — a transient 500 is captured without an error code', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'upstream unavailable',
      });
    });

    await navigateToCallback(page);

    await expect
      .poll(async () => (await readCaptured(page)).length, {
        timeout: 5_000,
        intervals: [100, 200, 500],
      })
      .toBe(1);

    const payload = (await readCaptured(page))[0]!;
    expect(payload.authFailure).toEqual({
      status: 500,
      errorCode: null,
      errorDescription: null,
      networkError: false,
    });
  });

  test('AC4 — a network error (fetch throw) is captured with networkError=true', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.abort('failed');
    });

    await navigateToCallback(page);

    await expect
      .poll(async () => (await readCaptured(page)).length, {
        timeout: 5_000,
        intervals: [100, 200, 500],
      })
      .toBe(1);

    const payload = (await readCaptured(page))[0]!;
    expect(payload.kind).toBe('oauth-token-exchange');
    expect(payload.authFailure).toEqual({
      status: null,
      errorCode: null,
      errorDescription: null,
      networkError: true,
    });
  });

  test('AC5 — a CSRF state mismatch does not emit a capture (not a server failure)', async ({ page }) => {
    // The real failure path still fires a reportCrash for genuine server
    // misbehaviour, but a state mismatch is a client-side CSRF guard: no
    // capture should fire.
    await page.goto('./?code=playwright-code-value&state=tampered-state');
    await page.waitForLoadState('networkidle');
    const captured = await readCaptured(page);
    expect(captured).toHaveLength(0);
  });

  // ─── Phase 2: classified UX + Retry button (#486 Phase 2, D2 = a, D4 = a) ──

  test('UX AC1 — invalid_client renders the "isn\'t registered" copy and no Retry button', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_client' }),
      });
    });

    await navigateToCallback(page);

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/isn't registered/i, { timeout: 5_000 });
    await expect(alert).toHaveAttribute('data-auth-error-class', 'config');
    await expect(page.getByRole('button', { name: /retry sign in/i })).toHaveCount(0);
  });

  test('UX AC2 — invalid_grant renders the expired-link copy with a Retry button', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant' }),
      });
    });

    await navigateToCallback(page);

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/sign.?in.*again/i, { timeout: 5_000 });
    await expect(alert).toHaveAttribute('data-auth-error-class', 'expired-code');
    await expect(page.getByRole('button', { name: /retry sign in/i })).toBeVisible();
  });

  test('UX AC3 — transient 5xx renders the retry copy and the Retry button', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'down' });
    });

    await navigateToCallback(page);

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/temporarily unavailable/i, { timeout: 5_000 });
    await expect(alert).toHaveAttribute('data-auth-error-class', 'transient');
    await expect(page.getByRole('button', { name: /retry sign in/i })).toBeVisible();
  });

  test('UX AC4 — network error renders "could not contact" copy and the Retry button', async ({ page }) => {
    await stubTokenEndpoint(page, async (route) => {
      await route.abort('failed');
    });

    await navigateToCallback(page);

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/could not contact intervals\.icu/i, { timeout: 5_000 });
    await expect(alert).toHaveAttribute('data-auth-error-class', 'network');
    await expect(page.getByRole('button', { name: /retry sign in/i })).toBeVisible();
  });

  test('UX AC5 — CSRF state-mismatch renders the "login session expired" copy and no Retry button', async ({ page }) => {
    // No token endpoint stub needed — the request never leaves the browser.
    await page.goto('./?code=any&state=tampered-state');

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/login session expired/i, { timeout: 5_000 });
    await expect(alert).toHaveAttribute('data-auth-error-class', 'csrf');
    await expect(page.getByRole('button', { name: /retry sign in/i })).toHaveCount(0);
  });
});
