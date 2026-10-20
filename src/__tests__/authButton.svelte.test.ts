import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import AuthButtonHarness from './fixtures/AuthButtonHarness.svelte';
import { AuthStore } from '../lib/ui/auth.svelte';
import type { AuthPort } from '../lib/ports';
import type { AuthUser } from '../lib/types/index';

const USER: AuthUser = { id: 'i1', name: 'Dana Rower', email: 'dana@example.com' };

/** A stub AuthPort; only the methods AuthButton exercises need real behaviour. */
function stubAuth(user: AuthUser | null = null): AuthPort {
  return {
    getUser: () => user,
    startLogin: vi.fn(async () => {}),
    handleCallback: vi.fn(async () => null),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => null),
    getLastError: vi.fn(() => null),
    getLastErrorClass: vi.fn(() => null),
    refreshAccessToken: vi.fn(async () => false),
    scheduleRefresh: vi.fn(),
    isAuthenticated: vi.fn(() => user !== null),
  } as unknown as AuthPort;
}

// #542 P1 (F4): AuthButton ported to Svelte, same DOM/classes the specs use.
describe('AuthButton.svelte', () => {
  it('shows the sign-in button when signed out', () => {
    const store = new AuthStore(stubAuth(null));
    const { container } = render(AuthButtonHarness, { store });

    const btn = container.querySelector('.auth-button--signin');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Sign in with intervals.icu');
    expect(container.querySelector('.auth-button-text--long')?.textContent).toContain(
      'Sign in with intervals.icu',
    );
  });

  it('starts the OAuth flow when the sign-in button is clicked', async () => {
    const service = stubAuth(null);
    const store = new AuthStore(service);
    const { container } = render(AuthButtonHarness, { store });

    await fireEvent.click(container.querySelector('.auth-button--signin')!);
    expect(service.startLogin).toHaveBeenCalledTimes(1);
  });

  it('renders the loading state', () => {
    const store = new AuthStore(stubAuth(null));
    store.isLoading = true;
    const { container } = render(AuthButtonHarness, { store });

    const loading = container.querySelector('.auth-button--loading');
    expect(loading).not.toBeNull();
    expect(loading!.getAttribute('aria-busy')).toBe('true');
  });

  it('shows a retry button for a retryable error but not for a config error', () => {
    const retry = new AuthStore(stubAuth(null));
    retry.authError = 'network blip';
    retry.authErrorClass = 'network';
    const r = render(AuthButtonHarness, { store: retry });
    const alert = r.container.querySelector('.auth-login-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.getAttribute('data-auth-error-class')).toBe('network');
    expect(r.container.querySelector('.auth-retry-button')).not.toBeNull();

    const config = new AuthStore(stubAuth(null));
    config.authError = 'client id missing';
    config.authErrorClass = 'config';
    const c = render(AuthButtonHarness, { store: config });
    expect(c.container.querySelector('.auth-retry-button')).toBeNull();
  });

  it('shows the user menu and signs out when signed in', async () => {
    const service = stubAuth(USER);
    const store = new AuthStore(service);
    const { container } = render(AuthButtonHarness, { store });

    const trigger = container.querySelector('.auth-user-trigger');
    expect(trigger).not.toBeNull();
    expect(screen.getByText('Dana Rower')).toBeTruthy();

    await fireEvent.click(trigger!);
    expect(container.querySelector('.auth-dropdown')).not.toBeNull();
    expect(screen.getByText('dana@example.com')).toBeTruthy();

    await fireEvent.click(container.querySelector('.auth-dropdown-item--signout')!);
    expect(service.logout).toHaveBeenCalledTimes(1);
    expect(store.user).toBeNull();
  });
});
