import React, { useEffect, useState } from 'react';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import './BluetoothDevice.css';

interface HeartRateMonitorProps {
  onSample?: (bpm: number) => void;
}

export const HeartRateMonitor: React.FC<HeartRateMonitorProps> = ({ onSample }) => {
  const [connected, setConnected] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [avg, setAvg] = useState<number | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleHR = (sample: { bpm: number }) => {
      setCurrent(sample.bpm);
      const samples = heartRateBluetoothService.getSamples();
      const values = samples.map(s => s.bpm);
      if (values.length) {
        const average = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
        setAvg(average);
        setMax(values.reduce((m, v) => v > m ? v : m, values[0]));
      }
      if (onSample) onSample(sample.bpm);
    };
    const handleConnected = () => setConnected(true);
    const handleDisconnected = () => setConnected(false);
    const handleError = (e: any) => setError(e?.message || 'HR error');

    heartRateBluetoothService.on('heartRate', handleHR);
    heartRateBluetoothService.on('connected', handleConnected);
    heartRateBluetoothService.on('disconnected', handleDisconnected);
    heartRateBluetoothService.on('error', handleError);
    return () => {
      heartRateBluetoothService.off('heartRate', handleHR);
      heartRateBluetoothService.off('connected', handleConnected);
      heartRateBluetoothService.off('disconnected', handleDisconnected);
      heartRateBluetoothService.off('error', handleError);
    };
  }, [onSample]);

  const connect = async () => {
    setError(null);
    await heartRateBluetoothService.connect();
  };

  const disconnect = async () => {
    await heartRateBluetoothService.disconnect();
  };

  return (
    <div className="bluetooth-device-container">
      <div className="device-header">
        <div className="device-icon-container">
          <svg
            className={`device-icon ${connected ? 'connected' : 'disconnected'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
          </svg>
        </div>
        <div className="device-info">
          <h3 className="device-name">Heart Rate Monitor</h3>
          <p className={`device-status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </p>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
        </div>
      )}

      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">Current</div>
          <div className="metric-value">{current ?? '--'}</div>
          <div className="metric-unit">bpm</div>
        </div>
        <div className="metric">
          <div className="metric-label">Average</div>
          <div className="metric-value">{avg ?? '--'}</div>
          <div className="metric-unit">bpm</div>
        </div>
        <div className="metric">
          <div className="metric-label">Max</div>
          <div className="metric-value">{max ?? '--'}</div>
          <div className="metric-unit">bpm</div>
        </div>
      </div>

      <div className="device-actions">
        {!connected ? (
          <button className="btn btn-connect" onClick={connect}>Connect HR Monitor</button>
        ) : (
          <button className="btn btn-disconnect" onClick={disconnect}>Disconnect</button>
        )}
      </div>
    </div>
  );
};

export default HeartRateMonitor;
