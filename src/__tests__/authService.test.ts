import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../utils/pkce';
import { AuthService } from '../services/authService';

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

    it('includes properly encoded scopes in the authorization URL', async () => {
      await service.startLogin();
      const url = window.location.href;
      expect(url).toContain(
        'scope=ACTIVITY%3AWRITE%20WELLNESS%3AREAD%20SETTINGS%3AWRITE%20CALENDAR%3AWRITE%20LIBRARY%3AREAD',
      );
      expect(url).not.toContain('scope=ACTIVITY%3AWRITE+WELLNESS%3AREAD');
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
    });

    it('clears callback storage on state mismatch', async () => {
      await service.handleCallback('code', 'wrong-state');
      expect(sessionStorage.getItem('vr_auth_state')).toBeNull();
      expect(sessionStorage.getItem('vr_auth_code_verifier')).toBeNull();
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

    it('returns false on token endpoint error', async () => {
      sessionStorage.setItem('vr_auth_refresh_token', 'stale-refresh');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }));
      const result = await service.refreshAccessToken();
      expect(result).toBe(false);
    });
  });
});
