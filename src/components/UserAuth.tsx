import { useState, useEffect } from 'react';
import type { AuthUser } from '../types/index';
import { authService } from '../services/authService';
import './UserAuth.css';

interface UserAuthProps {
  onAuthChange?: (user: AuthUser | null) => void;
}

export function UserAuth({ onAuthChange }: UserAuthProps) {
  const [user, setUser] = useState<AuthUser | null>(authService.getCurrentUser());
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((updatedUser) => {
      setUser(updatedUser);
      onAuthChange?.(updatedUser);
    });

    return () => unsubscribe();
  }, [onAuthChange]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const loggedInUser = await authService.login(email, password);
      if (loggedInUser) {
        setShowLoginForm(false);
        setEmail('');
        setPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const registeredUser = await authService.register(email, password, displayName);
      if (registeredUser) {
        setShowLoginForm(false);
        setIsRegistering(false);
        setEmail('');
        setPassword('');
        setDisplayName('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    authService.logout();
    setShowLoginForm(false);
  };

  const toggleMode = () => {
    setIsRegistering(!isRegistering);
    setError(null);
  };

  if (user) {
    return (
      <div className="user-auth logged-in">
        <div className="user-info">
          <div className="user-avatar">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.displayName} />
            ) : (
              <span className="avatar-initial">{user.displayName[0].toUpperCase()}</span>
            )}
          </div>
          <div className="user-details">
            <span className="user-name">{user.displayName}</span>
            <span className="user-email">{user.email}</span>
          </div>
        </div>
        <button className="btn-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    );
  }

  if (showLoginForm) {
    return (
      <div className="user-auth login-form-container">
        <form onSubmit={isRegistering ? handleRegister : handleLogin} className="login-form">
          <h3>{isRegistering ? 'Create Account' : 'Sign In'}</h3>
          
          {error && <div className="auth-error">{error}</div>}
          
          {isRegistering && (
            <div className="form-group">
              <label htmlFor="displayName">Display Name</label>
              <input
                type="text"
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}
          
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>
          
          <div className="form-actions">
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'Loading...' : (isRegistering ? 'Create Account' : 'Sign In')}
            </button>
            <button 
              type="button" 
              className="btn-cancel" 
              onClick={() => setShowLoginForm(false)}
            >
              Cancel
            </button>
          </div>
          
          <div className="form-footer">
            <button type="button" className="btn-link" onClick={toggleMode}>
              {isRegistering 
                ? 'Already have an account? Sign in' 
                : "Don't have an account? Create one"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="user-auth not-logged-in">
      <button className="btn-login" onClick={() => setShowLoginForm(true)}>
        <span className="login-icon">👤</span>
        <span>Sign In</span>
      </button>
      <p className="login-hint">Sign in to sync workouts & save history</p>
    </div>
  );
}

export default UserAuth;
