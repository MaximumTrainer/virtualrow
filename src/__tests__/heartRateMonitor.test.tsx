import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import HeartRateMonitor from '../components/HeartRateMonitor';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';

describe('HeartRateMonitor component', () => {
  beforeEach(() => {
    // clear any existing listeners and samples
    (heartRateBluetoothService as any).listeners = new Map();
    (heartRateBluetoothService as any).samples = [];
  });

  afterEach(() => {
    // ensure unmount clears listeners
    (heartRateBluetoothService as any).listeners = new Map();
    (heartRateBluetoothService as any).samples = [];
  });

  it('shows connection state on connected/disconnected events', async () => {
    render(<HeartRateMonitor />);

    // Initially disconnected
    expect(screen.getByText(/Disconnected/i)).toBeInTheDocument();

    // Emit connected — state update is RAF-deferred to avoid WS/CDP stack overflows
    act(() => (heartRateBluetoothService as any).emit('connected', {}));

    // Wait for the RAF callback to fire and React to re-render
    const statusElement = document.querySelector('.device-status');
    await waitFor(() => {
      expect(statusElement).toHaveClass('connected');
    }, { timeout: 500 });
    expect(screen.getByText('Connected')).toBeInTheDocument();

    // Emit disconnected
    act(() => (heartRateBluetoothService as any).emit('disconnected', {}));
    await waitFor(() => {
      expect(statusElement).toHaveClass('disconnected');
    }, { timeout: 500 });
  });

  it('invokes onSample callback and updates metrics on heartRate event', async () => {
    const onSample = vi.fn();
    render(<HeartRateMonitor onSample={onSample} />);

    // Emit a heart rate sample — onSample is called synchronously; UI updates are RAF-deferred
    act(() => (heartRateBluetoothService as any).emit('heartRate', { bpm: 84 }));

    expect(onSample).toHaveBeenCalled();
    expect(onSample.mock.calls[0][0]).toBe(84);

    // Wait for RAF to fire and React to update the metric display
    await waitFor(() => {
      expect(screen.getByText('84')).toBeInTheDocument();
    }, { timeout: 500 });

    expect(screen.getByText(/Current/)).toBeInTheDocument();
    const metricUnits = screen.getAllByText('bpm');
    expect(metricUnits.length).toBeGreaterThan(0);
  });
});
