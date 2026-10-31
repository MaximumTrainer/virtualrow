import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../lib/utils/pkce';
import {
  AuthService,
  PROXY_BASE,
  ICU_PROFILE_PATH,
  classifyExchangeFailure,
  messageForClass,
  RETRYABLE_AUTH_ERROR_CLASSES,
} from '../lib/services/authService';
import { crashReporterService } from '../lib/services/crashReporterService';
import type { CrashPayload } from '../lib/types/crashPayload';

const AUTH_COOKIE_NAME = 'vr_auth_session';
const AUTH_SESSION_KEY = 'vr_auth_session_key';
const AUTH_COOKIE_TTL_MS = 2 * 60 * 60 * 1000;

function getCookieValue(name: string): string | null {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

async function readAuthCookiePayload() {
  const encrypted = getCookieValue(AUTH_COOKIE_NAME);
  const keyMaterial = sessionStorage.getItem(AUTH_SESSION_KEY);
  if (!encrypted || !keyMaterial) return null;

  const [encodedIv, encodedCiphertext] = encrypted.split('.');
  if (!encodedIv || !encodedCiphertext) return null;

  const decodeBase64Url = (value: string) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyMaterial));
  const key = await crypto.subtle.importKey('raw', hashed, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64Url(encodedIv) },
    key,
    decodeBase64Url(encodedCiphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as { athleteId: string; expiresAt: number; user: { id: string; name: string } };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

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

// ─── Classifier + messages (#486 Phase 2 FR2) ────────────────────────────────

describe('classifyExchangeFailure (#486 Phase 2 FR2)', () => {
  it('maps invalid_client to config regardless of status', () => {
    expect(classifyExchangeFailure(400, 'invalid_client')).toBe('config');
    expect(classifyExchangeFailure(401, 'invalid_client')).toBe('config');
  });

  it('maps invalid_grant to expired-code (AC2 — H3)', () => {
    expect(classifyExchangeFailure(401, 'invalid_grant')).toBe('expired-code');
    expect(classifyExchangeFailure(400, 'invalid_grant')).toBe('expired-code');
  });

  it('maps 5xx and 408/429 to transient (AC3)', () => {
    expect(classifyExchangeFailure(500, null)).toBe('transient');
    expect(classifyExchangeFailure(502, 'anything')).toBe('transient'); // 5xx wins over an unknown code
    expect(classifyExchangeFailure(503, null)).toBe('transient');
    expect(classifyExchangeFailure(408, null)).toBe('transient');
    expect(classifyExchangeFailure(429, null)).toBe('transient');
  });

  it('maps a 400/401 with no OAuth code to unknown', () => {
    expect(classifyExchangeFailure(400, null)).toBe('unknown');
    expect(classifyExchangeFailure(401, null)).toBe('unknown');
    expect(classifyExchangeFailure(403, null)).toBe('unknown');
  });

  it('wins invalid_grant over 5xx when both appear (upstream wrapped in 500)', () => {
    // Realistic shape: proxy forwards a 500 with the body preserving the OAuth
    // code. The OAuth semantics still decide the UX.
    expect(classifyExchangeFailure(500, 'invalid_grant')).toBe('expired-code');
  });
});

describe('messageForClass (#486 Phase 2 FR2)', () => {
  it('config is NOT retryable so the copy does not promise a retry', () => {
    expect(RETRYABLE_AUTH_ERROR_CLASSES.has('config')).toBe(false);
    expect(messageForClass('config')).toMatch(/isn't registered/i);
    expect(messageForClass('config')).not.toMatch(/\bretry\b/i);
  });

  it('every other class is retryable', () => {
    for (const klass of ['transient', 'expired-code', 'network', 'unknown'] as const) {
      expect(RETRYABLE_AUTH_ERROR_CLASSES.has(klass)).toBe(true);
    }
  });

  it('expired-code copy tells the user to sign in again (AC2)', () => {
    expect(messageForClass('expired-code')).toMatch(/sign.?in.*again|sign in again/i);
  });

  it('unknown falls back to the exact wording Phase 1 displayed, so Dan can still identify this bug', () => {
    expect(messageForClass('unknown')).toContain('could not exchange your intervals.icu authorization code');
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
    document.cookie = `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/`;

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
    document.cookie = `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/`;
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

    it('maps the profile sex field to the user gender (drives the rower model)', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockTokenResponse) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ...mockUser, sex: 'F' }),
        }),
      );

      const result = await service.handleCallback('auth-code', 'valid-state');
      expect(result?.gender).toBe('female');
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

    it('falls back to the current-athlete profile endpoint when the token response omits athlete id', async () => {
      const fallbackProfile = {
        id: 'i123',
        firstname: 'Current',
        lastname: 'Athlete',
        email: 'current@example.com',
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'access-abc',
            refresh_token: 'refresh-xyz',
            expires_in: 3600,
            token_type: 'Bearer',
            // No athlete_id field — use /api/v1/athlete/0 for the current OAuth athlete.
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fallbackProfile),
        });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.id).toBe('i123');
      expect(result?.name).toBe('Current Athlete');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${PROXY_BASE}${ICU_PROFILE_PATH}/0`,
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
      );
      expect(service.getLastError()).toBeNull();
    });

    it('falls back to the i-prefixed athlete-specific profile endpoint when the numeric athlete-specific endpoint returns 404', async () => {
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

    it('stores user snapshot in sessionStorage for synchronous restore', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockTokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockUser) }),
      );

      await service.handleCallback('auth-code', 'valid-state');
      const stored = sessionStorage.getItem('vr_auth_user');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.id).toBe('i123');
      expect(parsed.name).toBe(mockUser.name);
    });

    it('returns null when token exchange fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400 }));
      const result = await service.handleCallback('bad-code', 'valid-state');
      expect(result).toBeNull();
      expect(service.getLastError()).toContain('could not exchange your intervals.icu authorization code');
    });

    // ─── OAuth failure crash capture (#486 FR1) ──────────────────────────────
    describe('OAuth failure capture (#486 FR1)', () => {
      let reportSpy: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        reportSpy = vi
          .spyOn(crashReporterService, 'reportCrash')
          .mockResolvedValue({ submitted: true }) as unknown as ReturnType<typeof vi.fn>;
      });

      /** The CrashPayload fragment the latest reportCrash call was made with. */
      const lastPayload = (): Partial<CrashPayload> => {
        const last = reportSpy.mock.calls.at(-1);
        if (!last) throw new Error('reportCrash was not called');
        return last[0] as Partial<CrashPayload>;
      };

      it('reports oauth-token-exchange with the proxy status and body error code (AC1 — H2)', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValueOnce({
            ok: false,
            status: 401,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ error: 'invalid_client' }),
          }),
        );

        await service.handleCallback('bad-code', 'valid-state');

        expect(reportSpy).toHaveBeenCalledTimes(1);
        const payload = lastPayload();
        expect(payload.kind).toBe('oauth-token-exchange');
        expect(payload.authFailure).toEqual({
          status: 401,
          errorCode: 'invalid_client',
          errorDescription: null,
          networkError: false,
        });
      });

      it('reports oauth-token-exchange invalid_grant for a replayed code (AC2 — H3)', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValueOnce({
            ok: false,
            status: 401,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'already used' }),
          }),
        );

        await service.handleCallback('used-code', 'valid-state');

        const payload = lastPayload();
        expect(payload.authFailure?.errorCode).toBe('invalid_grant');
        expect(payload.authFailure?.errorDescription).toBe('already used');
      });

      it('reports networkError when fetch throws (AC4)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('CORS blocked')));

        await service.handleCallback('any-code', 'valid-state');

        const payload = lastPayload();
        expect(payload.kind).toBe('oauth-token-exchange');
        expect(payload.authFailure).toEqual({
          status: null,
          errorCode: null,
          errorDescription: null,
          networkError: true,
        });
      });

      it('reports oauth-profile-fetch when the profile 401s after a successful exchange', async () => {
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockResolvedValueOnce({
              ok: true,
              json: () => Promise.resolve(mockTokenResponse),
            })
            .mockResolvedValueOnce({
              ok: false,
              status: 401,
              headers: { get: () => 'application/json' },
              json: () => Promise.resolve({ error: 'unauthorized' }),
            }),
        );

        await service.handleCallback('auth-code', 'valid-state');

        const payload = lastPayload();
        expect(payload.kind).toBe('oauth-profile-fetch');
        expect(payload.authFailure).toEqual({
          status: 401,
          errorCode: 'unauthorized',
          errorDescription: null,
          networkError: false,
        });
      });

      it('does not include code / code_verifier / access_token in the serialised payload (NFR1 / AC6)', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValueOnce({
            ok: false,
            status: 500,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ error: 'server_error' }),
          }),
        );

        await service.handleCallback('secret-code-abc', 'valid-state');

        const serialised = JSON.stringify(reportSpy.mock.calls.at(-1));
        for (const forbidden of ['secret-code-abc', 'valid-verifier', 'access_token', 'refresh_token']) {
          expect(serialised).not.toContain(forbidden);
        }
      });

      it('skips capture on CSRF state-mismatch — those are not server failures', async () => {
        await service.handleCallback('code', 'wrong-state');
        expect(reportSpy).not.toHaveBeenCalled();
      });

      it('sets lastErrorClass to config for invalid_client (AC1 — H2)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ error: 'invalid_client' }),
        }));
        await service.handleCallback('bad-code', 'valid-state');
        expect(service.getLastErrorClass()).toBe('config');
      });

      it('sets lastErrorClass to expired-code for invalid_grant (AC2)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ error: 'invalid_grant' }),
        }));
        await service.handleCallback('used-code', 'valid-state');
        expect(service.getLastErrorClass()).toBe('expired-code');
      });

      it('sets lastErrorClass to transient for 5xx (AC3)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: { get: () => 'text/plain' },
        }));
        await service.handleCallback('any-code', 'valid-state');
        expect(service.getLastErrorClass()).toBe('transient');
      });

      it('sets lastErrorClass to network for a fetch throw (AC4)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('CORS')));
        await service.handleCallback('any-code', 'valid-state');
        expect(service.getLastErrorClass()).toBe('network');
      });

      it('sets lastErrorClass to csrf on state mismatch (AC5)', async () => {
        await service.handleCallback('code', 'wrong-state');
        expect(service.getLastErrorClass()).toBe('csrf');
      });

      it('clears lastErrorClass on logout', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('CORS')));
        await service.handleCallback('any-code', 'valid-state');
        expect(service.getLastErrorClass()).not.toBeNull();
        service.logout();
        expect(service.getLastErrorClass()).toBeNull();
      });

      it('does not throw when the reporter itself rejects (NFR2)', async () => {
        reportSpy.mockRejectedValueOnce(new Error('reporter boom'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => 'text/html' } }));

        await expect(service.handleCallback('code', 'valid-state')).resolves.toBeNull();
      });
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

    it('fetches /proxy/api/v1/athlete/0 when no athlete_id is present in the token response', async () => {
      const tokenNoId = {
        access_token: 'tok-generic',
        refresh_token: 'tok-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        // No athlete_id — /api/v1/athlete/0 resolves the current OAuth athlete.
      };
      const currentAthleteProfile = {
        id: 'i777',
        firstname: 'Current',
        lastname: 'Rower',
        email: 'current-rower@example.com',
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenNoId) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(currentAthleteProfile) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.id).toBe('i777');
      expect(result?.name).toBe('Current Rower');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/0`);
      expect(service.getLastError()).toBeNull();
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

  // ─── End-to-end login verification ───────────────────────────────────────────
  // Focused tests that verify the full login flow succeeds and the athlete ID is
  // returned from the intervals.icu request and is correctly persisted.
  // These reproduce the production login scenario reported by the user and
  // guard against regressions of the "Sign-in failed: VirtualRow could not
  // load your intervals.icu profile" error path.

  describe('login end-to-end verification', () => {
    beforeEach(() => {
      sessionStorage.setItem('vr_auth_state', 'valid-state');
      sessionStorage.setItem('vr_auth_code_verifier', 'valid-verifier');
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('login returns a user whose id matches the athlete_id returned by the intervals.icu token endpoint (i-prefixed)', async () => {
      const returnedAthleteId = 'i98765';
      const tokenResponse = {
        access_token: 'access-token-e2e',
        refresh_token: 'refresh-token-e2e',
        expires_in: 3600,
        token_type: 'Bearer',
        athlete_id: returnedAthleteId,
      };
      const profileResponse = {
        id: returnedAthleteId,
        firstname: 'Verified',
        lastname: 'Rower',
        email: 'verified@example.com',
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(profileResponse) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      // The login must succeed and return a user
      expect(result).not.toBeNull();
      // The user's id must match the athlete_id from the token response
      expect(result?.id).toBe(returnedAthleteId);
      // The service must be authenticated with the returned access token
      expect(service.isAuthenticated).toBe(true);
      expect(service.getAccessToken()).toBe(tokenResponse.access_token);
      const cookiePayload = await readAuthCookiePayload();
      expect(cookiePayload?.athleteId).toBe(returnedAthleteId);
      expect(cookiePayload?.user.id).toBe(returnedAthleteId);
      expect(cookiePayload?.expiresAt).toBeGreaterThan(Date.now());
      // The profile request URL must include the athlete_id — verifying the
      // token → profile handoff worked end-to-end
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/${returnedAthleteId}`);
      // No user-facing error must be set
      expect(service.getLastError()).toBeNull();
    });

    it('login returns a user whose id matches the athlete_id returned by the intervals.icu token endpoint (numeric → i-prefix fallback)', async () => {
      // intervals.icu returns athlete_id as a numeric integer; the profile REST
      // API requires an i-prefixed form for internal athletes.
      const numericAthleteId = 98765;
      const iPrefixedAthleteId = 'i98765';
      const tokenResponse = {
        access_token: 'access-token-e2e-numeric',
        refresh_token: 'refresh-token-e2e-numeric',
        expires_in: 3600,
        token_type: 'Bearer',
        athlete_id: numericAthleteId,
      };
      const profileResponse = {
        id: iPrefixedAthleteId,
        firstname: 'Numeric',
        lastname: 'Athlete',
        email: 'numeric@example.com',
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        // /api/v1/athlete/98765 → 404 (numeric path not accepted for internal athletes)
        .mockResolvedValueOnce({ ok: false, status: 404 })
        // /api/v1/athlete/i98765 → 200 (i-prefixed path succeeds)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(profileResponse) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      // Login succeeds despite the intermediate 404
      expect(result).not.toBeNull();
      // The resolved user id is the i-prefixed id returned by the successful profile call
      expect(result?.id).toBe(iPrefixedAthleteId);
      expect(service.isAuthenticated).toBe(true);
      const cookiePayload = await readAuthCookiePayload();
      expect(cookiePayload?.athleteId).toBe(iPrefixedAthleteId);
      expect(cookiePayload?.user.id).toBe(iPrefixedAthleteId);
      // Verify the profile request sequence: first numeric, then i-prefixed
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/${numericAthleteId}`);
      expect(fetchMock.mock.calls[2][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/${iPrefixedAthleteId}`);
      expect(service.getLastError()).toBeNull();
    });

    it('login persists the canonical athlete id returned by /api/v1/athlete/0 when the token response omits athlete_id', async () => {
      const tokenResponse = {
        access_token: 'access-token-no-athlete',
        refresh_token: 'refresh-token-no-athlete',
        expires_in: 3600,
        token_type: 'Bearer',
        // No athlete_id / id — the client must resolve the current athlete via /athlete/0.
      };
      const resolvedAthleteId = 'i24680';
      const profileResponse = {
        id: resolvedAthleteId,
        firstname: 'Resolved',
        lastname: 'Athlete',
        email: 'resolved@example.com',
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tokenResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(profileResponse) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.handleCallback('auth-code', 'valid-state');

      expect(result?.id).toBe(resolvedAthleteId);
      expect(service.isAuthenticated).toBe(true);
      expect(service.getUser()?.id).toBe(resolvedAthleteId);
      const cookiePayload = await readAuthCookiePayload();
      expect(cookiePayload?.athleteId).toBe(resolvedAthleteId);
      expect(cookiePayload?.user.id).toBe(resolvedAthleteId);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_BASE}${ICU_PROFILE_PATH}/0`);
      expect(service.getLastError()).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears authentication state and encrypted auth cookie', async () => {
      sessionStorage.setItem('vr_auth_refresh_token', 'refresh-xyz');
      sessionStorage.setItem('vr_auth_session_key', 'test-session-key');
      sessionStorage.setItem('vr_auth_user', JSON.stringify({ id: 'i123', name: 'Test User', email: '' }));
      document.cookie = `${AUTH_COOKIE_NAME}=fake.encrypted.payload; Path=/`;

      service.logout();

      expect(service.isAuthenticated).toBe(false);
      expect(service.getUser()).toBeNull();
      expect(service.getAccessToken()).toBeNull();
      expect(sessionStorage.getItem('vr_auth_refresh_token')).toBeNull();
      expect(sessionStorage.getItem('vr_auth_user')).toBeNull();
      expect(getCookieValue(AUTH_COOKIE_NAME)).toBeNull();
    });
  });

  describe('refreshAccessToken', () => {
    it('returns false when no refresh token is stored', async () => {
      const result = await service.refreshAccessToken();
      expect(result).toBe(false);
    });

    it('returns true and updates access token on success', async () => {
      sessionStorage.setItem('vr_auth_refresh_token', 'old-refresh');

      // Stub fetch before constructing so the restore-session refresh is served
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          athlete_id: 'i123',
        }),
      }));

      // Seed encrypted cookie so restore-session can recover the user and refresh.
      sessionStorage.setItem('vr_auth_session_key', 'session-key-for-test');
      const now = Date.now();
      const payload = {
        user: { id: 'i123', name: 'Tester', email: '' },
        athleteId: 'i123',
        expiresAt: now + AUTH_COOKIE_TTL_MS,
      };
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('session-key-for-test'));
      const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify(payload)),
      );
      document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(
        `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`,
      )}; Path=/`;

      // Reconstruct service so it restores cookie session and calls refreshAccessToken.
      service = new AuthService();
      await vi.waitFor(() => {
        expect(service.getUser()?.id).toBe('i123');
      });

      const result = await service.refreshAccessToken();
      expect(result).toBe(true);
      expect(sessionStorage.getItem('vr_auth_refresh_token')).toBe('new-refresh');
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

  describe('cookie session restore', () => {
    it('refreshes encrypted cookie TTL when session is restored on reload', async () => {
      const sessionKey = 'restore-session-key';
      const originalExpiresAt = Date.now() + 30_000;
      const payload = {
        user: { id: 'i123', name: 'Reload User', email: 'reload@example.com' },
        athleteId: 'i123',
        expiresAt: originalExpiresAt,
      };

      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionKey));
      const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify(payload)),
      );

      sessionStorage.setItem(AUTH_SESSION_KEY, sessionKey);
      document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(
        `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`,
      )}; Path=/`;

      service = new AuthService();
      await vi.waitFor(async () => {
        const refreshed = await readAuthCookiePayload();
        expect((refreshed?.expiresAt ?? 0)).toBeGreaterThan(originalExpiresAt);
      }, { timeout: 500 });
      const refreshed = await readAuthCookiePayload();
      const now = Date.now();
      expect(refreshed?.user.name).toBe('Reload User');
      expect(refreshed?.expiresAt ?? 0).toBeGreaterThanOrEqual(now + AUTH_COOKIE_TTL_MS - 5_000);
      expect(refreshed?.expiresAt ?? 0).toBeLessThanOrEqual(now + AUTH_COOKIE_TTL_MS + 5_000);
    });

    it('restores user synchronously from sessionStorage snapshot on construction', () => {
      const snapshot = { id: 'i42', name: 'Sync User', email: 'sync@example.com' };
      sessionStorage.setItem('vr_auth_user', JSON.stringify(snapshot));

      service = new AuthService();

      // getUser() should return the snapshot synchronously, before any async work.
      expect(service.getUser()).toEqual(snapshot);
    });

    it('falls back to cookie restore when no sessionStorage snapshot exists', async () => {
      const sessionKey = 'fallback-key';
      const payload = {
        user: { id: 'i99', name: 'Cookie User', email: 'cookie@example.com' },
        athleteId: 'i99',
        expiresAt: Date.now() + 60_000,
      };

      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionKey));
      const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify(payload)),
      );

      sessionStorage.setItem(AUTH_SESSION_KEY, sessionKey);
      document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(
        `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`,
      )}; Path=/`;

      service = new AuthService();

      // No snapshot in sessionStorage; user should be null synchronously.
      expect(service.getUser()).toBeNull();

      // After async cookie restore, user should be populated.
      await vi.waitFor(() => {
        expect(service.getUser()?.name).toBe('Cookie User');
      }, { timeout: 500 });
    });
  });
});
