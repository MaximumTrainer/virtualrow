import type { IntegrationConnection, IntegrationPlatform, WorkoutSession } from '../types/index';
import { authService } from './authService';

// Platform-specific configuration
const PLATFORM_CONFIG: Record<IntegrationPlatform, {
  name: string;
  authUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  scopes: string[];
}> = {
  strava: {
    name: 'Strava',
    authUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    apiBaseUrl: 'https://www.strava.com/api/v3',
    scopes: ['activity:write', 'activity:read'],
  },
  intervals: {
    name: 'Intervals.icu',
    authUrl: 'https://intervals.icu/oauth/authorize',
    tokenUrl: 'https://intervals.icu/oauth/token',
    apiBaseUrl: 'https://intervals.icu/api/v1',
    scopes: ['activity:write'],
  },
  trainingpeaks: {
    name: 'TrainingPeaks',
    authUrl: 'https://oauth.trainingpeaks.com/oauth/authorize',
    tokenUrl: 'https://oauth.trainingpeaks.com/oauth/token',
    apiBaseUrl: 'https://api.trainingpeaks.com/v1',
    scopes: ['workouts:write'],
  },
};

export class IntegrationsService {
  /**
   * Get information about a platform
   */
  getPlatformInfo(platform: IntegrationPlatform): typeof PLATFORM_CONFIG[IntegrationPlatform] | null {
    return PLATFORM_CONFIG[platform] || null;
  }

  /**
   * Get all available platforms
   */
  getAvailablePlatforms(): IntegrationPlatform[] {
    return Object.keys(PLATFORM_CONFIG) as IntegrationPlatform[];
  }

  /**
   * Initiate OAuth connection for a platform
   * In production, this would redirect to the OAuth provider
   * For now, it uses API key-based auth (like intervals.icu)
   */
  async connectWithApiKey(
    platform: IntegrationPlatform,
    apiKey: string,
    athleteId?: string
  ): Promise<IntegrationConnection | null> {
    if (!authService.isLoggedIn()) {
      throw new Error('User must be logged in to connect integrations');
    }

    // Validate the connection by making a test API call
    const isValid = await this.validateApiKey(platform, apiKey, athleteId);
    
    if (!isValid) {
      return null;
    }

    const connection: IntegrationConnection = {
      platform,
      connected: true,
      accessToken: apiKey,
      athleteId: athleteId,
      lastSyncAt: new Date(),
      syncEnabled: true,
    };

    authService.addIntegration(connection);
    return connection;
  }

  /**
   * Disconnect a platform integration
   */
  disconnect(platform: IntegrationPlatform): void {
    if (!authService.isLoggedIn()) {
      return;
    }

    authService.removeIntegration(platform);
  }

  /**
   * Get connection status for a platform
   */
  getConnectionStatus(platform: IntegrationPlatform): IntegrationConnection | null {
    const integration = authService.getIntegration(platform);
    return integration || null;
  }

  /**
   * Get all connected integrations
   */
  getConnectedIntegrations(): IntegrationConnection[] {
    const profile = authService.getUserProfile();
    return profile?.integrations.filter(i => i.connected) || [];
  }

  /**
   * Sync a workout session to connected platforms
   */
  async syncWorkout(session: WorkoutSession): Promise<Record<IntegrationPlatform, boolean>> {
    if (!authService.isLoggedIn()) {
      throw new Error('User must be logged in to sync workouts');
    }

    const results: Record<string, boolean> = {};
    const connectedIntegrations = this.getConnectedIntegrations();

    for (const integration of connectedIntegrations) {
      if (integration.syncEnabled) {
        try {
          const success = await this.uploadToIntegration(integration, session);
          results[integration.platform] = success;
        } catch (e) {
          console.error(`Failed to sync to ${integration.platform}:`, e);
          results[integration.platform] = false;
        }
      }
    }

    return results as Record<IntegrationPlatform, boolean>;
  }

  /**
   * Toggle sync enabled for a platform
   */
  toggleSync(platform: IntegrationPlatform, enabled: boolean): void {
    const integration = authService.getIntegration(platform);
    if (integration) {
      const updated = { ...integration, syncEnabled: enabled };
      authService.addIntegration(updated);
    }
  }

  /**
   * Validate an API key by making a test request
   */
  private async validateApiKey(
    platform: IntegrationPlatform,
    apiKey: string,
    athleteId?: string
  ): Promise<boolean> {
    // In a real implementation, this would make an API call to validate
    // For now, we do basic validation
    if (!apiKey || apiKey.length < 8) {
      return false;
    }

    if (platform === 'intervals' && !athleteId) {
      return false;
    }

    // Simulate API validation delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // For demo purposes, accept any reasonable-looking key
    return true;
  }

  /**
   * Upload workout data to an integration
   */
  private async uploadToIntegration(
    integration: IntegrationConnection,
    session: WorkoutSession
  ): Promise<boolean> {
    // In a real implementation, this would make API calls to each platform
    // For now, simulate the upload

    const activityData = this.formatActivityData(integration.platform, session);
    
    console.log(`Uploading to ${integration.platform}:`, activityData);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update last sync time
    const updated = { ...integration, lastSyncAt: new Date() };
    authService.addIntegration(updated);

    return true;
  }

  /**
   * Format workout session data for a specific platform
   */
  private formatActivityData(
    platform: IntegrationPlatform,
    session: WorkoutSession
  ): Record<string, unknown> {
    const baseData = {
      name: `VirtualRow - ${session.routeName}`,
      type: 'Rowing',
      start_date: session.startTime,
      elapsed_time: session.duration,
      distance: session.distance,
    };

    switch (platform) {
      case 'strava':
        return {
          ...baseData,
          type: 'Rowing',
          sport_type: 'Rowing',
          description: `Virtual rowing session on ${session.routeName}`,
          average_heartrate: session.heartRateAvg,
          max_heartrate: session.heartRateMax,
        };

      case 'intervals':
        return {
          ...baseData,
          icu_training_load: Math.round(session.duration / 60),
          moving_time: session.duration,
          average_speed: session.distance / session.duration,
        };

      case 'trainingpeaks':
        return {
          ...baseData,
          WorkoutType: 'Rowing',
          Title: baseData.name,
          TimeTotalInSeconds: session.duration,
          DistanceInMeters: session.distance,
          HeartRateAverage: session.heartRateAvg,
          HeartRateMaximum: session.heartRateMax,
          Calories: session.calories,
        };

      default:
        return baseData;
    }
  }

  /**
   * Import workouts from a platform
   */
  async importWorkouts(platform: IntegrationPlatform, startDate?: Date, endDate?: Date): Promise<WorkoutSession[]> {
    if (!authService.isLoggedIn()) {
      throw new Error('User must be logged in to import workouts');
    }

    const integration = this.getConnectionStatus(platform);
    if (!integration || !integration.connected) {
      throw new Error(`Not connected to ${platform}`);
    }

    // In a real implementation, this would fetch workouts from the API
    console.log(`Importing from ${platform}`, { startDate, endDate });

    // Return empty array for now - would return actual imported workouts
    return [];
  }
}

export const integrationsService = new IntegrationsService();
