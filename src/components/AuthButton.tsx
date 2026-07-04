import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './AuthButton.css';

export function AuthButton() {
  const { user, isAuthenticated, isLoading, authError, login, logout, clearAuthError } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);
  const visibleError = loginError ?? authError;

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
    <div className="auth-user-summary">
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
      <span className="auth-display-name" title={user.name}>{user.name}</span>
      <button
        type="button"
        className="auth-button auth-button--logout"
        onClick={logout}
        aria-label="Log out"
      >
        Log out
      </button>
    </div>
  );
}
