import React, { useState, useEffect, useRef } from 'react';
import type { BluetoothDeviceState, PM5Data } from '../types/index';
import { bluetoothService } from '../services/bluetoothService';
import { ftmsService } from '../services/ftmsService';
import './BluetoothDevice.css';

interface BluetoothDeviceProps {
  onConnected?: (deviceName: string) => void;
  onDisconnected?: () => void;
  onDataReceived?: (data: PM5Data) => void;
  onError?: (error: string) => void;
}

// Supported rower device protocols
type DeviceType = 'pm5' | 'ftms';

export const BluetoothDevice: React.FC<BluetoothDeviceProps> = ({
  onConnected,
  onDisconnected,
  onDataReceived,
  onError,
}) => {
  const [deviceState, setDeviceState] = useState<BluetoothDeviceState>({
    isConnected: false,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [pm5Data, setPM5Data] = useState<PM5Data | null>(null);
  const [deviceType, setDeviceType] = useState<DeviceType>('pm5');
  // Track which service is currently active so disconnect targets the correct one
  const activeDeviceTypeRef = useRef<DeviceType>('pm5');

  useEffect(() => {
    // Set up event listeners shared by both PM5 and FTMS services
    const handleConnected = (data: unknown) => {
      const connectionData = data as { deviceName?: string };
      setDeviceState((prev) => ({
        ...prev,
        isConnected: true,
        deviceName: connectionData.deviceName,
      }));
      setIsConnecting(false);
      onConnected?.(connectionData.deviceName || 'Concept2 PM5');
    };

    const handleDisconnectedEvent = () => {
      setDeviceState({
        isConnected: false,
      });
      setPM5Data(null);
      onDisconnected?.();
    };

    const handleData = (data: PM5Data) => {
      setPM5Data(data);
      onDataReceived?.(data);
    };

    const handleError = (error: unknown) => {
      const errorData = error as { message?: string };
      const errorMsg = errorData.message || 'Unknown error occurred';
      setDeviceState((prev) => ({
        ...prev,
        error: errorMsg,
      }));
      setIsConnecting(false);
      onError?.(errorMsg);
    };

    bluetoothService.on('connected', handleConnected);
    bluetoothService.on('disconnected', handleDisconnectedEvent);
    bluetoothService.on('data', handleData);
    bluetoothService.on('error', handleError);

    ftmsService.on('connected', handleConnected);
    ftmsService.on('disconnected', handleDisconnectedEvent);
    ftmsService.on('data', handleData);
    ftmsService.on('error', handleError);

    // Cleanup: remove event listeners when component unmounts or callbacks change
    return () => {
      bluetoothService.off('connected', handleConnected);
      bluetoothService.off('disconnected', handleDisconnectedEvent);
      bluetoothService.off('data', handleData);
      bluetoothService.off('error', handleError);

      ftmsService.off('connected', handleConnected);
      ftmsService.off('disconnected', handleDisconnectedEvent);
      ftmsService.off('data', handleData);
      ftmsService.off('error', handleError);
      // We intentionally do NOT disconnect the device here to maintain connection
    };
  }, [onConnected, onDisconnected, onDataReceived, onError]);

  const handleConnect = async () => {
    setIsConnecting(true);
    const service = deviceType === 'pm5' ? bluetoothService : ftmsService;
    const success = await service.connect();
    if (success) {
      activeDeviceTypeRef.current = deviceType;
    } else {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const service = activeDeviceTypeRef.current === 'pm5' ? bluetoothService : ftmsService;
    await service.disconnect();
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
            {deviceState.deviceName || 'Concept2 PM5'}
          </h3>
          <p className={`device-status ${deviceState.isConnected ? 'connected' : 'disconnected'}`}>
            {deviceState.isConnected ? '● Connected' : '● Disconnected'}
          </p>
        </div>
      </div>

      {pm5Data && (
        <div className="metrics-grid">
          <div className="metric">
            <span className="metric-label">Pace</span>
            <span className="metric-value">
              {pm5Data.pace ? (pm5Data.pace / 100).toFixed(1) : '--'}
            </span>
            <span className="metric-unit">s/500m</span>
          </div>
          <div className="metric">
            <span className="metric-label">Distance</span>
            <span className="metric-value">
              {(pm5Data.distance / 1000).toFixed(2)}
            </span>
            <span className="metric-unit">km</span>
          </div>
          <div className="metric">
            <span className="metric-label">Time</span>
            <span className="metric-value">
              {formatTime(pm5Data.elapsedTime)}
            </span>
            <span className="metric-unit">—</span>
          </div>
          {pm5Data.power !== undefined && (
            <div className="metric">
              <span className="metric-label">Power</span>
              <span className="metric-value">{pm5Data.power}</span>
              <span className="metric-unit">W</span>
            </div>
          )}
          {pm5Data.cadence !== undefined && (
            <div className="metric">
              <span className="metric-label">Cadence</span>
              <span className="metric-value">{pm5Data.cadence}</span>
              <span className="metric-unit">spm</span>
            </div>
          )}
          {pm5Data.heartRate !== undefined && pm5Data.heartRate > 0 && (
            <div className="metric">
              <span className="metric-label">Heart Rate</span>
              <span className="metric-value">{pm5Data.heartRate}</span>
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
          <>
            <div className="device-type-selector">
              <button
                className={`device-type-btn${deviceType === 'pm5' ? ' active' : ''}`}
                onClick={() => setDeviceType('pm5')}
                disabled={isConnecting}
              >
                PM5
              </button>
              <button
                className={`device-type-btn${deviceType === 'ftms' ? ' active' : ''}`}
                onClick={() => setDeviceType('ftms')}
                disabled={isConnecting}
              >
                FTMS
              </button>
            </div>
            <button
              className="btn btn-connect"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting
                ? 'Connecting...'
                : deviceType === 'pm5'
                  ? 'Connect PM5'
                  : 'Connect FTMS Rower'}
            </button>
          </>
        ) : (
          <button className="btn btn-disconnect" onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      <p className="device-note">
        {deviceType === 'pm5'
          ? 'Make sure your Concept2 PM5 is powered on and nearby'
          : 'Make sure your FTMS-compatible rowing machine is powered on and nearby'}
      </p>
    </div>
  );
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export default BluetoothDevice;
