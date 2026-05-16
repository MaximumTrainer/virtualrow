import React, { useState, useEffect } from 'react';
import type { BluetoothDeviceState, PM5Data } from '../types/index';
import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
import './BluetoothDevice.css';

interface FTMSDeviceProps {
  onConnected?: (deviceName: string) => void;
  onDisconnected?: () => void;
  onDataReceived?: (data: PM5Data) => void;
  onError?: (error: string) => void;
}

/**
 * BLE connection panel for FTMS-compatible rowing machines (WaterRower, Concept2 RowErg,
 * Sunny Rowing, NordicTrack RW900, etc.).
 *
 * Mirrors BluetoothDevice.tsx but uses ftmsBluetoothService instead of the PM5 CSAFE service.
 * The emitted PM5Data shape is identical, so all downstream workout tracking is unchanged.
 */
export const FTMSDevice: React.FC<FTMSDeviceProps> = ({
  onConnected,
  onDisconnected,
  onDataReceived,
  onError,
}) => {
  const [deviceState, setDeviceState] = useState<BluetoothDeviceState>({
    isConnected: false,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [rowerData, setRowerData] = useState<PM5Data | null>(null);

  useEffect(() => {
    const handleConnected = (data: unknown) => {
      const d = data as { deviceName?: string };
      setDeviceState((prev) => ({ ...prev, isConnected: true, deviceName: d.deviceName }));
      setIsConnecting(false);
      onConnected?.(d.deviceName ?? 'FTMS Rower');
    };

    const handleDisconnectedEvent = () => {
      setDeviceState({ isConnected: false });
      setRowerData(null);
      onDisconnected?.();
    };

    const handleData = (data: PM5Data) => {
      setRowerData(data);
      onDataReceived?.(data);
    };

    const handleError = (error: unknown) => {
      const e = error as { message?: string };
      const msg = e.message ?? 'Unknown error';
      setDeviceState((prev) => ({ ...prev, error: msg }));
      setIsConnecting(false);
      onError?.(msg);
    };

    ftmsBluetoothService.on('connected', handleConnected);
    ftmsBluetoothService.on('disconnected', handleDisconnectedEvent);
    ftmsBluetoothService.on('data', handleData);
    ftmsBluetoothService.on('error', handleError);

    return () => {
      ftmsBluetoothService.off('connected', handleConnected);
      ftmsBluetoothService.off('disconnected', handleDisconnectedEvent);
      ftmsBluetoothService.off('data', handleData);
      ftmsBluetoothService.off('error', handleError);
    };
  }, [onConnected, onDisconnected, onDataReceived, onError]);

  const handleConnect = async () => {
    setIsConnecting(true);
    const success = await ftmsBluetoothService.connect();
    if (!success) setIsConnecting(false);
  };

  const handleDisconnect = async () => {
    await ftmsBluetoothService.disconnect();
  };

  return (
    <div className="bluetooth-device-container">
      <div className="device-header">
        <div className="device-icon-container">
          <svg
            className={`device-icon ${deviceState.isConnected ? 'connected' : 'disconnected'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path d="M6 9l6 6 6-6" />
            <path d="M9 6l3 3 3-3" />
          </svg>
        </div>
        <div className="device-info">
          <h3 className="device-name">
            {deviceState.deviceName ?? 'FTMS Rower'}
          </h3>
          <p className={`device-status ${deviceState.isConnected ? 'connected' : 'disconnected'}`}>
            {deviceState.isConnected ? '● Connected' : '● Disconnected'}
          </p>
        </div>
      </div>

      {rowerData && (
        <div className="metrics-grid">
          <div className="metric">
            <span className="metric-label">Pace</span>
            <span className="metric-value">
              {rowerData.pace ? (rowerData.pace / 100).toFixed(1) : '--'}
            </span>
            <span className="metric-unit">s/500m</span>
          </div>
          <div className="metric">
            <span className="metric-label">Distance</span>
            <span className="metric-value">
              {(rowerData.distance / 1000).toFixed(2)}
            </span>
            <span className="metric-unit">km</span>
          </div>
          <div className="metric">
            <span className="metric-label">Time</span>
            <span className="metric-value">{formatTime(rowerData.elapsedTime)}</span>
            <span className="metric-unit">—</span>
          </div>
          {rowerData.power !== undefined && (
            <div className="metric">
              <span className="metric-label">Power</span>
              <span className="metric-value">{rowerData.power}</span>
              <span className="metric-unit">W</span>
            </div>
          )}
          {rowerData.cadence !== undefined && rowerData.cadence > 0 && (
            <div className="metric">
              <span className="metric-label">Rate</span>
              <span className="metric-value">{rowerData.cadence}</span>
              <span className="metric-unit">spm</span>
            </div>
          )}
          {rowerData.heartRate !== undefined && rowerData.heartRate > 0 && (
            <div className="metric">
              <span className="metric-label">HR</span>
              <span className="metric-value">{rowerData.heartRate}</span>
              <span className="metric-unit">bpm</span>
            </div>
          )}
        </div>
      )}

      {deviceState.error && (
        <div className="error-message">
          <span className="error-icon">⚠</span>
          <span>{deviceState.error}</span>
        </div>
      )}

      <div className="device-actions">
        {!deviceState.isConnected ? (
          <button
            className="btn btn-connect"
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect FTMS Rower'}
          </button>
        ) : (
          <button className="btn btn-disconnect" onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      <p className="device-note">
        Connect any FTMS-compatible rowing machine (WaterRower, Concept2 RowErg, etc.)
      </p>
    </div>
  );
};

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default FTMSDevice;
