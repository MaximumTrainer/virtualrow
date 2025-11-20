import React, { useEffect, useState } from 'react';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import { workoutService } from '../services/workoutService';

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
      workoutService.updateSessionHeartRate(sample.bpm);
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
    <div className="hr-monitor-panel">
      <h3 className="panel-title">Heart Rate</h3>
      <div className="hr-status-row">
        <span className={`hr-status-dot ${connected ? 'connected' : 'disconnected'}`}>●</span>
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <div className="hr-metrics">
        <div className="hr-metric"><span className="label">Current</span><span className="value">{current ?? '--'} bpm</span></div>
        <div className="hr-metric"><span className="label">Avg</span><span className="value">{avg ?? '--'} bpm</span></div>
        <div className="hr-metric"><span className="label">Max</span><span className="value">{max ?? '--'} bpm</span></div>
      </div>
      <div className="hr-actions">
        {!connected ? (
          <button className="btn" onClick={connect}>Connect HR Monitor</button>
        ) : (
          <button className="btn" onClick={disconnect}>Disconnect</button>
        )}
      </div>
      {error && <div className="error-msg">{error}</div>}
    </div>
  );
};

export default HeartRateMonitor;
