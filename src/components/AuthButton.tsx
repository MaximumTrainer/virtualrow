import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './AuthButton.css';

export function AuthButton() {
  const { user, isAuthenticated, isLoading, authError, login, logout, clearAuthError } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const visibleError = loginError ?? authError;

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
          onClick={() => {
            setLoginError(null);
            clearAuthError();
            login().catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : 'Login failed';
              setLoginError(msg);
            });
          }}
          aria-label="Sign in with intervals.icu"
        >
          <span className="auth-icu-icon" aria-hidden="true">🔑</span>
          Sign in with intervals.icu
        </button>
        {visibleError && (
          <div className="auth-login-error" role="alert" title={visibleError}>
            ⚠️ {visibleError.includes('VITE_INTERVALS_CLIENT_ID')
              ? 'OAuth client ID not configured — check DEVELOPMENT.md'
              : visibleError}
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
              className="auth-dropdown-item"
              onClick={() => {
                handleDropdownClose();
                // Workout History is the 'history' view in the main nav; this
                // is a convenience shortcut — navigating via the nav is fine too.
                window.dispatchEvent(new CustomEvent('virtualrow:nav', { detail: 'history' }));
              }}
            >
              📊 Workout History
            </button>
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
