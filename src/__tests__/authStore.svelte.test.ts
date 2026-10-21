import { describe, it, expect, vi, afterEach } from 'vitest';

import { AuthStore } from '../lib/ui/auth.svelte';
import type { AuthPort } from '../lib/ports';
import type { AuthUser } from '../lib/types/index';
import type { AuthErrorClass } from '../lib/services/authService';

const USER: AuthUser = { id: 'u1', name: 'Dana Rower', email: 'dana@example.com' };

function stubAuth(over: Partial<AuthPort> = {}): AuthPort {
  return {
    getUser: vi.fn(() => null),
    startLogin: vi.fn(async () => {}),
    handleCallback: vi.fn(async () => null),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => null),
    getLastError: vi.fn(() => null),
    getLastErrorClass: vi.fn(() => null),
    refreshAccessToken: vi.fn(async () => false),
    scheduleRefresh: vi.fn(),
    isAuthenticated: vi.fn(() => false),
    ...over,
  } as unknown as AuthPort;
}

function setUrl(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

// #542 P1 (F3): the AuthStore runes port of AuthProvider/useAuth.
describe('AuthStore', () => {
  afterEach(() => setUrl(''));

  it('seeds the user from the service on construction', () => {
    const store = new AuthStore(stubAuth({ getUser: vi.fn(() => USER) }));
    expect(store.user).toEqual(USER);
    expect(store.isAuthenticated).toBe(true);
  });

  it('init without OAuth params restores the service session', () => {
    setUrl('');
    const service = stubAuth({ getUser: vi.fn(() => USER) });
    const store = new AuthStore(service);
    store.user = null;
    store.init();
    expect(store.user).toEqual(USER);
    expect(service.handleCallback).not.toHaveBeenCalled();
  });

  it('init completes an OAuth callback and clears the query params', async () => {
    setUrl('?code=abc&state=xyz');
    const service = stubAuth({ handleCallback: vi.fn(async () => USER) });
    const store = new AuthStore(service);
    store.init();
    expect(store.isLoading).toBe(true);
    await vi.waitFor(() => expect(store.isLoading).toBe(false));
    expect(service.handleCallback).toHaveBeenCalledWith('abc', 'xyz');
    expect(store.user).toEqual(USER);
    expect(window.location.search).toBe('');
  });

  it('init surfaces a classified error when the callback returns no user', async () => {
    setUrl('?code=abc&state=xyz');
    const service = stubAuth({
      handleCallback: vi.fn(async () => null),
      getLastError: vi.fn(() => 'network blip'),
      getLastErrorClass: vi.fn((): AuthErrorClass => 'network'),
    });
    const store = new AuthStore(service);
    store.init();
    await vi.waitFor(() => expect(store.isLoading).toBe(false));
    expect(store.authError).toBe('network blip');
    expect(store.authErrorClass).toBe('network');
    expect(store.user).toBeNull();
  });

  it('init falls back to the unknown class when the callback throws', async () => {
    setUrl('?code=abc&state=xyz');
    const service = stubAuth({
      handleCallback: vi.fn(async () => {
        throw new Error('engine boom');
      }),
    });
    const store = new AuthStore(service);
    store.init();
    await vi.waitFor(() => expect(store.isLoading).toBe(false));
    expect(store.authError).toBe('engine boom');
    expect(store.authErrorClass).toBe('unknown');
  });

  it('login clears errors and starts the OAuth flow', async () => {
    const service = stubAuth();
    const store = new AuthStore(service);
    store.authError = 'old';
    store.authErrorClass = 'config';
    await store.login();
    expect(store.authError).toBeNull();
    expect(store.authErrorClass).toBeNull();
    expect(service.startLogin).toHaveBeenCalledTimes(1);
  });

  it('logout clears the user, errors and pending action', () => {
    const service = stubAuth({ getUser: vi.fn(() => USER) });
    const store = new AuthStore(service);
    store.authError = 'x';
    store.setPendingAction('start-workout');
    store.logout();
    expect(service.logout).toHaveBeenCalledTimes(1);
    expect(store.user).toBeNull();
    expect(store.authError).toBeNull();
    expect(store.pendingAction).toBeNull();
  });

  it('clearAuthError resets both error fields', () => {
    const store = new AuthStore(stubAuth());
    store.authError = 'x';
    store.authErrorClass = 'transient';
    store.clearAuthError();
    expect(store.authError).toBeNull();
    expect(store.authErrorClass).toBeNull();
  });
});
