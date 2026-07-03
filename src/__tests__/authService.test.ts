import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../utils/pkce';
import { AuthService, PROXY_BASE, ICU_PROFILE_PATH } from '../services/authService';

// ─── PKCE helpers ────────────────────────────────────────────────────────────

describe('generateCodeVerifier', () => {
  it('returns a non-empty string', () => {
    expect(generateCodeVerifier().length).toBeGreaterThan(0);
  });

  it('returns a base64url-safe string (no +, /, = chars)', () => {
    const v = generateCodeVerifier();
    expect(v).not.toMatch(/[+/=]/);
  });

  it('returns different values on each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generateCodeChallenge', () => {
  it('returns a base64url-safe string', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).not.toMatch(/[+/=]/);
    expect(challenge.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same verifier', async () => {
    const verifier = 'test-verifier-abc123';
    const a = await generateCodeChallenge(verifier);
    const b = await generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it('differs from the plain verifier', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
  });
});

describe('generateState', () => {
  it('returns a non-empty string', () => {
    expect(generateState().length).toBeGreaterThan(0);
  });

  it('returns different values on each call', () => {
    expect(generateState()).not.toBe(generateState());
  });
});

// ─── AuthService ──────────────────────────────────────────────────────────────

// Suppress console errors/warns in these tests
const consoleSpy = {
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    // Use vi.stubEnv so import.meta.env.VITE_INTERVALS_CLIENT_ID resolves in tests
    vi.stubEnv('VITE_INTERVALS_CLIENT_ID', 'test-client-id');

    // Use the real jsdom sessionStorage; clear it between tests
    sessionStorage.clear();

    // Stub location.href setter to prevent actual navigation
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
      configurable: true,
    });

    service = new AuthService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    sessionStorage.clear();
    consoleSpy.error.mockClear();
    consoleSpy.warn.mockClear();
  });

  describe('initial state', () => {
    it('is not authenticated on fresh init', () => {
      expect(service.isAuthenticated).toBe(false);
      expect(service.getUser()).toBeNull();
      expect(service.getAccessToken()).toBeNull();
    });
  });

  describe('startLogin', () => {
    it('sets code_verifier and state in sessionStorage', async () => {
      await service.startLogin();
      expect(sessionStorage.getItem('vr_auth_code_verifier')).toBeTruthy();
      expect(sessionStorage.getItem('vr_auth_state')).toBeTruthy();
    });

    it('navigates to intervals.icu authorize URL', async () => {
      await service.startLogin();
      expect(window.location.href).toContain('intervals.icu/oauth/authorize');
    });

    it('includes PKCE parameters in the URL', async () => {
      await service.startLogin();
      const url = window.location.href;
      expect(url).toContain('scope=');
      expect(url).toContain('code_challenge=');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('response_type=code');
    });

    it('includes comma-separated scopes in the authorization URL', async () => {
      await service.startLogin();
      const url = window.location.href;
      const parsedUrl = new URL(url);
      const scope = parsedUrl.searchParams.get('scope');
      expect(scope).toBe('ACTIVITY:WRITE,WELLNESS:READ,SETTINGS:WRITE,CALENDAR:WRITE,LIBRARY:READ');
    });

    it('does not percent-encode colons in scope tokens (intervals.icu requires literal colons)', async () => {
      await service.startLogin();
      const url = window.location.href;
      // Verify the raw URL string contains the full scope with unencoded colons and commas.
      // searchParams.get() would silently decode %3A, so we check the raw string.
      expect(url).toContain('scope=ACTIVITY:WRITE,WELLNESS:READ,SETTINGS:WRITE,CALENDAR:WRITE,LIBRARY:READ');
    });
  });

  describe('handleCallback', () => {
    const mockUser = { id: 'i123', name: 'Test Rower', email: 'test@example.com' };
    const mockTokenResponse = {
      access_token: 'access-abc',
      refresh_token: 'refresh-xyz',
      expires_in: 3600,
      token_type: 'Bearer',
      athlete_id: 'i123',
    };

    beforeEach(() => {
      sessionStorage.setItem('vr_auth_state', 'valid-state');
      sessionStorage.setItem('vr_auth_code_verifier', 'valid-verifier');
    });

    it('returns null when state does not match (CSRF protection)', async () => {
      const result = await service.handleCallback('code-123', 'tampered-state');
      expect(result).toBeNull();
    });

    it('returns null when code verifier is missing', async () => {
      sessionStorage.removeItem('vr_auth_code_verifier');
      const result = await service.handleCallback('code-123', 'valid-state');
      expect(result).toBeNull();
    });

    it('exchanges code and returns user on success', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockUser),
        }),
      );

      const result = await service.handleCallback('auth-code', 'valid-state');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('i123');
      expect(result?.name).toBe('Test Rower');
    });

    it('requests the athlete-specific profile endpoint when the token response includes athlete id', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockUser),
        });
      vi.stubGlobal('fetch', fetchMock);

      await service.handleCallback('auth-code', 'valid-state');

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${PROXY_BASE}${ICU_PROFILE_PATH}/i123`,
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('passes client_id to the proxy URL during token exchange', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockUser),
        });
      vi.stubGlobal('fetch', fetchMock);

      await service.handleCallback('auth-code', 'valid-state');

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `${PROXY_BASE}/api/oauth/token?client_id=test-client-id`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.stringContaining('client_id=test-client-id'),
        }),
      );
    });

    it('returns null when the token response omits athlete id (intervals.icu requires an ID in the profile path)', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'access-abc',
            refresh_token: 'refresh-xyz',
            expires_in: 3600,
            token_type: 'Bearer',
            // No athlete_id field — intervals.icu GET /api/v1/athlete (no ID) returns 405
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      // Without an athlete ID we cannot construct a valid profile path
      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not load your intervals.icu profile');
      // Only the token exchange fetch should have been made (no profile fetch)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the current-athlete profile endpoint when the athlete-specific endpoint fails', async () => {
      // When the token returns a numeric athlete_id (e.g. from intervals.icu), the code
      // first tries /api/v1/athlete/{numericId} and then the i-prefixed variant on 404.
      const numericTokenResponse = {
        access_token: 'access-abc',
        refresh_token: 'refresh-xyz',
        expires_in: 3600,
        token_type: 'Bearer',
        athlete_id: 123, // numeric as returned by intervals.icu
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(numericTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404, // numeric path /api/v1/athlete/123 returns 404
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i123',
            firstname: 'Fallback',
            lastname: 'Current Athlete',
            email: 'fallback-current@example.com',
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.name).toBe('Fallback Current Athlete');
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${PROXY_BASE}${ICU_PROFILE_PATH}/123`,
        expect.any(Object),
      );
      // Falls back to the i-prefixed path on 404 from the numeric path
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        `${PROXY_BASE}${ICU_PROFILE_PATH}/i123`,
        expect.any(Object),
      );
    });

    it('falls back to email when the profile has no display name', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'access-abc',
            refresh_token: 'refresh-xyz',
            expires_in: 3600,
            token_type: 'Bearer',
            athlete_id: 'i1000',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i1000',
            email: 'email-only@example.com',
          }),
        }),
      );

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.name).toBe('email-only@example.com');
      expect(result?.id).toBe('i1000');
    });

    it('builds the profile name from snake_case fields returned by intervals.icu', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'access-abc',
            refresh_token: 'refresh-xyz',
            expires_in: 3600,
            token_type: 'Bearer',
            athlete_id: 'i1002',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i1002',
            first_name: 'Snake',
            last_name: 'Case',
            email: 'snake@example.com',
          }),
        }),
      );

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.name).toBe('Snake Case');
      expect(result?.id).toBe('i1002');
    });

    it('falls back to athlete id when the profile has no name or email', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'access-abc',
            refresh_token: 'refresh-xyz',
            expires_in: 3600,
            token_type: 'Bearer',
            athlete_id: 'i1001',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i1001',
          }),
        }),
      );

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.name).toBe('Athlete i1001');
      expect(result?.id).toBe('i1001');
    });

    it('sets isAuthenticated after successful callback', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockTokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockUser) }),
      );

      await service.handleCallback('auth-code', 'valid-state');
      expect(service.isAuthenticated).toBe(true);
      expect(service.getAccessToken()).toBe('access-abc');
    });

    it('stores refresh token in sessionStorage', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockTokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockUser) }),
      );

      await service.handleCallback('auth-code', 'valid-state');
      expect(sessionStorage.getItem('vr_auth_refresh_token')).toBe('refresh-xyz');
    });

    it('returns null when token exchange fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400 }));
      const result = await service.handleCallback('bad-code', 'valid-state');
      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not exchange your intervals.icu authorization code');
    });

    it('clears callback storage on state mismatch', async () => {
      await service.handleCallback('code', 'wrong-state');
      expect(sessionStorage.getItem('vr_auth_state')).toBeNull();
      expect(sessionStorage.getItem('vr_auth_code_verifier')).toBeNull();
    });

    it('stores a user-facing error when the profile fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        }),
      );

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not load your intervals.icu profile');
    });
  });

  // ─── Profile endpoint interactions ───────────────────────────────────────────
  // These tests verify the precise HTTP behaviour between VirtualRow and the
  // intervals.icu athlete profile endpoints accessed through the CORS proxy.

  describe('profile endpoint interactions', () => {
    const tokenResponse = {
      access_token: 'tok-access',
      refresh_token: 'tok-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      athlete_id: 'i777',
    };
    const athleteProfile = { id: 'i777', firstname: 'Jane', lastname: 'Rower', email: 'jane@example.com' };

    beforeEach(() => {
      sessionStorage.setItem('vr_auth_state', 'valid-state');
      sessionStorage.setItem('vr_auth_code_verifier', 'valid-verifier');
    });

    it('fetches athlete-specific profile at /proxy/api/v1/athlete/{id} with Authorization header', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(athleteProfile) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).not.toBeNull();
      const [profileUrl, profileInit] = fetchMock.mock.calls[1];
      // URL: must target the athlete-specific proxy path
      expect(profileUrl).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/i777`);
      // Authorization header must be present and constructed by authService.
      expect((profileInit as RequestInit).headers).toMatchObject({
        Authorization: expect.any(String),
      });
      expect((profileInit as RequestInit).headers as Record<string, string>).not.toHaveProperty('Authorization', '');
    });

    it('returns null without making a profile request when no athlete_id in token (intervals.icu /api/v1/athlete without ID returns 405)', async () => {
      const tokenNoId = {
        access_token: 'tok-generic',
        refresh_token: 'tok-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        // No athlete_id — GET /api/v1/athlete (no ID) returns 405 from intervals.icu
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenNoId) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      // Must fail gracefully without attempting the 405-returning no-ID endpoint
      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not load your intervals.icu profile');
      // Only the token exchange fetch — no profile fetch should be attempted
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fetches numeric athlete_id path then i-prefixed path on 404 (intervals.icu token returns numeric id)', async () => {
      // intervals.icu token response returns athlete_id as a number (e.g. 777).
      // The REST API uses the 'i'-prefixed form for internal athletes (i777).
      const tokenNumericId = { ...tokenResponse, athlete_id: 777 };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenNumericId) })
        .mockResolvedValueOnce({ ok: false, status: 404 }) // /api/v1/athlete/777 → 404
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(athleteProfile) }); // /api/v1/athlete/i777 → 200
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('i777');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/777`);
      expect(fetchMock.mock.calls[2][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/i777`);
    });

    it('succeeds immediately with numeric athlete_id when numeric path works', async () => {
      const tokenNumericId = { ...tokenResponse, athlete_id: 777 };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenNumericId) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(athleteProfile) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/777`);
    });

    it('does NOT fall back to /proxy/api/v1/athlete when athlete-specific endpoint returns 405', async () => {
      // Only a 404 triggers the fallback; any other error (including 405 Method Not Allowed)
      // should fail immediately without a second profile request.
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        .mockResolvedValueOnce({ ok: false, status: 405 });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).toBeNull();
      // Only two fetches: token exchange + one profile attempt (no fallback)
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(service.getLastError()).toContain('could not load your intervals.icu profile');
    });

    it('falls back to i-prefixed path only on 404 from the numeric athlete-specific endpoint', async () => {
      const tokenNumericId = { ...tokenResponse, athlete_id: 777 };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenNumericId) })
        .mockResolvedValueOnce({ ok: false, status: 404 }) // numeric path returns 404
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'i777', firstname: 'Jane', email: 'jane@example.com' }) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/777`);
      expect(fetchMock.mock.calls[2][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/i777`);
    });

    it('returns null when both numeric and i-prefixed paths fail', async () => {
      const tokenNumericId = { ...tokenResponse, athlete_id: 777 };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenNumericId) })
        .mockResolvedValueOnce({ ok: false, status: 404 }) // numeric path → 404
        .mockResolvedValueOnce({ ok: false, status: 404 }); // i-prefixed path → 404
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not load your intervals.icu profile');
    });

    it('surfaces auth error message on 401 from athlete profile endpoint', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        .mockResolvedValueOnce({ ok: false, status: 401 });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).toBeNull();
      expect(service.getLastError()).toContain('not authorized');
    });

    it('returns null when profile response body is missing the id field', async () => {
      // Simulate a response body with no `id` field.
      const noIdProfile = { firstname: 'Ghost', email: 'ghost@example.com' };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(noIdProfile) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not load your intervals.icu profile');
    });
  });

  describe('logout', () => {
    it('clears authentication state', async () => {
      // Set up a logged-in state
      sessionStorage.setItem('vr_auth_refresh_token', 'refresh-xyz');
      sessionStorage.setItem('vr_auth_user', JSON.stringify({ id: 'i123', name: 'Test' }));
      sessionStorage.setItem('vr_auth_athlete_id', 'i123');

      service.logout();

      expect(service.isAuthenticated).toBe(false);
      expect(service.getUser()).toBeNull();
      expect(service.getAccessToken()).toBeNull();
      expect(sessionStorage.getItem('vr_auth_refresh_token')).toBeNull();
    });
  });

  describe('refreshAccessToken', () => {
    it('returns false when no refresh token is stored', async () => {
      const result = await service.refreshAccessToken();
      expect(result).toBe(false);
    });

    it('returns true and updates access token on success', async () => {
      sessionStorage.setItem('vr_auth_refresh_token', 'old-refresh');
      sessionStorage.setItem('vr_auth_athlete_id', 'i123');
      sessionStorage.setItem('vr_auth_user', JSON.stringify({ id: 'i123', name: 'Tester', email: '' }));

      // Stub fetch before constructing so the restore-session refresh is served
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      }));

      // Reconstruct service so it restores session and calls refreshAccessToken
      service = new AuthService();
      // Wait for the async restore-session refresh to finish
      await new Promise(r => setTimeout(r, 0));

      const result = await service.refreshAccessToken();
      expect(result).toBe(true);
    });

    it('passes client_id to the proxy URL during token refresh', async () => {
      sessionStorage.setItem('vr_auth_refresh_token', 'stale-refresh');

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          athlete_id: 'i123',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.refreshAccessToken();

      expect(fetchMock).toHaveBeenCalledWith(
        `${PROXY_BASE}/api/oauth/token?client_id=test-client-id`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.stringContaining('client_id=test-client-id'),
        }),
      );
    });

    it('returns false on token endpoint error', async () => {
      sessionStorage.setItem('vr_auth_refresh_token', 'stale-refresh');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }));
      const result = await service.refreshAccessToken();
      expect(result).toBe(false);
    });
  });
});
