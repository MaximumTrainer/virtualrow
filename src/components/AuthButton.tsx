import { useRef, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { RETRYABLE_AUTH_ERROR_CLASSES } from '../services/authService';
import './AuthButton.css';

export function AuthButton() {
  const { user, isAuthenticated, isLoading, authError, authErrorClass, login, logout, clearAuthError } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const visibleError = loginError ?? authError;
  // `config` is the only class that is NOT recoverable from a retry; every
  // other class (including the fallback `unknown` and the `null` from a
  // locally-thrown login error) offers the button (#486 Phase 2 FR3, D4 = a).
  const showRetryButton =
    visibleError !== null &&
    (authErrorClass === null || RETRYABLE_AUTH_ERROR_CLASSES.has(authErrorClass));

  const startLogin = () => {
    setLoginError(null);
    clearAuthError();
    login().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setLoginError(msg);
    });
  };

  const handleDropdownToggle = () => setDropdownOpen((o) => !o);
  const handleDropdownClose = () => setDropdownOpen(false);

  if (isLoading) {
    return (
      <div className="auth-button auth-button--loading" aria-busy="true">
        <span className="auth-spinner" aria-hidden="true" />
        <span>Signing in…</span>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="auth-signin-wrapper">
        <button
          type="button"
          className="auth-button auth-button--signin"
          onClick={startLogin}
          aria-label="Sign in with intervals.icu"
        >
          <span className="auth-icu-icon" aria-hidden="true">🔑</span>
          {/* The full label does not fit beside the title and the hamburger on a
              320px header. The accessible name comes from aria-label above, so
              it stays the same at every width (issue #219, R8). */}
          <span className="auth-button-text auth-button-text--long">Sign in with intervals.icu</span>
          <span className="auth-button-text auth-button-text--short">Sign in</span>
        </button>
        {visibleError && (
          <div
            className="auth-login-error"
            role="alert"
            title={visibleError}
            data-auth-error-class={authErrorClass ?? 'unknown'}
          >
            ⚠️ {visibleError.includes('VITE_INTERVALS_CLIENT_ID')
              ? 'OAuth client ID not configured — check DEVELOPMENT.md'
              : visibleError}
            {showRetryButton && (
              <button
                type="button"
                className="auth-retry-button"
                onClick={startLogin}
              >
                Retry sign in
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth-user-menu" ref={dropdownRef}>
      <button
        type="button"
        className="auth-user-trigger"
        onClick={handleDropdownToggle}
        aria-haspopup="true"
        aria-expanded={dropdownOpen}
        aria-label={`Account menu for ${user.name}`}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="auth-avatar"
            width={28}
            height={28}
          />
        ) : (
          <span className="auth-avatar-placeholder" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="auth-display-name">{user.name}</span>
        <span className="auth-caret" aria-hidden="true">▾</span>
      </button>

      {dropdownOpen && (
        <>
          {/* Backdrop to close the dropdown when clicking outside */}
          <div
            className="auth-dropdown-backdrop"
            onClick={handleDropdownClose}
            aria-hidden="true"
          />
          <div className="auth-dropdown" role="menu">
            <div className="auth-dropdown-header">
              <span className="auth-dropdown-name">{user.name}</span>
              <span className="auth-dropdown-email">{user.email}</span>
            </div>
            <hr className="auth-dropdown-divider" />
            <button
              type="button"
              role="menuitem"
              className="auth-dropdown-item auth-dropdown-item--signout"
              onClick={() => {
                handleDropdownClose();
                logout();
              }}
            >
              ↩ Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
