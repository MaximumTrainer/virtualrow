import type { AuthUser, UserProfile, UserProfileWithIntegrations, IntegrationConnection } from '../types/index';

const STORAGE_KEY = 'virtualrow_auth';
const PROFILE_STORAGE_KEY = 'virtualrow_user_profile';

export class AuthService {
  private currentUser: AuthUser | null = null;
  private userProfile: UserProfileWithIntegrations | null = null;
  private listeners: Array<(user: AuthUser | null) => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const authData = localStorage.getItem(STORAGE_KEY);
      if (authData) {
        const parsed = JSON.parse(authData);
        this.currentUser = {
          ...parsed,
          createdAt: new Date(parsed.createdAt),
          lastLoginAt: new Date(parsed.lastLoginAt),
        };
      }

      const profileData = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (profileData) {
        this.userProfile = JSON.parse(profileData);
      }
    } catch (e) {
      // Ignore storage errors
      console.warn('Failed to load auth data from storage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      if (this.currentUser) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentUser));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      if (this.userProfile) {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(this.userProfile));
      } else {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Failed to save auth data to storage:', e);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.currentUser));
  }

  /**
   * Register a new user (simulated - would be a real auth call in production)
   */
  async register(email: string, password: string, displayName: string): Promise<AuthUser | null> {
    // Validate inputs
    if (!email || !password || !displayName) {
      throw new Error('Email, password, and display name are required');
    }

    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Simulate registration - in production this would call an auth API
    const now = new Date();
    const user: AuthUser = {
      id: `user_${Date.now()}`,
      email,
      displayName,
      createdAt: now,
      lastLoginAt: now,
    };

    const profile: UserProfileWithIntegrations = {
      id: user.id,
      name: displayName,
      email,
      favoriteRoutes: [],
      personalBest: [],
      totalDistance: 0,
      totalWorkouts: 0,
      preferences: {
        units: 'metric',
        theme: 'light',
        notifications: true,
      },
      integrations: [],
      workoutHistory: [],
    };

    this.currentUser = user;
    this.userProfile = profile;
    this.saveToStorage();
    this.notifyListeners();

    return user;
  }

  /**
   * Log in with email and password (simulated - would be a real auth call in production)
   */
  async login(email: string, password: string): Promise<AuthUser | null> {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    // For demo purposes, accept any valid email/password combo
    // In production, this would validate against a backend
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check if user data exists in storage (simulate existing user)
    const now = new Date();
    let user: AuthUser;

    const existingAuth = localStorage.getItem(STORAGE_KEY);
    if (existingAuth) {
      const parsed = JSON.parse(existingAuth);
      if (parsed.email === email) {
        user = {
          ...parsed,
          createdAt: new Date(parsed.createdAt),
          lastLoginAt: now,
        };
      } else {
        // Create new user for this email
        user = {
          id: `user_${Date.now()}`,
          email,
          displayName: email.split('@')[0],
          createdAt: now,
          lastLoginAt: now,
        };
      }
    } else {
      // Create new user
      user = {
        id: `user_${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        createdAt: now,
        lastLoginAt: now,
      };
    }

    this.currentUser = user;
    
    // Load or create profile
    const profileData = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (profileData) {
      this.userProfile = JSON.parse(profileData);
    } else {
      this.userProfile = {
        id: user.id,
        name: user.displayName,
        email: user.email,
        favoriteRoutes: [],
        personalBest: [],
        totalDistance: 0,
        totalWorkouts: 0,
        preferences: {
          units: 'metric',
          theme: 'light',
          notifications: true,
        },
        integrations: [],
        workoutHistory: [],
      };
    }

    this.saveToStorage();
    this.notifyListeners();

    return user;
  }

  /**
   * Log out the current user
   */
  logout(): void {
    this.currentUser = null;
    // Keep profile data for next login
    this.notifyListeners();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get the currently logged in user
   */
  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Get the user's profile with integrations
   */
  getUserProfile(): UserProfileWithIntegrations | null {
    return this.userProfile;
  }

  /**
   * Update user profile
   */
  updateProfile(updates: Partial<UserProfile>): UserProfileWithIntegrations | null {
    if (!this.userProfile) return null;

    this.userProfile = {
      ...this.userProfile,
      ...updates,
    };

    this.saveToStorage();
    return this.userProfile;
  }

  /**
   * Add an integration connection
   */
  addIntegration(integration: IntegrationConnection): void {
    if (!this.userProfile) return;

    const existingIndex = this.userProfile.integrations.findIndex(
      i => i.platform === integration.platform
    );

    if (existingIndex >= 0) {
      this.userProfile.integrations[existingIndex] = integration;
    } else {
      this.userProfile.integrations.push(integration);
    }

    this.saveToStorage();
  }

  /**
   * Remove an integration connection
   */
  removeIntegration(platform: string): void {
    if (!this.userProfile) return;

    this.userProfile.integrations = this.userProfile.integrations.filter(
      i => i.platform !== platform
    );

    this.saveToStorage();
  }

  /**
   * Get an integration by platform
   */
  getIntegration(platform: string): IntegrationConnection | undefined {
    return this.userProfile?.integrations.find(i => i.platform === platform);
  }

  /**
   * Add a workout session ID to user's history
   */
  addWorkoutToHistory(sessionId: string): void {
    if (!this.userProfile) return;

    if (!this.userProfile.workoutHistory.includes(sessionId)) {
      this.userProfile.workoutHistory.push(sessionId);
      this.saveToStorage();
    }
  }

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    this.listeners.push(callback);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

export const authService = new AuthService();
