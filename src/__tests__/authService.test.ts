import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../services/authService';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    authService = new AuthService();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const user = await authService.register('test@example.com', 'password123', 'Test User');

      expect(user).not.toBeNull();
      expect(user?.email).toBe('test@example.com');
      expect(user?.displayName).toBe('Test User');
      expect(user?.id).toMatch(/^user_/);
    });

    it('should throw error for invalid email', async () => {
      await expect(authService.register('invalid-email', 'password123', 'Test User'))
        .rejects.toThrow('Invalid email format');
    });

    it('should throw error for short password', async () => {
      await expect(authService.register('test@example.com', '12345', 'Test User'))
        .rejects.toThrow('Password must be at least 6 characters');
    });

    it('should throw error for missing fields', async () => {
      await expect(authService.register('', 'password123', 'Test User'))
        .rejects.toThrow('Email, password, and display name are required');
    });

    it('should create a user profile on registration', async () => {
      await authService.register('test@example.com', 'password123', 'Test User');
      
      const profile = authService.getUserProfile();
      expect(profile).not.toBeNull();
      expect(profile?.email).toBe('test@example.com');
      expect(profile?.integrations).toEqual([]);
      expect(profile?.workoutHistory).toEqual([]);
    });
  });

  describe('login', () => {
    it('should log in a user successfully', async () => {
      const user = await authService.login('test@example.com', 'password123');

      expect(user).not.toBeNull();
      expect(user?.email).toBe('test@example.com');
    });

    it('should throw error for invalid email format', async () => {
      await expect(authService.login('invalid-email', 'password123'))
        .rejects.toThrow('Invalid email format');
    });

    it('should throw error for missing credentials', async () => {
      await expect(authService.login('', 'password123'))
        .rejects.toThrow('Email and password are required');
    });
  });

  describe('logout', () => {
    it('should log out the user', async () => {
      await authService.login('test@example.com', 'password123');
      expect(authService.isLoggedIn()).toBe(true);

      authService.logout();
      expect(authService.isLoggedIn()).toBe(false);
      expect(authService.getCurrentUser()).toBeNull();
    });
  });

  describe('isLoggedIn', () => {
    it('should return false when not logged in', () => {
      expect(authService.isLoggedIn()).toBe(false);
    });

    it('should return true when logged in', async () => {
      await authService.login('test@example.com', 'password123');
      expect(authService.isLoggedIn()).toBe(true);
    });
  });

  describe('integrations', () => {
    it('should add an integration', async () => {
      await authService.register('test@example.com', 'password123', 'Test User');

      authService.addIntegration({
        platform: 'strava',
        connected: true,
        accessToken: 'token123',
        syncEnabled: true,
      });

      const integration = authService.getIntegration('strava');
      expect(integration).not.toBeUndefined();
      expect(integration?.platform).toBe('strava');
      expect(integration?.connected).toBe(true);
    });

    it('should update an existing integration', async () => {
      await authService.register('test@example.com', 'password123', 'Test User');

      authService.addIntegration({
        platform: 'strava',
        connected: true,
        accessToken: 'token123',
        syncEnabled: true,
      });

      authService.addIntegration({
        platform: 'strava',
        connected: true,
        accessToken: 'newtoken456',
        syncEnabled: false,
      });

      const integration = authService.getIntegration('strava');
      expect(integration?.accessToken).toBe('newtoken456');
      expect(integration?.syncEnabled).toBe(false);
    });

    it('should remove an integration', async () => {
      await authService.register('test@example.com', 'password123', 'Test User');

      authService.addIntegration({
        platform: 'strava',
        connected: true,
        accessToken: 'token123',
        syncEnabled: true,
      });

      authService.removeIntegration('strava');

      const integration = authService.getIntegration('strava');
      expect(integration).toBeUndefined();
    });
  });

  describe('workout history', () => {
    it('should add workout to history', async () => {
      await authService.register('test@example.com', 'password123', 'Test User');

      authService.addWorkoutToHistory('workout_123');
      authService.addWorkoutToHistory('workout_456');

      const profile = authService.getUserProfile();
      expect(profile?.workoutHistory).toContain('workout_123');
      expect(profile?.workoutHistory).toContain('workout_456');
    });

    it('should not duplicate workout IDs in history', async () => {
      await authService.register('test@example.com', 'password123', 'Test User');

      authService.addWorkoutToHistory('workout_123');
      authService.addWorkoutToHistory('workout_123');

      const profile = authService.getUserProfile();
      expect(profile?.workoutHistory.length).toBe(1);
    });
  });

  describe('auth state listeners', () => {
    it('should notify listeners on auth state change', async () => {
      const callback = vi.fn();
      authService.onAuthStateChanged(callback);

      await authService.login('test@example.com', 'password123');

      expect(callback).toHaveBeenCalled();
    });

    it('should allow unsubscribing from auth state changes', async () => {
      const callback = vi.fn();
      const unsubscribe = authService.onAuthStateChanged(callback);

      unsubscribe();
      await authService.login('test@example.com', 'password123');

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
