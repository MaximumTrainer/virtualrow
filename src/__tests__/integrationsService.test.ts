import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationsService } from '../services/integrationsService';
import { authService } from '../services/authService';

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

describe('IntegrationsService', () => {
  let integrationsService: IntegrationsService;

  beforeEach(async () => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset auth state - need to create a fresh service instance
    authService.logout();
    // Create a fresh integrations service
    integrationsService = new IntegrationsService();
  });

  describe('getAvailablePlatforms', () => {
    it('should return all available platforms', () => {
      const platforms = integrationsService.getAvailablePlatforms();
      
      expect(platforms).toContain('strava');
      expect(platforms).toContain('intervals');
      expect(platforms).toContain('trainingpeaks');
      expect(platforms.length).toBe(3);
    });
  });

  describe('getPlatformInfo', () => {
    it('should return platform info for strava', () => {
      const info = integrationsService.getPlatformInfo('strava');
      
      expect(info).not.toBeNull();
      expect(info?.name).toBe('Strava');
      expect(info?.authUrl).toContain('strava.com');
    });

    it('should return platform info for intervals', () => {
      const info = integrationsService.getPlatformInfo('intervals');
      
      expect(info).not.toBeNull();
      expect(info?.name).toBe('Intervals.icu');
    });

    it('should return platform info for trainingpeaks', () => {
      const info = integrationsService.getPlatformInfo('trainingpeaks');
      
      expect(info).not.toBeNull();
      expect(info?.name).toBe('TrainingPeaks');
    });
  });

  describe('connectWithApiKey', () => {
    it('should throw error when not logged in', async () => {
      await expect(integrationsService.connectWithApiKey('strava', 'valid-api-key'))
        .rejects.toThrow('User must be logged in to connect integrations');
    });

    it('should connect when logged in with valid API key', async () => {
      await authService.login('test@example.com', 'password123');
      
      const connection = await integrationsService.connectWithApiKey('strava', 'valid-api-key-12345');
      
      expect(connection).not.toBeNull();
      expect(connection?.platform).toBe('strava');
      expect(connection?.connected).toBe(true);
    });

    it('should return null for invalid short API key', async () => {
      await authService.login('test@example.com', 'password123');
      
      const connection = await integrationsService.connectWithApiKey('strava', 'short');
      
      expect(connection).toBeNull();
    });

    it('should require athlete ID for intervals.icu', async () => {
      await authService.login('test@example.com', 'password123');
      
      // Without athlete ID
      const connection = await integrationsService.connectWithApiKey('intervals', 'valid-api-key-12345');
      expect(connection).toBeNull();
      
      // With athlete ID
      const connectionWithId = await integrationsService.connectWithApiKey('intervals', 'valid-api-key-12345', 'i12345');
      expect(connectionWithId).not.toBeNull();
      expect(connectionWithId?.athleteId).toBe('i12345');
    });
  });

  describe('disconnect', () => {
    it('should disconnect a platform', async () => {
      await authService.login('test@example.com', 'password123');
      await integrationsService.connectWithApiKey('strava', 'valid-api-key-12345');
      
      integrationsService.disconnect('strava');
      
      const status = integrationsService.getConnectionStatus('strava');
      expect(status).toBeNull();
    });
  });

  describe('getConnectionStatus', () => {
    it('should return null for unconnected platform', async () => {
      await authService.login('test@example.com', 'password123');
      
      const status = integrationsService.getConnectionStatus('strava');
      
      expect(status).toBeNull();
    });

    it('should return connection for connected platform', async () => {
      await authService.login('test@example.com', 'password123');
      await integrationsService.connectWithApiKey('strava', 'valid-api-key-12345');
      
      const status = integrationsService.getConnectionStatus('strava');
      
      expect(status).not.toBeNull();
      expect(status?.connected).toBe(true);
    });
  });

  describe('getConnectedIntegrations', () => {
    it('should return empty array when user has no integrations', async () => {
      // Use a fresh login to ensure we start with no integrations
      localStorageMock.clear();
      await authService.login('fresh-user@example.com', 'password123');
      
      const connected = integrationsService.getConnectedIntegrations();
      
      // Fresh user should have no integrations
      expect(connected).toEqual([]);
    });

    it('should return all connected integrations', async () => {
      await authService.login('test@example.com', 'password123');
      await integrationsService.connectWithApiKey('strava', 'valid-api-key-12345');
      await integrationsService.connectWithApiKey('intervals', 'valid-api-key-12345', 'i12345');
      
      const connected = integrationsService.getConnectedIntegrations();
      
      expect(connected.length).toBe(2);
      expect(connected.map(c => c.platform)).toContain('strava');
      expect(connected.map(c => c.platform)).toContain('intervals');
    });
  });

  describe('toggleSync', () => {
    it('should toggle sync enabled state', async () => {
      await authService.login('test@example.com', 'password123');
      await integrationsService.connectWithApiKey('strava', 'valid-api-key-12345');
      
      // Initially should be enabled
      let status = integrationsService.getConnectionStatus('strava');
      expect(status?.syncEnabled).toBe(true);
      
      // Disable sync
      integrationsService.toggleSync('strava', false);
      status = integrationsService.getConnectionStatus('strava');
      expect(status?.syncEnabled).toBe(false);
      
      // Re-enable sync
      integrationsService.toggleSync('strava', true);
      status = integrationsService.getConnectionStatus('strava');
      expect(status?.syncEnabled).toBe(true);
    });
  });

  describe('syncWorkout', () => {
    it('should throw error when not logged in', async () => {
      const mockSession = {
        id: 'test-session-1',
        routeId: 'route-1',
        routeName: 'Test Route',
        startTime: new Date(),
        duration: 3600,
        distance: 5000,
        averagePace: 120,
        calories: 500,
        splits: [],
        isActive: false,
      };

      await expect(integrationsService.syncWorkout(mockSession))
        .rejects.toThrow('User must be logged in to sync workouts');
    });

    it('should sync workout to connected platforms', async () => {
      await authService.login('test@example.com', 'password123');
      await integrationsService.connectWithApiKey('strava', 'valid-api-key-12345');
      
      const mockSession = {
        id: 'test-session-1',
        routeId: 'route-1',
        routeName: 'Test Route',
        startTime: new Date(),
        duration: 3600,
        distance: 5000,
        averagePace: 120,
        calories: 500,
        splits: [],
        isActive: false,
      };

      const results = await integrationsService.syncWorkout(mockSession);
      
      expect(results.strava).toBe(true);
    });
  });

  describe('importWorkouts', () => {
    it('should throw error when not logged in', async () => {
      await expect(integrationsService.importWorkouts('strava'))
        .rejects.toThrow('User must be logged in to import workouts');
    });

    it('should throw error when not connected to platform', async () => {
      await authService.login('test@example.com', 'password123');
      
      await expect(integrationsService.importWorkouts('strava'))
        .rejects.toThrow('Not connected to strava');
    });
  });
});
