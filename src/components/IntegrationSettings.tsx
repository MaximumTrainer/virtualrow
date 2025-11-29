import { useState, useEffect } from 'react';
import type { IntegrationConnection, IntegrationPlatform } from '../types/index';
import { integrationsService } from '../services/integrationsService';
import { authService } from '../services/authService';
import './IntegrationSettings.css';

interface IntegrationSettingsProps {
  onClose?: () => void;
}

export function IntegrationSettings({ onClose }: IntegrationSettingsProps) {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [connectingPlatform, setConnectingPlatform] = useState<IntegrationPlatform | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = () => {
    setConnections(integrationsService.getConnectedIntegrations());
  };

  const platforms = integrationsService.getAvailablePlatforms();

  const getPlatformDetails = (platform: IntegrationPlatform) => {
    const details: Record<IntegrationPlatform, { name: string; icon: string; description: string }> = {
      strava: {
        name: 'Strava',
        icon: '🏃',
        description: 'Sync workouts to Strava and track your fitness across all activities',
      },
      intervals: {
        name: 'Intervals.icu',
        icon: '📊',
        description: 'Import structured workouts and sync training data',
      },
      trainingpeaks: {
        name: 'TrainingPeaks',
        icon: '📈',
        description: 'Connect with your coach and follow structured training plans',
      },
    };
    return details[platform];
  };

  const getConnection = (platform: IntegrationPlatform): IntegrationConnection | undefined => {
    return connections.find(c => c.platform === platform);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectingPlatform) return;

    setError(null);
    setLoading(true);

    try {
      const connection = await integrationsService.connectWithApiKey(
        connectingPlatform,
        apiKey,
        connectingPlatform === 'intervals' ? athleteId : undefined
      );

      if (connection) {
        loadConnections();
        setConnectingPlatform(null);
        setApiKey('');
        setAthleteId('');
      } else {
        setError('Failed to connect. Please check your credentials.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = (platform: IntegrationPlatform) => {
    integrationsService.disconnect(platform);
    loadConnections();
  };

  const handleToggleSync = (platform: IntegrationPlatform, enabled: boolean) => {
    integrationsService.toggleSync(platform, enabled);
    loadConnections();
  };

  const formatDate = (date: Date | undefined): string => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString();
  };

  if (!authService.isLoggedIn()) {
    return (
      <div className="integration-settings">
        <div className="integration-header">
          <h2>Integrations</h2>
          {onClose && (
            <button className="btn-close" onClick={onClose}>×</button>
          )}
        </div>
        <div className="login-required">
          <p>Please sign in to connect external platforms</p>
        </div>
      </div>
    );
  }

  return (
    <div className="integration-settings">
      <div className="integration-header">
        <h2>Integrations</h2>
        {onClose && (
          <button className="btn-close" onClick={onClose}>×</button>
        )}
      </div>

      <p className="integration-description">
        Connect your favorite fitness platforms to sync workouts automatically
      </p>

      <div className="platforms-list">
        {platforms.map(platform => {
          const details = getPlatformDetails(platform);
          const connection = getConnection(platform);
          const isConnected = connection?.connected;

          return (
            <div key={platform} className={`platform-card ${isConnected ? 'connected' : ''}`}>
              <div className="platform-info">
                <span className="platform-icon">{details.icon}</span>
                <div className="platform-details">
                  <h3>{details.name}</h3>
                  <p>{details.description}</p>
                  {isConnected && connection?.lastSyncAt && (
                    <span className="last-sync">
                      Last synced: {formatDate(connection.lastSyncAt)}
                    </span>
                  )}
                </div>
              </div>

              {isConnected ? (
                <div className="platform-actions connected">
                  <label className="sync-toggle">
                    <input
                      type="checkbox"
                      checked={connection?.syncEnabled ?? false}
                      onChange={(e) => handleToggleSync(platform, e.target.checked)}
                    />
                    <span>Auto-sync</span>
                  </label>
                  <button
                    className="btn-disconnect"
                    onClick={() => handleDisconnect(platform)}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  className="btn-connect"
                  onClick={() => setConnectingPlatform(platform)}
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Connection dialog */}
      {connectingPlatform && (
        <div className="connect-dialog-overlay">
          <div className="connect-dialog">
            <h3>Connect to {getPlatformDetails(connectingPlatform).name}</h3>
            
            {error && <div className="connect-error">{error}</div>}

            <form onSubmit={handleConnect}>
              <div className="form-group">
                <label htmlFor="apiKey">API Key</label>
                <input
                  type="password"
                  id="apiKey"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  required
                />
              </div>

              {connectingPlatform === 'intervals' && (
                <div className="form-group">
                  <label htmlFor="athleteId">Athlete ID</label>
                  <input
                    type="text"
                    id="athleteId"
                    value={athleteId}
                    onChange={(e) => setAthleteId(e.target.value)}
                    placeholder="Your intervals.icu athlete ID"
                    required
                  />
                </div>
              )}

              <div className="dialog-actions">
                <button type="submit" className="btn-submit" disabled={loading}>
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setConnectingPlatform(null);
                    setApiKey('');
                    setAthleteId('');
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>

            <div className="help-text">
              <p>
                {connectingPlatform === 'strava' && (
                  <>Get your API key from <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener noreferrer">Strava Settings</a></>
                )}
                {connectingPlatform === 'intervals' && (
                  <>Get your API key from <a href="https://intervals.icu/settings" target="_blank" rel="noopener noreferrer">Intervals.icu Settings</a></>
                )}
                {connectingPlatform === 'trainingpeaks' && (
                  <>Get your API key from <a href="https://home.trainingpeaks.com/settings" target="_blank" rel="noopener noreferrer">TrainingPeaks Settings</a></>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default IntegrationSettings;
