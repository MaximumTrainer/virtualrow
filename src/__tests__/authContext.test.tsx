import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import type { AuthUser } from '../types/index';

// Suppress console noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function TestConsumer() {
  const { user, isAuthenticated, isLoading, authError } = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user-name">{user?.name ?? 'null'}</span>
      <span data-testid="user-id">{user?.id ?? 'null'}</span>
      <span data-testid="auth-error">{authError ?? 'null'}</span>
    </div>
  );
}

function makeServiceStub(overrides: Partial<{
  getUser: () => AuthUser | null;
  handleCallback: (code: string, state: string) => Promise<AuthUser | null>;
  startLogin: () => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}> = {}) {
  return {
    getUser: vi.fn(() => null),
    startLogin: vi.fn(() => Promise.resolve()),
    handleCallback: vi.fn(() => Promise.resolve(null)),
    refreshAccessToken: vi.fn(() => Promise.resolve(false)),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => null),
    scheduleRefresh: vi.fn(),
    get isAuthenticated() { return false; },
    ...overrides,
  } as unknown as import('../services/authService').AuthService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthProvider', () => {
  let originalSearch = '';

  beforeEach(() => {
    originalSearch = window.location.search;
  });

  afterEach(() => {
    // Restore URL
    window.history.replaceState({}, '', window.location.pathname);
    vi.restoreAllMocks();
  });

  it('renders children with unauthenticated defaults', () => {
    const service = makeServiceStub();
    render(
      <AuthProvider service={service}>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('user-name').textContent).toBe('null');
  });

  it('shows the user from getUser() on initial render', () => {
    const user: AuthUser = { id: 'i1', name: 'Alice', email: 'alice@example.com' };
    const service = makeServiceStub({ getUser: () => user });
    render(
      <AuthProvider service={service}>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice');
  });

  it('completes OAuth callback when URL has code and state params', async () => {
    const callbackUser: AuthUser = { id: 'i2', name: 'Bob', email: 'bob@example.com' };
    const service = makeServiceStub({
      handleCallback: vi.fn(() => Promise.resolve(callbackUser)),
    });

    // Simulate callback URL
    window.history.replaceState({}, '', '/?code=auth-code&state=csrf-state');

    await act(async () => {
      render(
        <AuthProvider service={service}>
          <TestConsumer />
        </AuthProvider>
      );
      // Let the async handleCallback resolve
      await Promise.resolve();
    });

    expect(service.handleCallback).toHaveBeenCalledWith('auth-code', 'csrf-state');
    expect(screen.getByTestId('user-name').textContent).toBe('Bob');
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('auth-error').textContent).toBe('null');
  });

  it('strips code and state from URL after callback', async () => {
    const callbackUser: AuthUser = { id: 'i3', name: 'Carol', email: '' };
    const service = makeServiceStub({
      handleCallback: vi.fn(() => Promise.resolve(callbackUser)),
    });

    window.history.replaceState({}, '', '/?code=some-code&state=some-state&other=keep');

    await act(async () => {
      render(
        <AuthProvider service={service}>
          <TestConsumer />
        </AuthProvider>
      );
      await Promise.resolve();
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get('code')).toBeNull();
    expect(params.get('state')).toBeNull();
    expect(params.get('other')).toBe('keep');
  });

  it('stays unauthenticated when handleCallback returns null (bad state)', async () => {
    const service = makeServiceStub({
      handleCallback: vi.fn(() => Promise.resolve(null)),
    });

    window.history.replaceState({}, '', '/?code=bad-code&state=bad-state');

    await act(async () => {
      render(
        <AuthProvider service={service}>
          <TestConsumer />
        </AuthProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user-name').textContent).toBe('null');
    expect(screen.getByTestId('auth-error').textContent)
      .toContain('could not load your intervals.icu profile');
  });

  it('surfaces a retryable error when callback finalization throws', async () => {
    const service = makeServiceStub({
      handleCallback: vi.fn(() => Promise.reject('network down')),
    });

    window.history.replaceState({}, '', '/?code=bad-code&state=bad-state');

    await act(async () => {
      render(
        <AuthProvider service={service}>
          <TestConsumer />
        </AuthProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('auth-error').textContent)
      .toContain('Please retry');
  });

  it('transitions to authenticated state when callback resolves a fallback-profile user', async () => {
    const callbackUser: AuthUser = { id: 'i999', name: 'Fallback Rower', email: 'fallback@example.com' };
    const service = makeServiceStub({
      handleCallback: vi.fn(() => Promise.resolve(callbackUser)),
    });

    window.history.replaceState({}, '', '/?code=fallback-code&state=fallback-state');

    await act(async () => {
      render(
        <AuthProvider service={service}>
          <TestConsumer />
        </AuthProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-id').textContent).toBe('i999');
    expect(screen.getByTestId('auth-error').textContent).toBe('null');
  });

  it('clears user on logout', async () => {
    const user: AuthUser = { id: 'i4', name: 'Dave', email: '' };
    const logoutFn = vi.fn();
    const service = makeServiceStub({ getUser: () => user, logout: logoutFn });

    function LogoutConsumer() {
      const { logout, user: u, isAuthenticated } = useAuth();
      return (
        <div>
          <span data-testid="auth">{String(isAuthenticated)}</span>
          <button onClick={logout}>logout</button>
          <span data-testid="name">{u?.name ?? 'null'}</span>
        </div>
      );
    }

    render(
      <AuthProvider service={service}>
        <LogoutConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('auth').textContent).toBe('true');

    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click();
    });

    expect(logoutFn).toHaveBeenCalled();
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('name').textContent).toBe('null');
  });

  it('does not trigger callback when URL has no code/state', () => {
    const service = makeServiceStub({ handleCallback: vi.fn() });
    window.history.replaceState({}, '', '/');

    render(
      <AuthProvider service={service}>
        <TestConsumer />
      </AuthProvider>
    );

    expect(service.handleCallback).not.toHaveBeenCalled();
  });

  it('handles React 18 Strict Mode double mount without losing authentication', async () => {
    const callbackUser: AuthUser = { id: 'i5', name: 'Strict Mode User', email: '' };
    let resolveCallback: (u: AuthUser | null) => void;
    const promise = new Promise<AuthUser | null>((resolve) => {
      resolveCallback = resolve;
    });
    
    const handleCallbackMock = vi.fn(() => promise);
    const service = makeServiceStub({
      handleCallback: handleCallbackMock,
    });

    window.history.replaceState({}, '', '/?code=strict-code&state=strict-state');

    const { unmount } = render(
      <AuthProvider service={service}>
        <TestConsumer />
      </AuthProvider>
    );
    
    unmount();

    render(
      <AuthProvider service={service}>
        <TestConsumer />
      </AuthProvider>
    );
    
    await act(async () => {
      resolveCallback!(callbackUser);
      await promise;
    });
    
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Strict Mode User');
    expect(handleCallbackMock).toHaveBeenCalledTimes(2);
  });

  // Intentionally not testing that we remembered originalSearch to stop TS warning  
  void originalSearch;
});
