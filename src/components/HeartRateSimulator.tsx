import React, { useState, useEffect, useCallback } from 'react';
import { heartRateSimulator } from '../services/heartRateSimulatorService';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import './PM5Simulator.css';

interface HeartRateSimulatorProps {
  /** Called when the simulator is started */
  onStarted?: () => void;
  /** Called when the simulator is stopped */
  onStopped?: () => void;
}

export const HeartRateSimulator: React.FC<HeartRateSimulatorProps> = ({
  onStarted,
  onStopped,
}) => {
  const [isActive, setIsActive] = useState(heartRateSimulator.isRunning());
  const [isExpanded, setIsExpanded] = useState(false);
  const [bpm, setBpm] = useState(heartRateSimulator.getBpm());
  const [currentBpm, setCurrentBpm] = useState<number | null>(null);

  // Track live BPM from the shared HR service
  const handleSample = useCallback((sample: { bpm: number }) => {
    if (heartRateSimulator.isRunning()) setCurrentBpm(sample.bpm);
  }, []);

  useEffect(() => {
    heartRateBluetoothService.on('heartRate', handleSample);
    return () => {
      heartRateBluetoothService.off('heartRate', handleSample);
    };
  }, [handleSample]);

  const handleStart = () => {
    heartRateSimulator.start(bpm);
    setIsActive(true);
    onStarted?.();
  };

  const handleStop = () => {
    heartRateSimulator.stop();
    setIsActive(false);
    setCurrentBpm(null);
    onStopped?.();
  };

  const handleBpmChange = (value: number) => {
    setBpm(value);
    heartRateSimulator.setBpm(value);
  };

  return (
    <div className="pm5-simulator-container">
      <div
        className="simulator-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="simulator-title">
          <span className="simulator-icon">❤️</span>
          <span>HR Simulator</span>
          {isActive && <span className="status-badge active">ACTIVE</span>}
        </div>
        <button className="expand-btn" type="button">
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div className="simulator-content">
          {isActive && currentBpm !== null && (
            <div className="simulator-live-stat">
              <span className="simulator-live-label">Live HR</span>
              <span className="simulator-live-value">{currentBpm} bpm</span>
            </div>
          )}

          <div className="settings-grid">
            <div className="setting-item">
              <label>Target BPM</label>
              <div className="setting-control">
                <input
                  type="range"
                  min="40"
                  max="220"
                  value={bpm}
                  onChange={(e) => handleBpmChange(Number(e.target.value))}
                />
                <span className="setting-value">{bpm} bpm</span>
              </div>
            </div>
          </div>

          <div className="simulator-actions">
            {!isActive ? (
              <button className="btn btn-start" onClick={handleStart} type="button">
                ▶ Start HR Simulator
              </button>
            ) : (
              <button className="btn btn-stop" onClick={handleStop} type="button">
                ⏹ Stop
              </button>
            )}
          </div>

          <p className="simulator-hint">
            💡 Simulates a Bluetooth heart rate monitor without real hardware
          </p>
        </div>
      )}
    </div>
  );
};

export default HeartRateSimulator;
