import { useAuth } from '../context/AuthContext';
import './AuthGateModal.css';

export interface AuthGateModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Human-readable description of the action requiring auth (e.g. "save your workout"). */
  actionDescription?: string;
  /** Called when the user clicks "Sign in". */
  onLogin: () => void;
  /** Called when the user dismisses the modal without signing in. */
  onDismiss: () => void;
}

/**
 * Non-blocking sign-in prompt shown when a guest attempts a protected action.
 * The user can either sign in (triggering the OAuth flow) or continue without
 * an account (allowing the action to degrade gracefully — e.g. guest export).
 */
export function AuthGateModal({ isOpen, actionDescription, onLogin, onDismiss }: AuthGateModalProps) {
  const { login } = useAuth();

  if (!isOpen) return null;

  const handleSignIn = () => {
    onLogin();
    void login();
  };

  return (
    <div className="auth-gate-overlay" role="dialog" aria-modal="true" aria-label="Sign in required">
      <div className="auth-gate-modal">
        <button
          type="button"
          className="auth-gate-close"
          onClick={onDismiss}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="auth-gate-icon" aria-hidden="true">🔐</div>

        <h2 className="auth-gate-title">Sign in to continue</h2>

        <p className="auth-gate-body">
          {actionDescription
            ? `To ${actionDescription}, you need a free intervals.icu account.`
            : 'This feature requires a free intervals.icu account.'}
        </p>

        <div className="auth-gate-actions">
          <button
            type="button"
            className="btn auth-gate-btn--signin"
            onClick={handleSignIn}
          >
            <span aria-hidden="true">🔑</span> Sign in with intervals.icu
          </button>
          <button
            type="button"
            className="btn auth-gate-btn--guest"
            onClick={onDismiss}
          >
            Continue as Guest
          </button>
        </div>

        <p className="auth-gate-note">
          No account? Create one free at{' '}
          <a
            href="https://intervals.icu"
            target="_blank"
            rel="noopener noreferrer"
            className="auth-gate-link"
          >
            intervals.icu
          </a>
        </p>
      </div>
    </div>
  );
}
