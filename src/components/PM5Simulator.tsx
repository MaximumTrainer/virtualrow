import React, { useState, useEffect, useCallback } from 'react';
import { pm5Simulator } from '../services/pm5SimulatorService';
import type { SimulatorSettings } from '../services/pm5SimulatorService';
import type { PM5Data } from '../types/index';
import './PM5Simulator.css';

interface PM5SimulatorProps {
  onConnected?: (deviceName: string) => void;
  onDisconnected?: () => void;
  onDataReceived?: (data: PM5Data) => void;
}

export const PM5Simulator: React.FC<PM5SimulatorProps> = ({
  onConnected,
  onDisconnected,
  onDataReceived,
}) => {
  const [isActive, setIsActive] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [settings, setSettings] = useState<SimulatorSettings>({
    pace: 120,
    cadence: 24,
    heartRate: 130,
    power: 150,
    isRowing: false,
  });

  // Handle data from simulator
  const handleData = useCallback((data: PM5Data) => {
    onDataReceived?.(data);
  }, [onDataReceived]);

  useEffect(() => {
    pm5Simulator.addListener(handleData);
    return () => {
      pm5Simulator.removeListener(handleData);
    };
  }, [handleData]);

  const handleStartSimulator = () => {
    pm5Simulator.updateSettings(settings);
    pm5Simulator.start();
    setIsActive(true);
    onConnected?.('PM5 Simulator');
  };

  const handleStopSimulator = () => {
    pm5Simulator.stop();
    setIsActive(false);
    onDisconnected?.();
  };

  const handleToggleRowing = () => {
    const newIsRowing = !settings.isRowing;
    setSettings(prev => ({ ...prev, isRowing: newIsRowing }));
    pm5Simulator.updateSettings({ isRowing: newIsRowing });
  };

  const handleSettingChange = (key: keyof SimulatorSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    if (isActive) {
      pm5Simulator.updateSettings({ [key]: value });
    }
  };

  const handleReset = () => {
    pm5Simulator.reset();
  };

  // Format pace as MM:SS
  const formatPace = (paceSeconds: number): string => {
    const mins = Math.floor(paceSeconds / 60);
    const secs = paceSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="pm5-simulator-container">
      <div 
        className="simulator-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="simulator-title">
          <span className="simulator-icon">🎮</span>
          <span>PM5 Simulator</span>
          {isActive && <span className="status-badge active">ACTIVE</span>}
        </div>
        <button className="expand-btn">
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div className="simulator-content">
          {!isActive ? (
            <button className="btn btn-start" onClick={handleStartSimulator}>
              ▶ Start Simulator
            </button>
          ) : (
            <>
              <div className="rowing-toggle">
                <button 
                  className={`btn btn-rowing ${settings.isRowing ? 'rowing' : 'stopped'}`}
                  onClick={handleToggleRowing}
                >
                  {settings.isRowing ? '🚣 Rowing...' : '⏸ Start Rowing'}
                </button>
              </div>

              <div className="settings-grid">
                <div className="setting-item">
                  <label>Pace</label>
                  <div className="setting-control">
                    <input
                      type="range"
                      min="80"
                      max="180"
                      value={settings.pace}
                      onChange={(e) => handleSettingChange('pace', Number(e.target.value))}
                    />
                    <span className="setting-value">{formatPace(settings.pace)}/500m</span>
                  </div>
                </div>

                <div className="setting-item">
                  <label>Stroke Rate</label>
                  <div className="setting-control">
                    <input
                      type="range"
                      min="16"
                      max="40"
                      value={settings.cadence}
                      onChange={(e) => handleSettingChange('cadence', Number(e.target.value))}
                    />
                    <span className="setting-value">{settings.cadence} spm</span>
                  </div>
                </div>

                <div className="setting-item">
                  <label>Heart Rate</label>
                  <div className="setting-control">
                    <input
                      type="range"
                      min="60"
                      max="200"
                      value={settings.heartRate}
                      onChange={(e) => handleSettingChange('heartRate', Number(e.target.value))}
                    />
                    <span className="setting-value">{settings.heartRate} bpm</span>
                  </div>
                </div>

                <div className="setting-item">
                  <label>Power</label>
                  <div className="setting-control">
                    <input
                      type="range"
                      min="50"
                      max="400"
                      value={settings.power}
                      onChange={(e) => handleSettingChange('power', Number(e.target.value))}
                    />
                    <span className="setting-value">{settings.power} W</span>
                  </div>
                </div>
              </div>

              <div className="simulator-actions">
                <button className="btn btn-reset" onClick={handleReset}>
                  ↺ Reset
                </button>
                <button className="btn btn-stop" onClick={handleStopSimulator}>
                  ⏹ Stop
                </button>
              </div>
            </>
          )}

          <p className="simulator-hint">
            💡 Use this simulator to test the app without a real PM5 rowing machine
          </p>
        </div>
      )}
    </div>
  );
};

export default PM5Simulator;
